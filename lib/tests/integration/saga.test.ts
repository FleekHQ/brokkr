import {RedisClient} from 'redis';
import { Brokkr, buildRedisClient, IClient, Saga, SagaStatus, SagaStep, SagaStepStatus } from '../../src';
import redisClientBuilder from '../helpers/redis-client-builder';

describe('Saga integration tests', () => {
  let brokkr: Brokkr;
  let client: IClient;
  let redisClient: RedisClient;

  const namespace = 'MyCoolNamespace';

  beforeAll(() => {
    redisClient = redisClientBuilder();
  });

  beforeEach((done) => {
    // Reset db after each test
    redisClient.flushdb(() => {
      client = buildRedisClient(redisClient);
      brokkr = new Brokkr(client, namespace);
      done();
    });
  });

  afterAll((done) => {
    redisClient.quit(done)
  })

  it('can create a bunch of sagas', async (done) => {
    const saga1 = await brokkr.createSaga();
    expect(saga1).toBeDefined();
    expect(saga1.getId()).toEqual("1");

    const saga2 = await brokkr.createSaga();
    expect(saga2).toBeDefined();
    expect(saga2.getId()).toEqual("2");

    const saga2Values = await saga2.getValues();
    expect(saga2Values).toBeDefined();
    expect(saga2Values.id).toEqual('2');
    expect(saga2Values.status).toEqual(SagaStatus.Created);
    done();
  });

  describe('when working with a saga', () => {
    let saga: Saga;

    beforeEach(async (done) => {
      saga = await brokkr.createSaga();
      done();
    });

    it('can create a bunch of saga steps', async (done) => {
      const step1 = await saga.addStep('worker1', ['2']);
      expect(step1).toBeDefined();
      const step1Id = step1.getId();
      if (!step1Id) {
        throw Error('expected id to be defined');
      }
      const step2 = await saga.addStep('worker2', ['hello'], [step1Id])
      expect(step2).toBeDefined();
      const step1Values = await step1.getValues();
      expect(step1Values.id).toEqual('1');
      expect(step1Values.args[0]).toEqual('2');
      expect(step1Values.dependsOn).toEqual([])
      expect(step1Values.workerName).toEqual('worker1');
      expect(step1Values.status).toEqual(SagaStepStatus.Created);

      const step2Values = await step2.getValues();
      expect(step2Values.id).toEqual('2');
      expect(step2Values.args[0]).toEqual('hello');
      expect(step2Values.dependsOn).toEqual([step1Id]);
      expect(step2Values.workerName).toEqual('worker2');
      expect(step2Values.status).toEqual(SagaStepStatus.Created);
      done();
    });

    describe('when executing a simple (one-step) saga', () => {
      let step: SagaStep;
      let stepId: string;
      const workerName = 'createResource';
      const compensatorName = 'deleteResource';
      const args = ['exampleArg1', 'exampleArg2']

      beforeEach(async (done) => {
        step = await saga.addStep(workerName, args);
        expect(step).toBeDefined();
        stepId = step.getId() || '';
        if (stepId === '') {
          throw Error('expected id to be defined');
        }
        done();
      });

      it('enqueues jobs correctly', async (done) => {
        let stepValues = await step.getValues();
        expect(stepValues.status).toEqual(SagaStepStatus.Created);
        await saga.start();

        stepValues = await step.getValues();
        expect(stepValues.status).toEqual(SagaStepStatus.Queued);

        done();
      });

      it('creates a step object in the queue that contains all required data', async (done) => {
        await saga.start();

        const stepValues = await step.getValues();
        expect(stepValues.id).toEqual(stepId);
        expect(stepValues.args).toEqual(args);
        expect(stepValues.dependsOn).toEqual([]);
        expect(stepValues.workerName).toEqual(workerName);
        expect(stepValues.compensatorId).not.toBeDefined();
        expect(stepValues.result).not.toBeDefined();
        expect(stepValues.dependencyArgs).toEqual([]);

        done();
      });

      it('marks the step and saga as finished once its notified that the worker finished', async (done) => {
        await saga.start();

        // The step gets enqueued, simulate that the worker ran and succeded
        await saga.stepFinished(stepId, { exampleResultField: 'hello world'});

        const sagaValues = await saga.getValues();
        expect(sagaValues.status).toEqual(SagaStatus.Finished);

        const stepValues = await step.getValues();
        expect(stepValues.status).toEqual(SagaStepStatus.Finished);

        done();
      });

      it('allows to configure a compensator', async (done) => {
        const compensatorStep = await step.compensateWith(compensatorName, []);

        await saga.start();

        // Validate that the compensator was created in wating mode
        const compensatorValues = await compensatorStep.getValues();
        const stepValues = await step.getValues();
        expect(compensatorValues.status).toEqual(SagaStepStatus.WaitingForCompensation);
        expect(compensatorValues.dependsOn).toEqual([stepId]);
        expect(stepValues.compensatorId).toEqual(compensatorValues.id);

        done();
      });

      it('rollbacks a successful step on saga failure', async (done) => {
        const compensatorStep = await step.compensateWith(compensatorName, []);

        await saga.start();

        // Validate that the compensator was created in wating mode
        let compensatorValues = await compensatorStep.getValues();
        expect(compensatorValues.status).toEqual(SagaStepStatus.WaitingForCompensation);

        // The step gets enqueued, simulate that the worker ran and succeded
        const exampleResult = { exampleResultField: 'hello world'};
        await saga.stepFinished(stepId, exampleResult);

        // We then simulate a rollback (it's not a real case as the saga succeeded but works as a test).
        await saga.stepFailed(stepId);

        compensatorValues = await compensatorStep.getValues();
        const stepValues = await step.getValues();

        expect(compensatorValues.status).toEqual(SagaStepStatus.Queued);
        expect(compensatorValues.dependencyArgs).toEqual([exampleResult]);
        expect(stepValues.status).toEqual(SagaStepStatus.RolledBack);
        done();
      });

      describe('when executing a multi-step saga', () => {
        /**
         * thirdStep depends on [step, secondStep]
         */
        let secondStep: SagaStep;
        let secondStepId: string;

        let thirdStep: SagaStep;
        let thirdStepId: string;
        const secondStepArgs = ['exampleArg3', 'exampleArg4']
        const thirdStepArgs = ['exampleArg3', 'exampleArg4']

        beforeEach(async (done) => {
          secondStep = await saga.addStep(workerName, secondStepArgs);
          secondStepId = secondStep.getId() || '';
          if (secondStepId === '') {
            throw Error('expected id to be defined');
          }

          thirdStep = await saga.addStep(workerName, thirdStepArgs, [stepId, secondStepId]);
          thirdStepId = thirdStep.getId() || '';
          if (thirdStepId === '') {
            throw Error('expected id to be defined');
          }
          done();
        });

        it('enqueues initial jobs correctly, while not enqueueing dependent steps', async (done) => {
          let stepValues = await secondStep.getValues();
          expect(stepValues.status).toEqual(SagaStepStatus.Created);
          await saga.start();

          stepValues = await secondStep.getValues();
          expect(stepValues.status).toEqual(SagaStepStatus.Queued);

          const thirdStepValues = await thirdStep.getValues();
          expect(thirdStepValues.status).toEqual(SagaStepStatus.Created);

          done();
        });

        it('marks the initial steps as finished and enqueues the dependent steps once its notified that the initial workers finished', async (done) => {
          await saga.start();

          let sagaValues = await saga.getValues();
          let stepValues = await step.getValues();
          let secondStepValues = await secondStep.getValues();
          let thirdStepValues = await thirdStep.getValues();

          expect(sagaValues.status).toEqual(SagaStatus.Running);
          expect(stepValues.status).toEqual(SagaStepStatus.Queued);
          expect(secondStepValues.status).toEqual(SagaStepStatus.Queued);
          expect(thirdStepValues.status).toEqual(SagaStepStatus.Created);

          // The step gets enqueued, simulate that the worker ran and succeded
          await saga.stepFinished(stepId, { exampleResultField: 'hello world'});
          await saga.stepFinished(secondStepId, { exampleResultField: 'hello world from second step'});

          sagaValues = await saga.getValues();
          stepValues = await step.getValues();
          secondStepValues = await secondStep.getValues();
          thirdStepValues = await thirdStep.getValues();

          expect(sagaValues.status).toEqual(SagaStatus.Running);
          expect(stepValues.status).toEqual(SagaStepStatus.Finished);
          expect(secondStepValues.status).toEqual(SagaStepStatus.Finished);
          expect(thirdStepValues.status).toEqual(SagaStepStatus.Queued);

          // The third step gets enqueued, simulate that the worker ran and succeded
          await saga.stepFinished(thirdStepId, { anotherExampleResultField: 'third step'});

          sagaValues = await saga.getValues();
          stepValues = await step.getValues();
          secondStepValues = await secondStep.getValues();
          thirdStepValues = await thirdStep.getValues();

          expect(sagaValues.status).toEqual(SagaStatus.Finished);
          expect(stepValues.status).toEqual(SagaStepStatus.Finished);
          expect(secondStepValues.status).toEqual(SagaStepStatus.Finished);
          expect(thirdStepValues.status).toEqual(SagaStepStatus.Finished);

          done();
        });

        it('forwards the results from a step to its dependencies', async (done) => {
          await saga.start();

          // The step gets enqueued, simulate that the worker ran and succeded
          const firstStepResult = { exampleResultField: 'hello world'};
          const secondStepResult = { exampleResultField: 'hello world from second step'};

          await saga.stepFinished(stepId, firstStepResult);
          await saga.stepFinished(secondStepId, secondStepResult);

          const thirdStepValues = await thirdStep.getValues();

          // Note that this array must always be in the order of the declared deps
          expect(thirdStepValues.dependencyArgs).toEqual([firstStepResult, secondStepResult])

          done();
        });

        it('allows to configure a compensator', async (done) => {
          const compensatorStep = await step.compensateWith(compensatorName, []);

          await saga.start();

          // Validate that the compensator was created in wating mode
          const compensatorValues = await compensatorStep.getValues();
          const stepValues = await step.getValues();
          expect(compensatorValues.status).toEqual(SagaStepStatus.WaitingForCompensation);
          expect(compensatorValues.dependsOn).toEqual([stepId]);
          expect(stepValues.compensatorId).toEqual(compensatorValues.id);

          done();
        });

        it('rollbacks a successful step on saga failure', async (done) => {
          const compensatorStep = await step.compensateWith(compensatorName, []);

          await saga.start();

          // Validate that the compensator was created in wating mode
          let compensatorValues = await compensatorStep.getValues();
          expect(compensatorValues.status).toEqual(SagaStepStatus.WaitingForCompensation);

          // The step gets enqueued, simulate that the worker ran and succeded
          const exampleResult = { exampleResultField: 'hello world'};
          await saga.stepFinished(stepId, exampleResult);

          // We then simulate a rollback (this time this is a real example).
          await saga.stepFailed(secondStepId);

          compensatorValues = await compensatorStep.getValues();
          const stepValues = await step.getValues();
          const sagaValues = await saga.getValues();

          expect(compensatorValues.status).toEqual(SagaStepStatus.Queued);
          expect(compensatorValues.dependencyArgs).toEqual([exampleResult]);
          expect(stepValues.status).toEqual(SagaStepStatus.RolledBack);
          expect(sagaValues.status).toEqual(SagaStatus.Failed);
          done();
        });
      });
    });


  });

})