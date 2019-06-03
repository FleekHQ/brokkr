import IClient from './iclient';

interface IInmemoryKey {
  table: string,
  key: string,
}

const buildInMemoryClient = (memory?: Map<string, any>): IClient => {
  const memoryMap = memory || new Map<string, any>();
  const set = <T>(table: string, key: string, value: T) => {
    return new Promise<boolean>((resolve) => {
      const formattedValue = JSON.stringify(value);
      memoryMap.set(JSON.stringify({table, key}), formattedValue);
      resolve(true);
    });
  };

  const get = <T>(table: string, key: string) => {
    return new Promise<T>((resolve, reject) => {
      const res = memoryMap.get(JSON.stringify({table, key}));
      if (res === undefined) { resolve(undefined); }

      let parsedJSON;
      try {
        parsedJSON = JSON.parse(res);
      } catch (err) {
        reject(`Could not parse JSON key when fetching from memory: ${err.message}`);
      }
      resolve(parsedJSON);
    });
  };

  const getKeys = (table: string) => {
    return new Promise<string[]>((resolve) => {
      const keys = Array.from(memoryMap.keys());
      const res = keys.filter(key => JSON.parse(key).table === table);
      resolve(res.map(key => JSON.parse(key).key));
    });
  };

  const getMultiple = <T>(table: string, keyArray: string[]) => {
    return new Promise<T[]>((resolve) => {
      if (keyArray.length === 0) {
        return resolve([]);
      }
      const promises = keyArray.map(async (key) => {
        const value = await get<T>(table, key);
        return value;
      });

      Promise.all(promises).then(res => {
        resolve(res)
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

export default buildInMemoryClient;
