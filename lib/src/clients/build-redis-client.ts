import { RedisClient } from 'redis';
import IClient from './iclient';

const buildRedisClient = (client: RedisClient): IClient => {
  const set = <T>(table: string, key: string, value: T) => {
    return new Promise<boolean>((resolve, reject) => {
      client.hset(table, key, JSON.stringify(value), err => {
        if (err) {
          reject(err);
        }
        resolve(true);
      });
    });
  };

  const get = <T>(table: string, key: string) => {
    return new Promise<T>((resolve, reject) => {
      client.hget(table, key, (err, res) => {
        if (err) {
          reject(err);
        }
        resolve(JSON.parse(res));
      });
    });
  };

  const getKeys = (table: string) => {
    return new Promise<string[]>((resolve, reject) => {
      client.hkeys(table, (err, res) => {
        if (err) {
          reject(err);
        }
        resolve(res);
      });
    });
  };

  const getMultiple = <T>(table: string, keyArray: string[]) => {
    return new Promise<T[]>((resolve, reject) => {
      client.hmget(table, keyArray, (err, res) => {
        if (err) {
          reject(err);
        }
        const parsedRes = res.map(json => JSON.parse(json));
        resolve(parsedRes);
      });
    });
  };

  const result = {
    get,
    getKeys,
    getMultiple,
    set,
  };
  return result;
};

export default buildRedisClient;
