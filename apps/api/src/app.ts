import express from 'express';
import type { Config } from './config/index.js';
import type { Database } from './database/client.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createMutate } from './middleware/idempotency.js';
import { createLimiters } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { requireStaff } from './middleware/require-staff.js';
import { applySecurity, corsPolicy } from './middleware/security.js';
import { healthRoutes } from './routes/health.routes.js';
import { apiRoutes, publicFileRoutes } from './routes/index.js';
import type { AppDeps } from './types/deps.js';

/** Builds the Express app. Kept free of side effects so tests can create instances freely. */
export function createApp(db: Database, config: Config) {
  const app = express();
  const deps: AppDeps = { db, config, mutate: createMutate(db) };

  applySecurity(app, config);
  app.use(requestLogger);
  // Accept /api/v1/* as an alias of /v1/* for deployments behind an /api path prefix.
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/v1/')) req.url = req.url.slice(4);
    next();
  });

  app.use(healthRoutes(deps));
  // Public images and short-lived signed file links (no CORS needed: loaded as resources).
  app.use(publicFileRoutes(deps));

  app.use(corsPolicy(config));
  app.use(
    express.json({
      limit: '100kb',
      // Webhook signatures are computed over the exact raw body.
      verify(req, _res, buf) {
        (req as any).rawBody = buf;
      },
    }),
  );
  const limiters = createLimiters(config);
  app.use('/v1', limiters.api);
  app.use(
    '/v1',
    apiRoutes(deps, { authenticate: authenticate(db), requireStaff, authLimiter: limiters.auth }),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
