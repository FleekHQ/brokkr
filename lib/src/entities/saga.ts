import IClient from '../clients/iclient';
import { create, get, getIds, getMultiple, update } from '../helpers/db';
import Entity from './entity';
import SagaStep, { getSagaStepTableName, ISagaStep, SagaStepStatus } from './saga-step';

export const TABLE_NAME = 'saga';

export enum SagaStatus {
  Uninitialized,
  Created,
  Running,
  Finished,
  Failed,
}

export interface ISaga {
  id?: string;
  status: SagaStatus;
}

class Saga extends Entity<ISaga> {
  constructor(client: IClient, namespace: string) {
    super(client, namespace, TABLE_NAME);
  }

  /**
   * Creates and stores a new Saga
   */
  public async create() {
    return await super.create({ status: SagaStatus.Created });
  }

  /**
   * Adds a step to this Saga. It can include dependencies if necessary.
   * @param workerName The worker that will be called once this step is enqueued
   * @param args The arguments to pass to the worker.
   * @param dependsOnSteps Defaults to []. If included, will not enqueue the step until all dependencies are complete. Also, will send the results of the dependencies to the worker when executing it.
   */
  public async addStep(workerName: string, args: any[], dependsOnSteps: string[] = []) {
    const id = this.getId();
    if (!id) {
      throw Error('Cannot add a step for an uninitialized Saga');
    }

    const newStep = new SagaStep(this.client, this.namespace);
    await newStep.createFromSaga(id, {
      args,
      dependsOn: dependsOnSteps,
      workerName,
    });

    return newStep;
  }

  /**
   * Use this method to notify the Saga that a step finished successfully.
   * The Saga will look if any step got unblocked and run those.
   * Will also send the `result` variable into the workers of the dependencies.
   * @param stepId The id of the step that finished
   * @param result The result of the execution of this step
   */
  public async stepFinished(stepId: string, result?: any) {
    try {
      if (result) {
        JSON.parse(JSON.stringify(result));
      }
    } catch (error) {
      throw Error('Error in stepFinished: `result` must be JSON encodable.');
    }
    const id = this.getId();

    if (!id) {
      throw Error('Error in stepFinished: Saga is not initialized');
    }

    const stepValues = await get<ISagaStep>(this.client, this.namespace, getSagaStepTableName(id), stepId);
    let step = new SagaStep(this.client, this.namespace);
    step = step.instantiateFromSaga(id, stepValues);
    await step.finished(result);

    // Some dependency might have been freed up, so we can run another tick
    await this.tick();
  }

  /**
   * Use this method to notify the Saga that a step failed.
   * The Saga will be marked as Failed and all the executed steps will be rolled back if possible
   * (using their compensators).
   * @param stepId The id of the step that failed
   */
  public async stepFailed(stepId: string) {
    const id = this.getId();
    if (!id) {
      throw Error('Error in stepFailed: Saga is not initialized');
    }

    // Mark the Saga as failed
    await update(this.client, this.namespace, this.tableName, id, {
      status: SagaStatus.Failed,
    });

    // Get all steps that must be reverted
    const allSteps = await this.getAllSteps();
    const stepsToRollback = allSteps.filter(currStep => currStep.status === SagaStepStatus.Finished);

    // Mark current step as failed
    const failedStepValues = await get<ISagaStep>(this.client, this.namespace, getSagaStepTableName(id), stepId);
    let failedStep = new SagaStep(this.client, this.namespace);
    failedStep = failedStep.instantiateFromSaga(id, failedStepValues);
    await failedStep.fail();

    // Run the failure logic for all the already executed steps
    const promises = stepsToRollback.map(currStepValues => {
      let currStep = new SagaStep(this.client, this.namespace);
      currStep = currStep.instantiateFromSaga(id, currStepValues);
      return currStep.rollback();
    });

    await Promise.all(promises);
  }

  /**
   * Starts the saga. Enqueues any step without dependencies.
   */
  public async start() {
    const id = this.getId();
    if (!id) {
      throw Error('Error in start: cannot start an uninitialized Saga');
    }

    await update(this.client, this.namespace, this.tableName, id, {
      status: SagaStatus.Running,
    });

    await this.tick();
  }

  /**
   * Returns the values of all steps that belong to this Saga.
   */
  protected async getAllSteps(): Promise<ISagaStep[]> {
    const id = this.getId();

    if (!id) {
      throw Error('Cannot get steps for uninitialized Saga');
    }

    const allStepIds = await getIds(this.client, this.namespace, getSagaStepTableName(id));
    const allSteps = await getMultiple<ISagaStep>(this.client, this.namespace, getSagaStepTableName(id), allStepIds);

    return allSteps;
  }

  /**
   * Main method of Saga. Finds any step that is unblocked (does not have dependencies or
   * they are finished) and enqueues them.
   */
  protected async tick() {
    const id = this.getId();
    const { status } = await this.getValues();

    if (status !== SagaStatus.Running || !id) {
      return;
    }

    const allSteps = await this.getAllSteps();
    const unqueuedSteps = allSteps.filter(step => step.status === SagaStepStatus.Created);

    if (unqueuedSteps.length === 0) {
      await update<ISaga>(this.client, this.namespace, this.tableName, id, { status: SagaStatus.Finished });
      return;
    }

    const stepsToExecute: ISagaStep[] = [];
    unqueuedSteps.forEach(unqueuedStep => {
      const dependencies = unqueuedStep.dependsOn || [];
      const currDependentSteps = allSteps.filter(step => step.id && dependencies.includes(step.id));
      let allFinished = false;
      if (!currDependentSteps || currDependentSteps.length === 0) {
        allFinished = true;
      } else {
        const unfinishedDep = currDependentSteps.find(step => step.status !== SagaStepStatus.Finished);
        if (!unfinishedDep) {
          allFinished = true;
        }
      }

      if (allFinished) {
        stepsToExecute.push(unqueuedStep);
      }
    });

    const stepPromises = stepsToExecute.map(stepValues => {
      let step = new SagaStep(this.client, this.namespace);
      step = step.instantiateFromSaga(id, stepValues);
      return this.enqueueStep(step);
    });

    await Promise.all(stepPromises);
  }

  /**
   * Helper method that enqueues a step.
   * @param step The step to enqueue
   */
  protected async enqueueStep(step: SagaStep) {
    const sagaId = this.getId();
    const stepId = step.getId();
    if (!sagaId || !stepId) {
      throw Error('Enqueueing saga step for an uninitialized saga or step');
    }

    await step.enqueueStep();
  }
}

export default Saga;
