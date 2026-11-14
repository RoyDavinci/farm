import type { Config } from '../config/index.js';
import type { Database } from '../database/client.js';
import { logger } from '../lib/logger.js';
import { expireReservations } from '../services/booking.service.js';
import { deliverNotifications } from '../services/communications.service.js';
import { recoverFunding } from '../services/funding-recovery.service.js';
import { deliverPush } from '../services/push.service.js';
interface Job {
  name: string;
  every: number;
  run: () => Promise<unknown>;
}

/**
 * Background jobs: reservation expiry, email and push delivery, and auth cleanup.
 * Runs inside the API by default, or alone via `npm run worker` (set RUN_WORKERS=false on the API).
 * Every job is safe to run in several processes at once: work is claimed with row locks.
 */
export function startWorkers(db: Database, c: Config) {
  const jobs: Job[] = [
    { name: 'reservation-expiry', every: 30000, run: () => expireReservations(db) },
    { name: 'email', every: 5000, run: () => deliverNotifications(db, c) },
    { name: 'push', every: 5000, run: () => deliverPush(db, c) },
    { name: 'funding-recovery', every: 60000, run: () => recoverFunding(db, c) },
    {
      name: 'auth-cleanup',
      every: 3600000,
      run: () =>
        db.transaction(async (q) => {
          await q.query("DELETE FROM otp_challenges WHERE expires_at<now()-interval '1 day'");
          await q.query('DELETE FROM consumed_refresh_tokens WHERE expires_at<now()');
          await q.query('DELETE FROM sessions WHERE refresh_expires_at<now()');
        }),
    },
  ];
  const timers = jobs.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      const started = Date.now();
      try {
        await job.run();
        await db.prisma.workerHeartbeat.upsert({
          where: { name: job.name },
          create: { name: job.name, beat_at: new Date() },
          update: { beat_at: new Date(), last_error: null },
        });
        logger.debug('job completed', { job: job.name, ms: Date.now() - started });
      } catch (err) {
        logger.error('job failed', { job: job.name, err });
        const last_error = String((err as Error)?.message || err).slice(0, 300);
        await db.prisma.workerHeartbeat
          .upsert({
            where: { name: job.name },
            create: { name: job.name, beat_at: new Date(), last_error },
            update: { last_error },
          })
          .catch(() => {});
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), job.every);
    timer.unref();
    return timer;
  });
  return () => timers.forEach(clearInterval);
}
