import {RedisClient} from 'redis';
import { Brokkr, buildRedisClient, IClient, Saga, SagaStep, SagaStatus, SagaStepStatus } from '../../src';
import redisClientBuilder from '../helpers/redis-client-builder';

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
      expect(step1Values.dependsOn[0]).not.toBeDefined()
      expect(step1Values.workerName).toEqual('worker1');
      expect(step1Values.status).toEqual(SagaStepStatus.Created);

      const step2Values = await step2.getValues();
      expect(step2Values.id).toEqual('2');
      expect(step2Values.args[0]).toEqual('hello');
      expect(step2Values.dependsOn[0]).toEqual(step1Id);
      expect(step2Values.workerName).toEqual('worker2');
      expect(step2Values.status).toEqual(SagaStepStatus.Created);
      done();
    })
  })

})