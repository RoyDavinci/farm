import rateLimit from 'express-rate-limit';
import type { Config } from '../config/index.js';

/**
 * Per-IP request limits, created per app instance. Behind a load balancer set TRUST_PROXY so the
 * real client IP is used. With several API instances, each keeps its own counters; put a shared
 * limit at the edge (CDN/WAF) if you need a global cap.
 */
export function createLimiters(c: Config) {
  return {
    api: rateLimit({
      windowMs: 60_000,
      limit: c.rateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
    // Sign-in, registration and code requests (on top of per-address OTP limits).
    auth: rateLimit({
      windowMs: 15 * 60_000,
      limit: c.authRateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
    }),
  };
}
