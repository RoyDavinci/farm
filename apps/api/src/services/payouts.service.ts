import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { Database, Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { balance, ledger, lockedBalance } from './ledger.service.js';
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

/** Business logic for payouts requests. HTTP-free: callers pass plain input. */
export function createPayoutsService(deps: AppDeps) {
  const { db, config: c } = deps;
  const service = payoutService(db, c);
  const { payments } = service;
  const approvedSeller = async (q: Query, uid: string) => {
    // Sellers and drivers both withdraw their earnings through payouts.
    const [s] = await q.query(
      "SELECT s.business_name,(s.status='APPROVED' OR d.status='APPROVED') AS approved FROM users u LEFT JOIN sellers s ON s.user_id=u.id LEFT JOIN drivers d ON d.user_id=u.id WHERE u.id=$1",
      [uid],
    );
    ensure(
      s?.approved,
      403,
      'SELLER_NOT_APPROVED',
      'An approved seller or driver account is required for payouts.',
    );
    return s;
  };
  const accountInput = z.object({
    bank_code: z.string().trim().min(3).max(10),
    account_number: z.string().regex(/^\d{10}$/, 'Enter the 10-digit NUBAN account number.'),
  });
  async function resolve(u: any, d: z.infer<typeof accountInput>) {
    const p = service.provider();
    if (p === 'simulated') {
      const bank = demoBanks.find((b) => b.code === d.bank_code);
      ensure(bank, 400, 'INVALID_BANK', 'Choose a bank from the list.');
      return { provider: p, bank_name: bank.name, account_name: u.name.toUpperCase() };
    }
    const banks = await payments.banks(p);
    const bank = banks.find((b) => b.code === d.bank_code);
    ensure(bank, 400, 'INVALID_BANK', 'Choose a bank from the list.');
    const { account_name } = await payments.resolveAccount(p, d.account_number, d.bank_code);
    return { provider: p, bank_name: bank.name, account_name };
  }
  async function listBanks(user: any, input: RequestInput) {
    const p = service.provider();
    return { provider: p, banks: p === 'simulated' ? demoBanks : await payments.banks(p) };
  }
  async function resolveAccount(user: any, input: RequestInput) {
    const u = user;
    await approvedSeller(db, u.id);
    const d = accountInput.parse(input.body);
    const s = await db.query('SELECT business_name FROM sellers WHERE user_id=$1', [u.id]);
    const resolved = await resolve(u, d);
    return {
      ...resolved,
      name_match: namesMatch(resolved.account_name, u.name, s[0]?.business_name || ''),
    };
  }
  async function getPayoutSummary(user: any, input: RequestInput) {
    const u = user;
    const [seller] = await db.query(
      'SELECT u.id FROM users u WHERE u.id=$1 AND (EXISTS(SELECT 1 FROM sellers WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM drivers WHERE user_id=u.id))',
      [u.id],
    );
    ensure(seller, 403, 'SELLER_REQUIRED', 'Payouts are available to sellers and drivers.');
    const [account] = await db.query(
      'SELECT id,provider,bank_code,bank_name,account_last4,account_name,name_match,created_at FROM payout_accounts WHERE user_id=$1 AND active',
      [u.id],
    );
    const [settings] = await db.query(
      'SELECT payout_min_kobo,payout_fee_kobo FROM settings WHERE id=1',
    );
    return {
      account: account || null,
      available_kobo: await balance(db, u.id, 'seller_payable'),
      min_kobo: settings.payout_min_kobo,
      fee_kobo: settings.payout_fee_kobo,
      mode: c.payments ? 'provider' : c.demo ? 'simulated' : 'disabled',
      payouts: await db.query(
        'SELECT p.id,p.amount_kobo,p.fee_kobo,p.status,p.failure_reason,p.created_at,p.updated_at,a.bank_name,a.account_last4 FROM payouts p JOIN payout_accounts a ON a.id=p.account_id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 50',
        [u.id],
      ),
    };
  }
  async function requestPayout(q: Query, u: any, input: RequestInput) {
    await approvedSeller(q, u.id);
    const d = z.object({ amount_kobo: z.number().int().min(1).max(1000000000) }).parse(input.body);
    const [settings] = await q.query(
      'SELECT payout_min_kobo,payout_fee_kobo FROM settings WHERE id=1',
    );
    const [account] = await q.query('SELECT * FROM payout_accounts WHERE user_id=$1 AND active', [
      u.id,
    ]);
    ensure(account, 400, 'NO_PAYOUT_ACCOUNT', 'Add a verified bank account first.');
    ensure(
      d.amount_kobo >= settings.payout_min_kobo,
      400,
      'PAYOUT_TOO_SMALL',
      `The minimum payout is ₦${(settings.payout_min_kobo / 100).toLocaleString()}.`,
    );
    ensure(
      d.amount_kobo > settings.payout_fee_kobo,
      400,
      'PAYOUT_TOO_SMALL',
      'The payout must be larger than the transfer fee.',
    );
    // users row is already locked by mutate(), so this balance check cannot race.
    ensure(
      (await lockedBalance(q, u.id, 'seller_payable')) >= d.amount_kobo,
      409,
      'INSUFFICIENT_PROCEEDS',
      'This is more than your available proceeds.',
    );
    const pid = randomUUID();
    const [payout] = await q.query(
      'INSERT INTO payouts(id,user_id,account_id,amount_kobo,fee_kobo) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [pid, u.id, account.id, d.amount_kobo, settings.payout_fee_kobo],
    );
    await ledger(q, pid, [
      { account: 'seller_payable', owner: u.id, amount: -d.amount_kobo },
      { account: 'payout_pending', owner: pid, amount: d.amount_kobo },
    ]);
    await audit(q, u.id, 'payout.request', pid, { amount_kobo: d.amount_kobo });
    return payout;
  }
  async function cancelPayout(q: Query, u: any, input: RequestInput) {
    const [p] = await q.query('SELECT * FROM payouts WHERE id=$1 AND user_id=$2 FOR UPDATE', [
      input.params.id,
      u.id,
    ]);
    ensure(p, 404, 'NOT_FOUND', 'Payout not found.');
    ensure(
      p.status === 'REQUESTED',
      409,
      'INVALID_TRANSITION',
      'Only payouts awaiting review can be cancelled.',
    );
    await ledger(q, p.id, [
      { account: 'payout_pending', owner: p.id, amount: -Number(p.amount_kobo) },
      { account: 'seller_payable', owner: u.id, amount: Number(p.amount_kobo) },
    ]);
    await q.query("UPDATE payouts SET status='CANCELLED',updated_at=now() WHERE id=$1", [p.id]);
    await audit(q, u.id, 'payout.cancel', p.id);
    return { ok: true };
  }
  /** Checks the bank account with the provider (outside any transaction). */
  async function prepareAccount(u: any, input: RequestInput) {
    const d = accountInput.parse(input.body);
    const s = await approvedSeller(db, u.id);
    // Provider calls happen outside the DB transaction; the result is stored atomically below.
    const resolved = await resolve(u, d);
    const recipient =
      resolved.provider === 'paystack'
        ? await payments.createRecipient(resolved.account_name, d.account_number, d.bank_code)
        : null;
    return { d, s, resolved, recipient };
  }
  /** Stores the verified account; runs inside the caller's transaction. */
  async function saveAccount(
    q: Query,
    u: any,
    { d, s, resolved, recipient }: Awaited<ReturnType<typeof prepareAccount>>,
  ) {
    const [busy] = await q.query(
      "SELECT id FROM payouts WHERE user_id=$1 AND status IN ('REQUESTED','PROCESSING')",
      [u.id],
    );
    ensure(
      !busy,
      409,
      'PAYOUT_IN_PROGRESS',
      'Wait for your current payout to finish before changing bank details.',
    );
    await q.query('UPDATE payout_accounts SET active=FALSE WHERE user_id=$1 AND active', [u.id]);
    const [account] = await q.query(
      'INSERT INTO payout_accounts(id,user_id,provider,bank_code,bank_name,account_last4,account_cipher,account_name,recipient_code,name_match) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,provider,bank_code,bank_name,account_last4,account_name,name_match,created_at',
      [
        randomUUID(),
        u.id,
        resolved.provider,
        d.bank_code,
        resolved.bank_name,
        d.account_number.slice(-4),
        encryptAccount(c, d.account_number),
        resolved.account_name,
        recipient,
        namesMatch(resolved.account_name, u.name, s.business_name || ''),
      ],
    );
    await audit(q, u.id, 'payout_account.save', account.id, {
      bank: resolved.bank_name,
      last4: account.account_last4,
      name_match: account.name_match,
    });
    await notify(
      q,
      u.id,
      'security',
      'Payout bank account changed',
      `Payouts will now go to ${resolved.bank_name} ••••${account.account_last4}. If this was not you, contact support immediately.`,
    );
    return account;
  }
  return {
    listBanks,
    resolveAccount,
    prepareAccount,
    saveAccount,
    getPayoutSummary,
    requestPayout,
    cancelPayout,
  };
}

/** Business logic for adminpayouts requests. HTTP-free: callers pass plain input. */
export function createAdminPayoutsService(deps: AppDeps) {
  const { db, config: c } = deps;
  const service = payoutService(db, c);
  async function listPayouts(user: any, input: RequestInput) {
    return await db.query(
      "SELECT p.*,a.bank_name,a.account_last4,a.account_name,a.name_match,u.name AS seller_name,s.business_name FROM payouts p JOIN payout_accounts a ON a.id=p.account_id JOIN users u ON u.id=p.user_id LEFT JOIN sellers s ON s.user_id=p.user_id ORDER BY (p.status IN ('REQUESTED','PROCESSING')) DESC,p.created_at DESC LIMIT 200",
    );
  }
  async function approvePayout(user: any, input: RequestInput) {
    // Step 1: claim the payout so a double click cannot send two transfers.
    const claimed = await db.transaction(async (q) => {
      const [p] = await q.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [input.params.id]);
      ensure(p, 404, 'NOT_FOUND', 'Payout not found.');
      ensure(
        p.status === 'REQUESTED',
        409,
        'INVALID_TRANSITION',
        `This payout is already ${p.status.toLowerCase()}.`,
      );
      const provider = service.provider();
      await q.query(
        "UPDATE payouts SET status='PROCESSING',provider=$1,reviewed_by=$2,reviewed_at=now(),updated_at=now() WHERE id=$3",
        [provider, user.id, p.id],
      );
      await audit(q, user.id, 'payout.approve', p.id, { provider });
      const [a] = await q.query('SELECT * FROM payout_accounts WHERE id=$1', [p.account_id]);
      return { p: { ...p, status: 'PROCESSING' } as any, a, provider };
    });
    const { p, a, provider } = claimed;
    // Step 2: send the transfer. The payout id is the provider reference, so retries are deduplicated.
    let outcome: { id: string | null; status: TransferStatus; reason?: string };
    if (provider === 'simulated') outcome = { id: `sim-${p.id}`, status: 'PAID' };
    else {
      try {
        const t = await service.payments.transfer(provider, {
          reference: p.id,
          amount: Number(p.amount_kobo) - Number(p.fee_kobo),
          recipient: a.recipient_code,
          bankCode: a.bank_code,
          accountNumber: decryptAccount(c, a.account_cipher),
          reason: 'Farmers Market seller payout',
        });
        outcome = { id: t.id, status: t.status };
      } catch (e) {
        // A rejected request never reached the bank; unavailable/timeouts stay PROCESSING for recheck.
        if (e instanceof AppError && e.code === 'PROVIDER_REJECTED')
          outcome = { id: null, status: 'FAILED', reason: 'The provider rejected the transfer.' };
        else outcome = { id: null, status: 'PROCESSING' };
      }
    }
    const result = await db.transaction(async (q) => {
      const [locked] = await q.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [p.id]);
      if (outcome.id)
        await q.query('UPDATE payouts SET provider_id=$1 WHERE id=$2', [outcome.id, p.id]);
      return service.settle(q, locked, outcome.status, outcome.reason);
    });
    return result;
  }
  async function rejectPayout(q: Query, u: any, input: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(3).max(500) }).parse(input.body);
    const [p] = await q.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(p, 404, 'NOT_FOUND', 'Payout not found.');
    ensure(
      p.status === 'REQUESTED',
      409,
      'INVALID_TRANSITION',
      'Only payouts awaiting review can be rejected.',
    );
    await ledger(q, p.id, [
      { account: 'payout_pending', owner: p.id, amount: -Number(p.amount_kobo) },
      { account: 'seller_payable', owner: p.user_id, amount: Number(p.amount_kobo) },
    ]);
    const [updated] = await q.query(
      "UPDATE payouts SET status='REJECTED',failure_reason=$1,reviewed_by=$2,reviewed_at=now(),updated_at=now() WHERE id=$3 RETURNING *",
      [d.reason, u.id, p.id],
    );
    await audit(q, u.id, 'payout.reject', p.id, d);
    await notify(
      q,
      p.user_id,
      'payout',
      'Payout not approved',
      `${d.reason} The amount was returned to your proceeds.`,
    );
    return updated;
  }
  async function recheckPayout(user: any, input: RequestInput) {
    const [p] = await db.query('SELECT * FROM payouts WHERE id=$1', [input.params.id]);
    ensure(p, 404, 'NOT_FOUND', 'Payout not found.');
    ensure(
      p.status === 'PROCESSING' && p.provider !== 'simulated',
      409,
      'INVALID_TRANSITION',
      'Only provider payouts in progress can be rechecked.',
    );
    const v = await service.payments.verifyTransfer(p.provider, p.id, p.provider_id);
    const status =
      v.status === 'PAID' && v.amount !== Number(p.amount_kobo) - Number(p.fee_kobo)
        ? 'PROCESSING'
        : v.status;
    const result = await db.transaction(async (q) => {
      const [locked] = await q.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [p.id]);
      await audit(q, user.id, 'payout.recheck', p.id, { provider_status: v.status });
      return service.settle(q, locked, status);
    });
    return result;
  }
  return { listPayouts, approvePayout, rejectPayout, recheckPayout };
}
