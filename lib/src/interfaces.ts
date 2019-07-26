import { Saga } from './entities';

export interface IHashMap {
  [key: string]: any;
}

export interface IWorker {
  name: string;
  run(args: any[], dependencyArgs: any[], saga: Saga, stepId: string): Promise<any> | any;
}
