import { createApp } from './app.js';
import { config } from './config/index.js';
import { connect } from './database/client.js';
import { startWorkers } from './jobs/scheduler.js';
import { events } from './lib/events.js';
import { logger } from './lib/logger.js';
import { connectRedis } from './lib/redis.js';
import { attachRealtime } from './realtime/socket.js';
import { expireReservations } from './services/booking.service.js';

// Schema changes are applied by `npm run db:migrate` (prisma migrate deploy) as a release step.
const db = connect(config.databaseUrl);
await db.query('SELECT 1');
// With Redis, rate limits and realtime events are shared by every API and worker instance.
const redis = config.redisUrl ? connectRedis(config.redisUrl, 'api') : null;
const redisSubscriber = config.redisUrl ? connectRedis(config.redisUrl, 'api-events') : null;
if (redis && redisSubscriber) events.useRedis(redis, redisSubscriber);
else if (config.production)
  logger.warn('REDIS_URL is not set: rate limits and live updates are per instance.');
await expireReservations(db);

const server = createApp(db, config, redis).listen(config.port, config.host, () =>
  logger.info(`Farmers Market API listening on :${config.port}`, { env: config.env }),
);
// Keep idle connections open slightly longer than typical load balancer timeouts (60s).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

const closeRealtime = attachRealtime(server, db, config);
// Set RUN_WORKERS=false when `npm run worker` runs as its own deployment.
const stopWorkers = config.runWorkers ? startWorkers(db, config) : () => {};

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info('Shutting down', { signal });
  const force = setTimeout(() => {
    logger.error('Forced exit: shutdown timed out');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  force.unref();
  stopWorkers();
  closeRealtime();
  server.close(async () => {
    await db.close();
    await Promise.allSettled([redis?.quit(), redisSubscriber?.quit()]);
    logger.info('Shutdown complete');
    process.exit(0);
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) =>
  logger.error('Unhandled promise rejection', { reason }),
);
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err });
  void shutdown('uncaughtException');
});
