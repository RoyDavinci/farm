import type { Config } from '../config/index.js';
import type { Database } from '../database/client.js';
import { logger } from '../lib/logger.js';
import { uncertain, verifyFunding } from './funding.service.js';
import { paymentService, type Provider } from './payment-provider.service.js';

/** How long hosted checkout links stay payable before we stop polling the provider. */
const PAYABLE_HOURS = 72;
/** Provider checks per run, and the minimum gap between checks of one funding row. */
const BATCH = 20;
const RECHECK_MINUTES = 10;

/**
 * Background recovery for wallet top-ups (run by the job scheduler):
 * 1. A checkout whose server died mid-preparation (intent past its lease) becomes UNCERTAIN, so the
 *    buyer sees it in Wallet and a retry gets a clear answer instead of waiting.
 * 2. Pending or uncertain top-ups are re-verified with the provider, so a buyer who paid but whose
 *    webhook was lost is credited without pressing "Verify". Crediting goes through verifyFunding,
 *    which only credits once and only for the exact amount and currency.
 * 3. After the payable window, unpaid top-ups are marked EXPIRED. A late signed webhook or a manual
 *    verify can still credit them, because verifyFunding trusts the provider, not our status.
 */
export async function recoverFunding(db: Database, c: Config) {
  const released = await db.transaction(async (q) => {
    const stale = await q.query<{ actor_id: string; key: string; current_reference: string }>(
      "SELECT actor_id,key,current_reference FROM funding_intents WHERE status='INITIALIZING' AND lease_until<now() ORDER BY lease_until LIMIT 100 FOR UPDATE SKIP LOCKED",
    );
    for (const s of stale) {
      await q.query(
        "UPDATE funding_intents SET status='UNCERTAIN',error=$1,updated_at=now() WHERE actor_id=$2 AND key=$3",
        [JSON.stringify(uncertain), s.actor_id, s.key],
      );
      await q.query("UPDATE funding SET status='UNCERTAIN' WHERE id=$1 AND status='INITIALIZING'", [
        s.current_reference,
      ]);
      await q.query(
        "UPDATE payment_attempts SET status='UNCERTAIN',error_code='INTERRUPTED' WHERE funding_reference=$1 AND status='INITIALIZING'",
        [s.current_reference],
      );
    }
    // Rows left INITIALIZING without a live intent (e.g. an abandoned fallback attempt).
    await q.query(
      "UPDATE funding f SET status='UNCERTAIN' WHERE f.status='INITIALIZING' AND f.created_at<now()-interval '15 minutes' AND NOT EXISTS(SELECT 1 FROM funding_intents i WHERE i.current_reference=f.id AND i.status='INITIALIZING' AND i.lease_until>now())",
    );
    return stale.length;
  });

  let credited = 0;
  const payments = paymentService(c);
  if (c.payments) {
    const due = await db.query<{ id: string; provider: Provider }>(
      `SELECT id,provider FROM funding WHERE status IN ('PENDING','UNCERTAIN')
         AND created_at<now()-interval '2 minutes' AND created_at>now()-interval '${PAYABLE_HOURS} hours'
         AND (checked_at IS NULL OR checked_at<now()-interval '${RECHECK_MINUTES} minutes')
       ORDER BY checked_at NULLS FIRST,created_at LIMIT ${BATCH}`,
    );
    for (const f of due) {
      await db.query('UPDATE funding SET checked_at=now() WHERE id=$1', [f.id]);
      if (!payments.enabled(f.provider)) continue;
      try {
        await verifyFunding(db, c, payments, f.id);
        credited++;
      } catch {
        // Not paid yet, or the provider never created it: try again later.
      }
    }
  }

  const [expired] = await db.query<{ n: number }>(
    `WITH e AS (UPDATE funding SET status='EXPIRED' WHERE status IN ('PENDING','UNCERTAIN') AND created_at<now()-interval '${PAYABLE_HOURS} hours' RETURNING 1) SELECT COUNT(*)::int AS n FROM e`,
  );
  if (released || credited || expired.n)
    logger.info('funding recovery', { released, credited, expired: expired.n });
  return { released, credited, expired: expired.n };
}
