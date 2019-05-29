export interface IHashMap {
  [key: string]: any;
}

export interface ITableMeta {
  lastId: number;
}

export interface IWorker {
  name: string;
  run(args: any[], dependencyArgs?: any[]): void;
}
