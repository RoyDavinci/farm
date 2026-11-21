import { EventEmitter } from 'node:events';
import type { RedisClient } from './redis.js';
import { logger } from './logger.js';

const CHANNEL = 'ahia:user-sync';

/**
 * "Something changed for this user" events that the realtime hub turns into a client refresh.
 * In-process by default; with Redis, events published by any API or worker instance reach the
 * sockets connected to every instance.
 */
class EventBus {
  private local = new EventEmitter().setMaxListeners(0);
  private publisher: RedisClient | null = null;

  /**
   * Switch to Redis pub/sub. `subscriber` must be a dedicated connection; omit it in processes
   * that only publish (the background worker).
   */
  useRedis(publisher: RedisClient, subscriber?: RedisClient) {
    this.publisher = publisher;
    if (!subscriber) return;
    void subscriber
      .subscribe(CHANNEL)
      .catch((err) => logger.error('redis subscribe failed', { error: (err as Error).message }));
    subscriber.on('message', (channel, userId) => {
      if (channel === CHANNEL) this.local.emit('sync', userId);
    });
  }

  /** Announce that a user's data changed. Call after commit (see Query.afterCommit). */
  userChanged(userId: string) {
    if (this.publisher)
      void this.publisher.publish(CHANNEL, userId).catch(() => this.local.emit('sync', userId));
    else this.local.emit('sync', userId);
  }

  onUserChanged(handler: (userId: string) => void) {
    this.local.on('sync', handler);
    return () => void this.local.off('sync', handler);
  }
}

export const events = new EventBus();
