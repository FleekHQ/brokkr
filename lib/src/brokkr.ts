import IClient from './clients/iclient';
import Saga from './entities/saga';
import { IWorker } from './interfaces';

class Brokkr {
  private client: IClient;
  private namespace: string;
  private workers: IWorker[] = [];

  constructor(client: IClient, namespace: string = '') {
    this.client = client;
    this.namespace = namespace;
  }

  public async createSaga(): Promise<Saga> {
    const saga = new Saga(this.client, this.namespace);
    await saga.create();
    return saga;
  }

  public async loadPendingSagas(): Promise<Saga> {
    throw Error('TODO: Implement this in case the service running this lib has to be restarted mid-process');
  }

  public registerWorker(worker: IWorker) {
    this.workers.push(worker);
  }
}

export default Brokkr;
