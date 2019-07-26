import { IClient } from '../clients';
const uuid = require('uuid/v1');

const getTable = (namespace: string, tableName: string) => `${namespace}_${tableName}`;

export const create = async <T>(client: IClient, namespace: string, tableName: string, values: T) => {
  const id = uuid();
  const newValues = {
    id,
    ...values,
  };
  await client.set<T>(getTable(namespace, tableName), id, newValues);
  return newValues;
};

export const update = async <T>(client: IClient, namespace: string, tableName: string, id: string, values: T) => {
  const oldValues = await client.get<T>(getTable(namespace, tableName), id);
  await client.set<T>(getTable(namespace, tableName), id, {
    ...oldValues,
    ...values,
  });
};

export const get = async <T>(client: IClient, namespace: string, tableName: string, id: string) => {
  const values = await client.get<T>(getTable(namespace, tableName), id);
  return values;
};

export const getIds = async (client: IClient, namespace: string, tableName: string) => {
  const result = await client.getKeys(getTable(namespace, tableName));
  return result;
};

export const getMultiple = async <T>(client: IClient, namespace: string, tableName: string, ids: string[]) => {
  const result = await client.getMultiple<T>(getTable(namespace, tableName), ids);
  return result;
};
