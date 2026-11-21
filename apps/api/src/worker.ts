import { config } from './config/index.js';
import { connect } from './database/client.js';
import { startWorkers } from './jobs/scheduler.js';
import { events } from './lib/events.js';
import { logger } from './lib/logger.js';
import { connectRedis } from './lib/redis.js';
const db = connect(config.databaseUrl);
// Jobs create notifications; with Redis, connected apps on every API instance refresh at once.
const redis = config.redisUrl ? connectRedis(config.redisUrl, 'worker') : null;
if (redis) events.useRedis(redis);
const stop = startWorkers(db, config);
logger.info('Ahia worker started');
async function shutdown() {
  stop();
  await db.close();
  await redis?.quit();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
