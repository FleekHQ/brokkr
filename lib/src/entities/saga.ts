import IClient from "../clients/iclient";
import {create, get, getMultiple, getIds, update} from '../helpers/db';
import Entity from "./entity";
import SagaStep, {SagaStepStatus, getSagaStepTableName, ISagaStep} from './saga-step';

export const TABLE_NAME = 'saga';

export enum SagaStatus {
  Uninitialized,
  Created,
  Running,
  Finished,
  Failed,
}

export interface ISaga {
  id?: string,
  status: SagaStatus,
};

class Saga extends Entity<ISaga> {
  constructor(client: IClient, namespace: string) {
    super(client, namespace, TABLE_NAME);
  }

  public async create() {
    return await super.create({status: SagaStatus.Created});
  }

  public async addStep(
    workerName: string,
    args: any[],
    dependsOnSteps: string[] = [],
    mapPrevStepResultToArg?: Array<(data: string) => void>
  ) {
    const id = this.getId();
    if (!id) { throw Error('Cannot add a step for an uninitialized Saga'); }

    const newStep = new SagaStep(this.client, this.namespace);
    await newStep.createFromSaga(id, {
      args,
      dependsOn: dependsOnSteps,
      workerName,
    });

    return newStep;
  }

  public async tick() {
    const id = this.getId();
    const {status} = await this.getValues();

    if (status !== SagaStatus.Running || !id) { return; };

    const allStepIds = await getIds(this.client, this.namespace, getSagaStepTableName(id));
    const allSteps = await getMultiple<ISagaStep>(
      this.client, this.namespace, getSagaStepTableName(id), allStepIds
    );
    const unqueuedSteps = allSteps.filter(step => step.status === SagaStepStatus.Created);

    if (unqueuedSteps.length === 0) {
      await update<ISaga>(
        this.client, this.namespace, this.tableName, id, {status: SagaStatus.Finished}
      );
      return;
    }

    const stepsToExecute: ISagaStep[] = [];
    unqueuedSteps.forEach(unqueuedStep => {
      const currDependentSteps = allSteps.filter(step => step.id && unqueuedStep.dependsOn.includes(step.id));
      let allFinished = false;
      if (!currDependentSteps || currDependentSteps.length === 0) {
        allFinished = true;
      } else {
        const unfinishedDep = currDependentSteps.find(step => step.status !== SagaStepStatus.Finished);
        if (!unfinishedDep) {
          allFinished = true;
        }
      }

      if (allFinished) { stepsToExecute.push(unqueuedStep); }
    });

    const stepPromises = stepsToExecute.map(stepValues => {
      let step = new SagaStep(this.client, this.namespace);
      step = step.instantiateFromSaga(id, stepValues);
      return step.executeStep();
    });

    await Promise.all(stepPromises);
  }
}

export default Saga;