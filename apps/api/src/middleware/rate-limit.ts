import rateLimit, { type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Config } from '../config/index.js';
import type { RedisClient } from '../lib/redis.js';

/**
 * Per-IP request limits, created per app instance. With Redis the counters are shared by every
 * API instance (set TRUST_PROXY behind a load balancer so the real client IP is used); without
 * it each process counts on its own, which is fine for one instance.
 */
export function createLimiters(c: Config, redis?: RedisClient | null) {
  const store = (prefix: string): Store | undefined =>
    redis
      ? new RedisStore({
          prefix: `farmers-market:rl:${prefix}:`,
          sendCommand: (command: string, ...args: string[]) =>
            redis.call(command, ...args) as Promise<any>,
        })
      : undefined;
  return {
    api: rateLimit({
      windowMs: 60_000,
      limit: c.rateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      store: store('api'),
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
    // Sign-in, registration and code requests (on top of per-address OTP limits).
    auth: rateLimit({
      windowMs: 15 * 60_000,
      limit: c.authRateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      store: store('auth'),
      message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
    }),
  };
}
