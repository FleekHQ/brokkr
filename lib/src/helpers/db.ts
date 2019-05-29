import { IClient } from '../clients';
import { ITableMeta } from '../interfaces';

const META_TABLE = 'meta';

const getTable = (namespace: string, tableName: string) => `${namespace}_${tableName}`;

export const create = async <T>(client: IClient, namespace: string, tableName: string, values: T) => {
  const oldTableMeta = await client.get<ITableMeta>(getTable(namespace, META_TABLE), tableName);

  // If there are no previous declarations for this table, create one
  let newTableMeta: ITableMeta;
  if (!oldTableMeta) {
    newTableMeta = { lastId: 1 };
    await client.set(getTable(namespace, META_TABLE), tableName, newTableMeta);
  } else {
    // else, increment the lastId value
    newTableMeta = { lastId: oldTableMeta.lastId + 1 };
    await client.set(getTable(namespace, META_TABLE), tableName, newTableMeta);
  }

  // store the new tuple
  const id = newTableMeta.lastId.toString();
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
  const newValues = await client.get<T>(getTable(namespace, tableName), id);
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
