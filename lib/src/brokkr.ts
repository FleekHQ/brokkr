import IClient from './clients/iclient';
import Saga from './entities/saga';
import { IWorker } from './interfaces';
import QueueManager, {IQueueManagerOpts} from './queue-manager';

class Brokkr {
  private client: IClient;
  private namespace: string;
  private queueManager: QueueManager;

  constructor(client: IClient, namespace: string = '', queueOpts: IQueueManagerOpts = {}) {
    this.client = client;
    this.namespace = namespace;
    this.queueManager = new QueueManager(this.client, this.namespace, queueOpts);
    this.queueManager.start();
  }

  /**
   * Creates a Saga object and returns it.
   */
  public async createSaga(): Promise<Saga> {
    const saga = new Saga(this.client, this.namespace);
    await saga.create();
    this.queueManager.addSaga(saga);
    return saga;
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

  public async restart(): Promise<Saga> {
    throw Error('TODO: Implement this in case the service running this lib has to be restarted mid-process');
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
}

export default Brokkr;
