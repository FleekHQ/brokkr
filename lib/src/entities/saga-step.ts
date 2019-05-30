import IClient from '../clients/iclient';
import { get, getMultiple, update } from '../helpers/db';
import Entity from './entity';

export const TABLE_NAME = 'saga_step';

export enum SagaStepStatus {
  Uninitialized,
  Created,
  WaitingForCompensation,
  Queued,
  Running,
  Finished,
  Failed,
  RolledBack,
}

export interface ISagaStep {
  id?: string;
  args: any[];
  dependsOn?: string[];
  workerName: string;
  status?: SagaStepStatus;
  compensatorId?: string;
  result?: any;
  dependencyArgs?: any[];
}

class SagaStep extends Entity<ISagaStep> {
  protected sagaId: string | undefined;

  constructor(client: IClient, namespace: string) {
    super(client, namespace, TABLE_NAME);
  }

  /**
   * Used internally to instantiate a step and register its information in the db
   * @param sagaId The id of the Saga
   * @param values the values to instantiate this step with
   */
  public async createFromSaga(sagaId: string, values: ISagaStep) {
    this.instantiateFromSaga(sagaId, values);
    const newValues = await super.create({
      status: SagaStepStatus.Created,
      ...values,
    });
    this.instantiateFromSaga(sagaId, newValues);
    return newValues;
  }

  /**
   * Used internally to instantiate a step without registering information in the db
   * (For example to restart an existing process when it fails)
   * @param sagaId The id of the Saga
   * @param values the values to instantiate this step with
   */
  public instantiateFromSaga(sagaId: string, values: ISagaStep) {
    this.tableName = getSagaStepTableName(sagaId);
    this.sagaId = sagaId;
    this.instantiate(values);
    return this;
  }

  /**
   * Adds a new step to the saga that is only executed if the previous step is completed and
   * the saga fails.
   * Use it to rollback changes that the previous step introduced.
   * The worker will receive `args` variable and also the result from the previous step.
   * @param workerName The worker to execute when the saga fails
   * @param args The fixed args to send to this worker
   */
  public async compensateWith(workerName: string, args: any[]) {
    const id = this.getId();
    if (!id || !this.sagaId) {
      throw Error('Cannot add a compensator for an uninitialized Step or Saga');
    }

    // Create a new compensator step
    const newStep = new SagaStep(this.client, this.namespace);
    await newStep.createFromSaga(this.sagaId, {
      args, // Allow setting fixed args for compensator
      dependsOn: [id], // This allows the compensator to know how to get the compensating step's result
      status: SagaStepStatus.WaitingForCompensation,
      workerName,
    });

    // Update the current step so that it points to the compensator
    await update(this.client, this.namespace, getSagaStepTableName(this.sagaId), id, {
      compensatorId: newStep.getId(),
    });

    return newStep;
  }

  /**
   * Used internally to mark a step as ready to execute.
   * Do not call this method directly, otherwise it might collide with the logic inside
   * the Saga class.
   */
  public async enqueueStep() {
    const sagaId = this.sagaId;
    const id = this.getId();
    if (!sagaId || !id) {
      throw Error('Enqueueing saga step for an uninitialized step');
    }

    const stepValues = await this.getValues();
    const dependencySteps =
      stepValues.dependsOn && stepValues.dependsOn.length > 0
        ? await getMultiple<ISagaStep>(this.client, this.namespace, getSagaStepTableName(sagaId), stepValues.dependsOn)
        : [];

    const errorDependency = dependencySteps.find(
      dep => dep.status !== SagaStepStatus.Finished && dep.status !== SagaStepStatus.RolledBack,
    );
    if (errorDependency) {
      // This shouldn't happen as we make sure all deps are finished in tick()
      throw Error('Unexpected error: Enqueueing saga step with an unfinished dependency');
    }

    await update(this.client, this.namespace, getSagaStepTableName(sagaId), id, {
      dependencyArgs: dependencySteps.map(dep => dep.result),
      status: SagaStepStatus.Queued,
    });
  }

  /**
   * Used internally to mark a step as finished. Use Saga.stepFinished instead of this
   * to trigger Saga logic after finishing a step.
   * @param result The result of the step that will be sent to all dependencies of this step
   */
  public async finished(result?: any) {
    const sagaId = this.sagaId;
    const id = this.getId();
    if (!sagaId || !id) {
      throw Error('Finishing saga step for an uninitialized step');
    }
    await update(this.client, this.namespace, getSagaStepTableName(sagaId), id, {
      result,
      status: SagaStepStatus.Finished,
    });
  }

  /**
   * Used internally to mark a step as failed.
   * Please use Saga.stepFailed instead  so that the Saga can trigger all side-effects.
   */
  public async fail() {
    const sagaId = this.sagaId;
    const id = this.getId();
    if (!sagaId || !id) {
      throw Error('Failing saga step for an uninitialized step');
    }

    await update(this.client, this.namespace, getSagaStepTableName(sagaId), id, {
      status: SagaStepStatus.Failed,
    });
  }

  /**
   * Rolls back a step by finding its compensator and enqueueing it.
   * If working with a Saga, this gets triggered as a side-effect of the Saga.stepFailed method.
   * Don't call this method directly unless you know what you are doing.
   */
  public async rollback() {
    const sagaId = this.sagaId;
    const id = this.getId();
    if (!sagaId || !id) {
      throw Error('Rolling back saga step for an uninitialized step');
    }
    const { compensatorId } = await this.getValues();

    await update(this.client, this.namespace, getSagaStepTableName(sagaId), id, {
      status: SagaStepStatus.RolledBack,
    });

    // Get the compensator if any
    if (compensatorId) {
      const compensatorValues = await get<ISagaStep>(
        this.client,
        this.namespace,
        getSagaStepTableName(sagaId),
        compensatorId,
      );

      // Enqueue the compensator
      let compensator = new SagaStep(this.client, this.namespace);
      compensator = compensator.instantiateFromSaga(sagaId, compensatorValues);
      await compensator.enqueueStep();
    }
  }
}

// We namespace each step using tableName_sagaId as the hash key
// this is so we can have fast lookup of the steps for a given Saga
export const getSagaStepTableName = (sagaId: string) => {
  return `${TABLE_NAME}_${sagaId}`;
};

export default SagaStep;
