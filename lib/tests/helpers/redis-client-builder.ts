import {RedisClient} from 'redis';
import redis = require('redis');

const redisClient = (defaultHost = 'localhost', defaultPort = 6379): RedisClient => {
  let client;

  const REDISHOST = process.env.REDISHOST || defaultHost;
  const REDISPORT = process.env.REDISPORT ? parseInt(process.env.REDISPORT, 10) : defaultPort;
  if (REDISHOST) {
    client = redis.createClient(REDISPORT, REDISHOST, {});
  } else {
    process.env.REDIS_URL = 'redis://redis';
    client = redis.createClient();
  }
  client.on('error', err => console.error('ERR:REDIS:', err));
  return client;
};

export default redisClient;