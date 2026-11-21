import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { Database, Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
import { paymentService, type Provider } from './payment-provider.service.js';

/**
 * Refunds to the card, used when the wallet feature is off.
 *
 * Every refund in the app (cancelled or expired booking, cancelled delivery, dispute refund, a
 * checkout that could not be applied) first lands in the buyer's internal `wallet` ledger account.
 * With no wallet to spend it from, this job sends that money back to the original payment:
 *
 * 1. Allocate: a buyer's positive balance is split across their own verified payments, newest
 *    first, never more than each payment's unrefunded amount. Each part becomes a PENDING
 *    card_refund, and the money moves wallet → refund_pending in the same transaction.
 *    Fresh payments get a grace period so a delivery checkout can still be used.
 * 2. Send: a PENDING refund is marked SENDING (committed) before the provider is called, so it is
 *    never requested twice. Accepted → REFUNDED (refund_pending → provider_clearing).
 *    Rejected → FAILED. Unreachable → stays SENDING with an error. Both need staff.
 */
const GRACE_MINUTES = 30;
const BATCH = 20;

export async function allocateCardRefunds(db: Database) {
  const owners = await db.query<{ owner_id: string }>(
    `SELECT l.owner_id FROM ledger l WHERE l.account='wallet' GROUP BY l.owner_id HAVING SUM(l.amount_kobo)>0
       AND NOT EXISTS(SELECT 1 FROM funding f WHERE f.user_id=l.owner_id AND f.credited_at>now()-interval '${GRACE_MINUTES} minutes')
     LIMIT ${BATCH}`,
  );
  let queued = 0;
  for (const { owner_id } of owners)
    await db.transaction(async (q) => {
      let left = await lockedBalance(q, owner_id);
      const payments = await q.query(
        "SELECT * FROM funding WHERE user_id=$1 AND status='SUCCESSFUL' AND refunded_kobo<amount_kobo ORDER BY credited_at DESC NULLS LAST,created_at DESC FOR UPDATE",
        [owner_id],
      );
      for (const f of payments) {
        if (left <= 0) break;
        const amount = Math.min(left, f.amount_kobo - f.refunded_kobo);
        const id = randomUUID();
        await ledger(q, id, [
          { account: 'wallet', owner: owner_id, amount: -amount },
          { account: 'refund_pending', owner: id, amount },
        ]);
        await q.query(
          'INSERT INTO card_refunds(id,funding_id,user_id,provider,amount_kobo) VALUES($1,$2,$3,$4,$5)',
          [id, f.id, owner_id, f.provider, amount],
        );
        await q.query('UPDATE funding SET refunded_kobo=refunded_kobo+$1 WHERE id=$2', [
          amount,
          f.id,
        ]);
        left -= amount;
        queued++;
      }
      if (left > 0)
        logger.warn('balance has no card payment to refund against', { user: owner_id, left });
    });
  return queued;
}

async function settle(q: Query, r: any, outcome: 'REFUNDED' | 'FAILED', fields: object) {
  if (outcome === 'REFUNDED')
    await ledger(q, r.id, [
      { account: 'refund_pending', owner: r.id, amount: -r.amount_kobo },
      { account: 'provider_clearing', amount: r.amount_kobo },
    ]);
  const f = fields as { provider_refund_id?: string | null; error?: string | null };
  await q.query(
    'UPDATE card_refunds SET status=$1,provider_refund_id=COALESCE($2,provider_refund_id),error=$3,updated_at=now() WHERE id=$4',
    [outcome, f.provider_refund_id ?? null, f.error ?? null, r.id],
  );
}

export async function sendCardRefunds(db: Database, c: Config) {
  const payments = paymentService(c);
  const claimed = await db.transaction(async (q) => {
    const rows = await q.query(
      `SELECT r.*,f.provider_id,f.id AS reference FROM card_refunds r JOIN funding f ON f.id=r.funding_id
        WHERE r.status='PENDING' ORDER BY r.created_at LIMIT ${BATCH} FOR UPDATE OF r SKIP LOCKED`,
    );
    for (const r of rows)
      await q.query("UPDATE card_refunds SET status='SENDING',updated_at=now() WHERE id=$1", [
        r.id,
      ]);
    return rows;
  });
  for (const r of claimed) {
    let outcome: { status: 'REFUNDED' | 'FAILED' | 'SENDING'; id?: string | null; error?: string };
    try {
      ensure(payments.enabled(r.provider), 503, 'PROVIDER_DISABLED', 'Provider not configured.');
      const res = await payments.refund(
        r.provider as Provider,
        r.reference,
        r.provider_id,
        r.amount_kobo,
      );
      outcome = ['failed', 'reversed', 'error'].includes(res.status.toLowerCase())
        ? { status: 'FAILED', id: res.id, error: `Provider reported ${res.status}.` }
        : { status: 'REFUNDED', id: res.id };
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNKNOWN';
      outcome =
        code === 'PROVIDER_REJECTED' || code === 'PROVIDER_DISABLED'
          ? {
              status: 'FAILED',
              error:
                'The provider rejected the refund. Check the payment and retry or refund it manually.',
            }
          : {
              status: 'SENDING',
              error:
                'The refund request may or may not have reached the provider. Check the provider dashboard before retrying.',
            };
    }
    await db.transaction(async (q) => {
      const [locked] = await q.query(
        "SELECT * FROM card_refunds WHERE id=$1 AND status='SENDING' FOR UPDATE",
        [r.id],
      );
      if (!locked) return;
      if (outcome.status === 'SENDING')
        await q.query('UPDATE card_refunds SET error=$1,updated_at=now() WHERE id=$2', [
          outcome.error,
          r.id,
        ]);
      else
        await settle(q, locked, outcome.status, {
          provider_refund_id: outcome.id,
          error: outcome.error,
        });
    });
    if (outcome.status !== 'REFUNDED')
      logger.warn('card refund needs review', { refund: r.id, status: outcome.status });
  }
  return claimed.length;
}

/** Background job: only active when the wallet feature is off. */
export async function runCardRefunds(db: Database, c: Config) {
  if (c.features.wallet) return { queued: 0, sent: 0 };
  const queued = await allocateCardRefunds(db);
  const sent = await sendCardRefunds(db, c);
  return { queued, sent };
}

/** Finance staff: see refunds and settle ones the job could not (rejected or unknown outcome). */
export function createAdminRefundsService(deps: AppDeps) {
  const { db } = deps;
  async function listRefunds() {
    return db.query(
      `SELECT r.id,r.funding_id,r.user_id,u.name AS buyer_name,r.provider,r.amount_kobo,r.status,
              r.provider_refund_id,r.error,r.created_at,r.updated_at,
              (r.status='SENDING' AND r.updated_at<now()-interval '10 minutes') AS needs_review
         FROM card_refunds r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 200`,
    );
  }
  async function resolveRefund(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        outcome: z.enum(['REFUNDED', 'RETRY']),
        reason: z.string().trim().min(10).max(500),
      })
      .parse(input.body);
    const [r] = await q.query('SELECT * FROM card_refunds WHERE id=$1 FOR UPDATE', [
      input.params.id,
    ]);
    ensure(r, 404, 'NOT_FOUND', 'Refund not found.');
    ensure(
      r.status === 'FAILED' ||
        (r.status === 'SENDING' &&
          (r.error || Date.now() - new Date(r.updated_at).getTime() > 600_000)),
      409,
      'INVALID_TRANSITION',
      'Only a failed refund, or one whose outcome is unknown, can be resolved.',
    );
    await audit(q, u.id, 'refund.resolve', r.id, d);
    if (d.outcome === 'REFUNDED') await settle(q, r, 'REFUNDED', { error: null });
    else
      await q.query(
        "UPDATE card_refunds SET status='PENDING',error=NULL,updated_at=now() WHERE id=$1",
        [r.id],
      );
    const [fresh] = await q.query('SELECT * FROM card_refunds WHERE id=$1', [r.id]);
    return fresh;
  }
  return { listRefunds, resolveRefund };
}
