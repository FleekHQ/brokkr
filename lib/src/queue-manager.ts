import IClient from './clients/iclient';
import Saga, {SagaStatus} from './entities/saga';
import {getSagaStepTableName, ISagaStep, SagaStepStatus} from './entities/saga-step';
import {getIds, getMultiple, update} from './helpers/db';
import { IHashMap, IWorker } from './interfaces';

export interface IQueueManagerOpts {
  queueSize?: number,
  pollingIntervalInMs?: number,
  failSagaOnError?: boolean
}

class QueueManager {
  protected queueSize: number;
  protected failSagaOnError: boolean;
  protected pollingIntervalInMs: number;
  protected sagas: Saga[];
  protected workers: IWorker[];
  protected client: IClient;
  protected namespace: string;
  protected queueMap: IHashMap;
  protected pollingInterval: NodeJS.Timeout | undefined;
  protected tickLock: boolean;

  constructor(
    client: IClient,
    namespace: string,
    {
      queueSize = 25,
      pollingIntervalInMs = 1000,
      failSagaOnError = true,
    }: IQueueManagerOpts
  ) {
    this.client = client;
    this.namespace = namespace;
    this.queueSize = queueSize;
    this.pollingIntervalInMs = pollingIntervalInMs;
    this.failSagaOnError = failSagaOnError;
    this.sagas = [];
    this.workers = [];
    this.queueMap = {};
    this.tickLock = false;
  }

  /**
   * Returns the total amount of items currently running
   */
  public getTotalRunning() {
    return Object.keys(this.queueMap).length;
  }

  /**
   * Adds a Saga to the queue manager.
   * When a Saga is added, it's going to be constantly polled to check if there are
   * available steps to run.
   * @param saga A Saga object
   */
  public addSaga(saga: Saga) {
    this.sagas.push(saga);
  }

  /**
   * Adds a worker to the queue manager. If a step is run for which a worker does not exist,
   * it will fail.
   * @param worker A worker object
   */
  public addWorker(worker: IWorker) {
    this.workers.push(worker);
  }

  /**
   * Starts running the queue
   */
  public start() {
    this.pollingInterval = setInterval(() => {
      this.tick();
    }, this.pollingIntervalInMs);
  }

  /**
   * Stops running the queue
   */
  public stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    this.pollingInterval = undefined;
  }

  /**
   * Executes one loop of the queue.
   * In one loop, all sagas are processed to check if any steps are enqueued.
   * Then, if there is enough space in the queue, the steps are ran.
   * Also removes steps/sagas that are already finished.
   */
  protected async tick() {
    if (this.tickLock) { return; } // Prevent running many ticks in parallel
    this.tickLock = true;

    // Get all enqueued steps
    const sagas = [...this.sagas];
    const sagaPromises = sagas.map(async (saga) => {
      const sagaId = saga.getId();
      if (!sagaId) {
        // Don't do work for an uninitialized saga
        return;
      }

      const sagaValues = await saga.getValues();

      const allStepIds = await getIds(this.client, this.namespace, getSagaStepTableName(sagaId));
      const allStepInfo = await getMultiple<ISagaStep>(
        this.client, this.namespace, getSagaStepTableName(sagaId), allStepIds
      );

      const stepPromises = allStepInfo.map(async (step) => {
        // If step is not initialized, do nothing.
        if (!step.id) { return };
        // If the step is now finished and was running, remove it from the queue
        if (this.queueMap[step.id] && step.status !== SagaStepStatus.Running) {
          delete this.queueMap[step.id];
        }
        // If the step is enqueued and there is space available, run it
        if (!this.queueMap[step.id]
            && step.status === SagaStepStatus.Queued
            && this.getTotalRunning() < this.queueSize) {
              this.queueMap[step.id] = 'running';
              return this.runStep(step, saga);
            }
      });

      // If the saga is finished, remove it from the loop
      if (sagaValues.status === SagaStatus.Finished || sagaValues.status === SagaStatus.Failed) {
        this.sagas = this.sagas.filter(currSaga => currSaga !== saga);
        return;
      }

      return Promise.all(stepPromises);
    });

    await Promise.all(sagaPromises);
    this.tickLock = false;
  }

  /**
   * Attempts to call the worker for the given step.
   * @param step The values of a SagaStep object
   * @param saga The Saga that contains that step
   */
  protected async runStep(step: ISagaStep, saga: Saga) {
    const {id: stepId, workerName} = step;
    const sagaId = saga.getId();
    if (!stepId || !sagaId) {
      // This should never happen, as we validate it is iniaizlied before running in tick()
      throw Error('Attempting to run a step that is not initialized');
    }

    const worker = this.workers.find(w => w.name === workerName);
    if (!worker) {
      // tslint:disable-next-line: no-console
      console.error(`Error while running step: Worker "${workerName}" does not exist.`)
      if (this.failSagaOnError) {
        await saga.stepFailed(stepId);
      }
      return;
    }

    await update(this.client, this.namespace, getSagaStepTableName(sagaId), stepId, {
      status: SagaStepStatus.Running,
    });

    return worker.run(step.args, step.dependencyArgs);
  }
}

export default QueueManager;