import {RedisClient} from 'redis';
import { Brokkr, buildInMemoryClient, IClient, Saga, SagaStep } from '../../../src';
import { IWorker } from '../../../src/interfaces';
import redisClientBuilder from '../../helpers/redis-client-builder';

describe('Brokkr integration tests', () => {
  let brokkr: Brokkr;
  let client: IClient;

  const namespace = 'MyCoolNamespace';

  beforeEach((done) => {
    // Reset db after each test
    client = buildInMemoryClient();
    brokkr = new Brokkr(client, namespace, {}, {pollingIntervalInMs: 100});
    done();
  });


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
    });

    describe('when brokkr is started with an already existing previous state', () => {
      let brokkr2: Brokkr;
      let sagaId: string;
      beforeEach(() => {
        sagaId = saga.getId() || '';
        if(sagaId === '') {
          throw Error('saga must be initialized.');
        }
      })

      it('restores the previous sagas', async (done) => {
        brokkr2 = new Brokkr(client, namespace);
        expect(brokkr2.getSaga(sagaId)).not.toBeDefined();
        await brokkr2.restorePreviousState();
        expect(brokkr2.getSaga(sagaId)).toBeDefined();
        done();
      });



    })

  });
});