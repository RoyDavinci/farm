import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';

/** Liveness and readiness probes for load balancers and uptime monitors. */
export function createHealthController(deps: AppDeps) {
  const { db } = deps;
  const liveness: RequestHandler = async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'farmers-market-api' });
  };
  const readiness: RequestHandler = async (_req, res) => {
    const beats = await db.query(
      'SELECT name,EXTRACT(EPOCH FROM now()-beat_at)::int AS age_s,last_error FROM worker_heartbeats',
    );
    const [backlog] = await db.query(
      "SELECT (SELECT COUNT(*)::int FROM notification_outbox WHERE status='PENDING' AND available_at<now()-interval '5 minutes') AS email_late,(SELECT COUNT(*)::int FROM push_outbox WHERE status='PENDING' AND available_at<now()-interval '5 minutes') AS push_late,(SELECT COUNT(*)::int FROM payouts WHERE status='PROCESSING' AND updated_at<now()-interval '1 day') AS payouts_stuck",
    );
    const expiry = beats.find((b) => b.name === 'reservation-expiry');
    const healthy = !!expiry && expiry.age_s < 300 && backlog.email_late < 100;
    res
      .status(healthy ? 200 : 503)
      .json({ status: healthy ? 'ready' : 'degraded', workers: beats, backlog });
  };
  return { liveness, readiness };
}
