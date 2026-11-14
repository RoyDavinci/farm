import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config/index.js';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import { notify } from './communications.service.js';
import { ledger } from './ledger.service.js';
import { paymentService, type Provider, type TransferStatus } from './payment-provider.service.js';

// Shown only when no provider is configured (local development). Clearly simulated.
export const demoBanks = [
  { code: '044', name: 'Access Bank (simulated)' },
  { code: '058', name: 'Guaranty Trust Bank (simulated)' },
  { code: '011', name: 'First Bank of Nigeria (simulated)' },
  { code: '033', name: 'United Bank for Africa (simulated)' },
  { code: '057', name: 'Zenith Bank (simulated)' },
  { code: '50211', name: 'Kuda Microfinance Bank (simulated)' },
  { code: '999992', name: 'OPay (simulated)' },
];

function key(c: Config) {
  ensure(c.payoutKey, 503, 'PAYOUTS_NOT_CONFIGURED', 'Payout encryption is not configured.');
  return createHash('sha256').update(c.payoutKey).digest();
}
export function encryptAccount(c: Config, accountNumber: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(c), iv);
  const data = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
export function decryptAccount(c: Config, value: string) {
  const [iv, tag, data] = value.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(c), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
/** True when most words of the bank's account name appear in the user's or business's name. */
export function namesMatch(accountName: string, ...names: string[]) {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  const known = new Set(names.flatMap(words));
  const account = words(accountName);
  if (!account.length) return false;
  return account.filter((w) => known.has(w)).length >= Math.min(2, account.length);
}

export function payoutService(db: Database, c: Config) {
  const payments = paymentService(c);
  const provider = (): Provider | 'simulated' => {
    if (c.payments) {
      const preferred = c.payoutProvider === 'flutterwave' ? 'flutterwave' : 'paystack';
      if (payments.enabled(preferred)) return preferred;
      const other = preferred === 'paystack' ? 'flutterwave' : 'paystack';
      if (payments.enabled(other)) return other;
    }
    ensure(c.demo, 503, 'PAYOUTS_DISABLED', 'Bank payouts are not enabled on this server.');
    return 'simulated';
  };
  /** Moves held funds out of payout_pending once a transfer settles or fails. Idempotent. */
  async function settle(q: Query, payout: any, status: TransferStatus, reason?: string) {
    if (['PAID', 'FAILED', 'REJECTED', 'CANCELLED'].includes(payout.status)) return payout;
    if (status === 'PROCESSING') return payout;
    const amount = Number(payout.amount_kobo),
      fee = Number(payout.fee_kobo);
    if (status === 'PAID') {
      await ledger(q, payout.id, [
        { account: 'payout_pending', owner: payout.id, amount: -amount },
        { account: 'provider_clearing', amount: amount - fee },
        ...(fee ? [{ account: 'platform_revenue', amount: fee }] : []),
      ]);
    } else {
      await ledger(q, payout.id, [
        { account: 'payout_pending', owner: payout.id, amount: -amount },
        { account: 'seller_payable', owner: payout.user_id, amount },
      ]);
    }
    const [updated] = await q.query(
      'UPDATE payouts SET status=$1,failure_reason=$2,updated_at=now() WHERE id=$3 RETURNING *',
      [
        status,
        status === 'FAILED' ? reason || 'Transfer failed at the provider.' : null,
        payout.id,
      ],
    );
    await notify(
      q,
      payout.user_id,
      'payout',
      status === 'PAID' ? 'Payout sent' : 'Payout failed',
      status === 'PAID'
        ? `₦${((amount - fee) / 100).toLocaleString()} has been sent to your bank account.`
        : `Your payout could not be completed and ₦${(amount / 100).toLocaleString()} was returned to your proceeds. ${reason || ''}`.trim(),
    );
    return updated;
  }
  return { payments, provider, settle };
}

/** Handles provider transfer webhooks. Returns false when the event is not a transfer event. */
export async function handleTransferWebhook(
  db: Database,
  c: Config,
  provider: Provider,
  body: any,
) {
  const event = String(body.event || body.type || '');
  const isTransfer =
    provider === 'paystack' ? event.startsWith('transfer.') : event === 'transfer.completed';
  if (!isTransfer) return false;
  const reference = body.data?.reference;
  if (typeof reference !== 'string') return true;
  const service = payoutService(db, c);
  // Never trust the webhook body for the outcome: verify with the provider.
  const [p] = await db.query('SELECT * FROM payouts WHERE id=$1 AND provider=$2', [
    reference,
    provider,
  ]);
  if (!p || p.status !== 'PROCESSING') return true;
  const v = await service.payments.verifyTransfer(provider, p.id, p.provider_id || body.data?.id);
  if (v.status === 'PAID' && v.amount !== Number(p.amount_kobo) - Number(p.fee_kobo)) return true;
  await db.transaction(async (q) => {
    const [locked] = await q.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [p.id]);
    await service.settle(q, locked, v.status);
  });
  return true;
}
