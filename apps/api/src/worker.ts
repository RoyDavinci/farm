import { config } from './config/index.js';
import { connect } from './database/client.js';
import { startWorkers } from './jobs/scheduler.js';
import { logger } from './lib/logger.js';
const db = connect(config.databaseUrl);
const stop = startWorkers(db, config);
logger.info('Farmers Market worker started');
async function shutdown() {
  stop();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
