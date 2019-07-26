import IClient from './clients/iclient';
import Saga, { ISaga, SagaStatus, TABLE_NAME as SAGA_TABLE_NAME } from './entities/saga';
import { getIds, getMultiple } from './helpers/db';
import { IWorker } from './interfaces';
import QueueManager, { IQueueManagerOpts } from './queue-manager';

// DEVNOTE: Leaving this for now in case we add options in the future
// tslint:disable-next-line: no-empty-interface
interface IBrokkrOpts {
  debugMode?: boolean,
}

class Brokkr {
  private client: IClient;
  private namespace: string;
  private queueManager: QueueManager;
  private debugMode?: boolean;

  constructor(
    client: IClient,
    namespace: string = '',
    brokkrOpts: IBrokkrOpts = {},
    queueOpts: IQueueManagerOpts = {},
  ) {
    this.client = client;
    this.namespace = namespace;
    this.debugMode = brokkrOpts.debugMode;
    this.queueManager = new QueueManager(this.client, this.namespace, {
      debugMode: this.debugMode,
      ...queueOpts,
    });
    this.queueManager.start();
  }

  /**
   * Creates a Saga object and returns it.
   */
  public async createSaga(): Promise<Saga> {
    const saga = new Saga(this.client, this.namespace, {debugMode: this.debugMode});
    await saga.create();
    this.queueManager.addSaga(saga);
    return saga;
  }

  /**
   * Gets a previously created Saga by id
   * @param sagaId The id of the Saga
   */
  public getSaga(sagaId: string) {
    return this.queueManager.getSaga(sagaId);
  }

  /**
   * Gets a registered worker by name
   * @param workerName The name of the worker
   */
  public getWorker(workerName: string) {
    return this.queueManager.getWorker(workerName);
  }

  /**
   * Stops the worker queue. Enqueued steps will remain enqueued until it's restarted.
   */
  public stopWorkers() {
    this.queueManager.stop();
  }

  /**
   * Starts the worker queue. Note that it's started automatically when creating a Brokkr object.
   * So only call this if you called brokkr.stopWorkers before.
   */
  public startWorkers() {
    this.queueManager.start();
  }

  /**
   * Looks for any Saga that exists in the storage and initiates a worker for it if it's not finished
   */
  public async restorePreviousState() {
    const sagaIds = await getIds(this.client, this.namespace, SAGA_TABLE_NAME);
    const sagas = await getMultiple<ISaga>(this.client, this.namespace, SAGA_TABLE_NAME, sagaIds);

    const unfinishedSagas = sagas.filter(
      saga => saga.status !== SagaStatus.Finished && saga.status !== SagaStatus.Failed,
    );

    unfinishedSagas.forEach(sagaValues => {
      let saga = new Saga(this.client, this.namespace, {debugMode: this.debugMode});
      saga = saga.instantiate(sagaValues);
      this.queueManager.addSaga(saga);
    });
  }

  /**
   * Used internally to fetch information about the queue manager.
   */
  public getQueueManager() {
    return this.queueManager;
  }

  /**
   * Registers a new worker in Brokkr.
   * @param worker The worker object. Must contain a `name` property (string) and a `run` property (function)
   */
  public registerWorker(worker: IWorker) {
    this.queueManager.addWorker(worker);
  }

  /**
   * Calls registerWorker for each worker passed as an argument
   * @param args The workers to register
   */
  public registerWorkers(...workers: IWorker[]) {
    workers.forEach(worker => {
      this.registerWorker(worker);
    });
  }
}

export default Brokkr;
