import {RedisClient} from 'redis';
import { Brokkr, buildRedisClient, IClient, Saga, SagaStatus, SagaStep, SagaStepStatus } from '../../src';
import redisClientBuilder from '../helpers/redis-client-builder';
import { IWorker } from '../../src/interfaces';

describe('Worker integration tests', () => {
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
      brokkr = new Brokkr(client, namespace, {pollingIntervalInMs: 100});
      done();
    });
  });

  afterAll((done) => {
    redisClient.quit(done)
  })

  describe('when working with a saga', () => {
    let saga: Saga;
    let step: SagaStep;
    let stepId: string;
    let worker: IWorker;
    let workerMock: jest.Mock;
    const workerName = 'createResource';
    const args = ['exampleArg1', 'exampleArg2']

    beforeEach(async (done) => {
      saga = await brokkr.createSaga();
      step = await saga.addStep(workerName, args);
      expect(step).toBeDefined();
      stepId = step.getId() || '';
      if (stepId === '') {
        throw Error('expected id to be defined');
      }
      workerMock = jest.fn();
      worker = {
        name: workerName,
        run: workerMock,
      }

      done();
    });

    afterEach(() => {
      brokkr.stopWorkers();
    })

    it('runs the worker and receives the arguments', async (done) => {
      brokkr.registerWorker(worker);

      brokkr.stopWorkers();
      let stepValues = await step.getValues();
      expect(stepValues.status).toEqual(SagaStepStatus.Created);
      await saga.start();

      stepValues = await step.getValues();
      expect(stepValues.status).toEqual(SagaStepStatus.Queued);

      brokkr.startWorkers();

      // Wait for a full tick to complete
      setTimeout(async () => {
        stepValues = await step.getValues();
        expect(stepValues.status).toEqual(SagaStepStatus.Running);
        expect(workerMock).toBeCalledTimes(1);
        expect(workerMock).toBeCalledWith(args, []);
        expect(brokkr.getQueueManager().getTotalRunning()).toEqual(1);

        // Finish the running process
        await saga.stepFinished(stepId);
        setTimeout(async () => {
          stepValues = await step.getValues();
          expect(stepValues.status).toEqual(SagaStepStatus.Finished);
          expect(brokkr.getQueueManager().getTotalRunning()).toEqual(0);
          done();
        }, 1000);
      }, 1000);
    });

    it('fails the saga if the worker has not been registered', async (done) => {
      brokkr.stopWorkers();
      let stepValues = await step.getValues();
      expect(stepValues.status).toEqual(SagaStepStatus.Created);
      await saga.start();

      stepValues = await step.getValues();
      expect(stepValues.status).toEqual(SagaStepStatus.Queued);

      brokkr.startWorkers();

      // Wait for a full tick to complete
      setTimeout(async () => {
        stepValues = await step.getValues();
        expect(stepValues.status).toEqual(SagaStepStatus.Failed);

        const sagaValues = await saga.getValues();
        expect(sagaValues.status).toEqual(SagaStatus.Failed);
        done();
      }, 2000);
    });
  });
});