import IClient from "../clients/iclient";
import {create} from '../helpers/db';
import Entity from "./entity";

export const TABLE_NAME = 'saga_step';

export enum SagaStepStatus {
  Uninitialized,
  Created,
  WaitingForCompensation,
  Queued,
  Running,
  Finished,
  Failed,
}

export interface ISagaStep {
  id?: string,
  args: any[],
  dependsOn: string[],
  workerName: string,
  status?: SagaStepStatus,
  compensatorOf?: string,
}

class SagaStep extends Entity<ISagaStep>{
  protected sagaId: string | undefined;

  constructor(client: IClient, namespace: string) {
    super(client, namespace, TABLE_NAME);
  }

  public async createFromSaga(sagaId: string, values: ISagaStep) {
    this.instantiateFromSaga(sagaId, values);
    const newValues = await super.create({
      ...values,
      status: SagaStepStatus.Created,
    });
    this.instantiateFromSaga(sagaId, newValues);
    return newValues;
  }

  public instantiateFromSaga(sagaId: string, values: ISagaStep) {
    this.tableName = getSagaStepTableName(sagaId);
    this.sagaId = sagaId;
    return this;
  }

  public async compensateWith(values: ISagaStep) {
    const id = this.getId();
    if (!id || !this.sagaId) {
      throw Error('Cannot add a compensator for an uninitialized Step or Saga');
    }

    const newStep = new SagaStep(this.client, this.namespace);
    await newStep.createFromSaga(this.sagaId, {
      ...values,
      compensatorOf: id,
      status: SagaStepStatus.WaitingForCompensation,
    });

    return newStep;
  }

  public async executeStep() {
    throw Error('TODO: Implement this');
  }
}

// We namespace each step using tableName_sagaId as the hash key
// this is so we can have fast lookup of the steps for a given Saga
export const getSagaStepTableName = (sagaId: string) => {
  return `${TABLE_NAME}_${sagaId}`;
}

export default SagaStep;
