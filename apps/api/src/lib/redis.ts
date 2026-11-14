import { Redis } from 'ioredis';
import { logger } from './logger.js';

/**
 * Redis connection used for shared rate-limit counters and realtime events across API instances.
 * Optional: without REDIS_URL each process keeps its own (fine for a single instance and tests).
 */
export function connectRedis(url: string, name: string) {
  const client = new Redis(url, {
    connectionName: `farmers-market:${name}`,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  client.on('error', (err) => logger.warn('redis connection error', { name, error: err.message }));
  return client;
}
export type RedisClient = Redis;
