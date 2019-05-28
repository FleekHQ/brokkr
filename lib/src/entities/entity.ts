import { IClient } from '../clients';
import { create, get } from '../helpers/db';
import { IHashMap } from '../interfaces';

export interface IEntity {
  id?: string;
}

abstract class Entity<T extends IEntity> {
  protected client: IClient;
  protected namespace: string;
  protected tableName: string;
  protected id: string | undefined = undefined;

  constructor(client: IClient, namespace: string, tableName: string, id?: string) {
    this.client = client;
    this.namespace = namespace;
    this.tableName = tableName;
    this.id = id;
  }

  public async create(initialValues: T) {
    const values = await create<T>(this.client, this.namespace, this.tableName, initialValues);
    this.instantiate(values);
    return values;
  }

  public instantiate(values: T) {
    this.id = values.id;
    return this;
  }

  public getId() {
    return this.id;
  }

  public async getValues(): Promise<T> {
    const id = this.getId();
    if (!id) {
      throw Error('Cannot get values from an uninitialized entity');
    }
    const result = await get<T>(this.client, this.namespace, this.tableName, id);
    return result;
  }
}

export default Entity;
