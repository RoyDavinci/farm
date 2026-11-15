import type { AppDeps } from '../types/deps.js';

/** Liveness and readiness checks: database, background jobs, queue backlogs and Redis. */
export function createHealthService(deps: AppDeps) {
  const { db, redis, config } = deps;
  async function liveness() {
    await db.query('SELECT 1');
    return {
      status: 'ok' as const,
      service: 'farmers-market-api',
      version: config.gitCommit || 'dev',
    };
  }
  async function readiness() {
    const workers = await db.query<{ name: string; age_s: number; last_error: string | null }>(
      'SELECT name,EXTRACT(EPOCH FROM now()-beat_at)::int AS age_s,last_error FROM worker_heartbeats',
    );
    const [backlog] = await db.query(
      "SELECT (SELECT COUNT(*)::int FROM notification_outbox WHERE status='PENDING' AND available_at<now()-interval '5 minutes') AS email_late,(SELECT COUNT(*)::int FROM push_outbox WHERE status='PENDING' AND available_at<now()-interval '5 minutes') AS push_late,(SELECT COUNT(*)::int FROM payouts WHERE status='PROCESSING' AND updated_at<now()-interval '1 day') AS payouts_stuck,(SELECT COUNT(*)::int FROM funding WHERE status='UNCERTAIN' AND created_at<now()-interval '1 hour') AS funding_uncertain",
    );
    let redisStatus: 'ok' | 'down' | 'not_configured' = 'not_configured';
    if (redis)
      redisStatus = await redis
        .ping()
        .then((r) => (r === 'PONG' ? 'ok' : 'down'))
        .catch(() => 'down' as const);
    const expiry = workers.find((b) => b.name === 'reservation-expiry');
    const healthy =
      !!expiry && expiry.age_s < 300 && backlog.email_late < 100 && redisStatus !== 'down';
    return {
      healthy,
      body: { status: healthy ? 'ready' : 'degraded', workers, backlog, redis: redisStatus },
    };
  }
  return { liveness, readiness };
}
