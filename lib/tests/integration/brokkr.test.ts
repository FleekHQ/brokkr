import {RedisClient} from 'redis';
import { Brokkr, buildRedisClient, IClient, Saga, SagaStatus, SagaStep, SagaStepStatus } from '../../src';
import redisClientBuilder from '../helpers/redis-client-builder';
import { IWorker } from '../../src/interfaces';

describe('Brokkr integration tests', () => {
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

  describe('when working with a saga and a worker', () => {
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
      brokkr.registerWorker(worker);
      done();
    });

    afterEach(() => {
      brokkr.stopWorkers();
    })

    it('can get the saga', () => {
      const sagaId = saga.getId();
      if (!sagaId) {throw Error('This shouldnt throw');}
      expect(brokkr.getSaga(sagaId)).toEqual(saga);
    });

    it('can get the worker', () => {
      expect(brokkr.getWorker(workerName)).toEqual(worker);
    });

    it('can register multiple workers in one go', () => {
      const worker2 = {
        name: "example",
        run: workerMock,
      }
      const worker3 = {
        name: "example2",
        run: workerMock,
      }

      brokkr.registerWorkers(worker2, worker3);

      expect(brokkr.getWorker("example")).toEqual(worker2);
      expect(brokkr.getWorker("example2")).toEqual(worker3);

    })

  });
});