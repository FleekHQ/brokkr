import { IHashMap } from '../interfaces';

interface IClient {
  set<T>(table: string, key: string, value: T): Promise<boolean>;
  get<T>(table: string, key: string): Promise<T>;
  getKeys(table: string): Promise<string[]>;
  getMultiple<T>(table: string, keyArray: string[]): Promise<T[]>;
}

export default IClient;
