import compression from 'compression';
import cors from 'cors';
import type { Express, RequestHandler } from 'express';
import helmet from 'helmet';
import type { Config } from '../config/index.js';

/**
 * Transport and browser security:
 * - helmet: strict headers for a JSON API (deny framing, no sniffing, HSTS in production,
 *   a locked-down CSP for the few HTML pages such as the payment return page);
 * - CORS: only the configured web origins may call the API from a browser; native apps send no
 *   Origin header and are unaffected. Credentials (cookies) are never used.
 * - trust proxy: honour X-Forwarded-For only from the configured number of proxy hops, so rate
 *   limits see the real client IP behind a load balancer.
 */
export function applySecurity(app: Express, c: Config) {
  app.disable('x-powered-by');
  app.set('trust proxy', c.trustProxy);
  app.use(
    helmet({
      // Product photos are loaded cross-origin by the web and native apps.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          styleSrc: ["'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: c.production ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());
}

export function corsPolicy(c: Config): RequestHandler {
  return cors({
    origin(origin, cb) {
      cb(null, !origin || c.origins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-Id',
      // Team members working on a shop account (middleware/authenticate.ts).
      'X-Act-As-Seller',
      'X-Device-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  });
}
