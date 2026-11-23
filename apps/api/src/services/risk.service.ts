import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { lockedBalance } from './ledger.service.js';

/**
 * Fraud controls shared by payouts, deliveries, chat and sign-in:
 * - money holds (card deposits, new earners' proceeds) and withdrawal limits by trust level;
 * - cool-downs after risky account changes, and staff freezes;
 * - risk flags (linked devices and bank accounts, odd patterns) for the staff Risk queue.
 */

export const HOURS = 3600_000;
/** Card deposits can be spent at once but withdrawn only after this long. */
export const DEPOSIT_HOLD_HOURS = 48;
/** New sellers' and riders' proceeds wait this long, so a dispute can still claw them back. */
export const NEW_EARNER_HOLD_DAYS = 5;
/** Sellers and riders with fewer completed jobs than this are "new". */
export const TRUSTED_AFTER_JOBS = 10;
/** New riders can only carry orders up to this value. */
export const NEW_RIDER_LIMIT_KOBO = 5_000_000;
/** Pay-on-delivery limit for buyers without two completed orders. */
export const NEW_BUYER_POD_LIMIT_KOBO = 5_000_000;
/** Buyers who refused this many pay-on-delivery orders must pay first. */
export const POD_REFUSAL_LIMIT = 2;

const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

/** Raises a flag for staff; at most one open flag per user, kind and related account. */
export async function flag(
  q: Query,
  userId: string,
  kind: string,
  detail: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM',
  related: string | null = null,
) {
  await q.query(
    'INSERT INTO risk_flags(id,user_id,related_user_id,kind,severity,detail) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
    [randomUUID(), userId, related, kind, severity, detail],
  );
}

/** A security notice by push and email (the "security" kind is never muted). */
export async function securityAlert(q: Query, userId: string, title: string, body: string) {
  await notify(q, userId, 'security', title, body);
}

/** Pauses withdrawals for a while after a risky change, and tells the account holder. */
export async function lockMoney(q: Query, userId: string, hours: number, reason: string) {
  await q.query(
    'UPDATE users SET money_locked_until=GREATEST(COALESCE(money_locked_until,now()),now()+make_interval(hours=>$1)),money_lock_reason=$2 WHERE id=$3',
    [hours, reason, userId],
  );
  await securityAlert(
    q,
    userId,
    'Withdrawals paused for your safety',
    `Because of a ${reason}, withdrawals are paused for ${hours} hours. If this wasn’t you, change your password and contact support now.`,
  );
}

/** Blocks frozen accounts from moving money or taking jobs. */
export async function ensureNotFrozen(q: Query, userId: string) {
  const [u] = await q.query('SELECT frozen_at,frozen_reason FROM users WHERE id=$1', [userId]);
  ensure(
    !u?.frozen_at,
    423,
    'ACCOUNT_FROZEN',
    'This account is on hold while our team reviews it. Contact support.',
  );
}

/** A stable hash of a bank account, to spot the same account on several users. */
export const accountHash = (bankCode: string, accountNumber: string) =>
  createHash('sha256').update(`${bankCode}:${accountNumber}`).digest('hex');

/** Completed jobs as a seller (orders) or rider (deliveries). */
async function completedJobs(q: Query, userId: string) {
  const [r] = await q.query(
    `SELECT (SELECT COUNT(*) FROM bookings WHERE seller_id=$1 AND status='COMPLETED')
          + (SELECT COUNT(*) FROM deliveries WHERE driver_id=$1 AND status='DELIVERED') AS n`,
    [userId],
  );
  return Number(r.n);
}

/** Withdrawal limits by trust level: basic, BVN verified, or verified with a track record. */
export async function payoutLimits(q: Query, userId: string) {
  const [u] = await q.query(
    'SELECT created_at,bvn_verified_at,money_locked_until,money_lock_reason,frozen_at FROM users WHERE id=$1',
    [userId],
  );
  const jobs = await completedJobs(q, userId);
  const verified = !!u.bvn_verified_at;
  const level =
    verified && jobs >= TRUSTED_AFTER_JOBS ? 'TRUSTED' : verified ? 'VERIFIED' : 'BASIC';
  const limits = {
    BASIC: { daily: 10_000_000, monthly: 50_000_000 },
    VERIFIED: { daily: 100_000_000, monthly: 500_000_000 },
    TRUSTED: { daily: 500_000_000, monthly: 2_000_000_000 },
  }[level];
  // Brand-new accounts start lower whatever their level.
  const newAccount = Date.now() - new Date(u.created_at).getTime() < 7 * 24 * HOURS;
  const daily = newAccount ? Math.min(limits.daily, 5_000_000) : limits.daily;
  const [used] = await q.query(
    `SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE created_at>now()-interval '1 day'),0)::bigint AS day,
            COALESCE(SUM(amount_kobo) FILTER (WHERE created_at>now()-interval '30 days'),0)::bigint AS month
     FROM payouts WHERE user_id=$1 AND status NOT IN ('REJECTED','CANCELLED','FAILED')`,
    [userId],
  );
  const locked =
    u.money_locked_until && new Date(u.money_locked_until) > new Date()
      ? u.money_locked_until
      : null;
  return {
    level,
    daily_limit_kobo: daily,
    monthly_limit_kobo: limits.monthly,
    daily_used_kobo: Number(used.day),
    monthly_used_kobo: Number(used.month),
    locked_until: locked as string | null,
    lock_reason: locked ? (u.money_lock_reason as string) : null,
    frozen: !!u.frozen_at,
    new_earner: jobs < TRUSTED_AFTER_JOBS,
  };
}

/** Money that can't be withdrawn yet from a ledger account. */
export async function heldKobo(q: Query, userId: string, account: string) {
  if (account === 'wallet') {
    const [r] = await q.query(
      `SELECT COALESCE(SUM(amount_kobo-refunded_kobo),0)::bigint AS held FROM funding
       WHERE user_id=$1 AND status='SUCCESSFUL' AND purpose='wallet' AND credited_at>now()-make_interval(hours=>$2)`,
      [userId, DEPOSIT_HOLD_HOURS],
    );
    return Number(r.held);
  }
  if (account === 'seller_payable' && (await completedJobs(q, userId)) < TRUSTED_AFTER_JOBS) {
    const [r] = await q.query(
      `SELECT COALESCE(SUM(amount_kobo),0)::bigint AS held FROM ledger
       WHERE owner_id=$1 AND account='seller_payable' AND amount_kobo>0 AND created_at>now()-make_interval(days=>$2)`,
      [userId, NEW_EARNER_HOLD_DAYS],
    );
    return Number(r.held);
  }
  return 0;
}

/** Balance minus money on hold. */
export async function withdrawable(q: Query, userId: string, account: string) {
  const balance = await lockedBalance(q, userId, account);
  return Math.max(0, balance - (await heldKobo(q, userId, account)));
}

/** Names on a bank account and the person's verified or profile name share first and last name. */
export function namesAgree(accountName: string, ...names: (string | null | undefined)[]) {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1),
    );
  const account = words(accountName);
  return names.some((n) => {
    if (!n) return false;
    const w = [...words(n)];
    return w.length >= 2 && w.filter((x) => account.has(x)).length >= 2;
  });
}

/**
 * Every check before money leaves Ahia: not frozen, no cool-down, a bank account in the person's
 * own name, enough money past its hold, and within the daily and monthly limits.
 */
export async function guardWithdrawal(
  q: Query,
  userId: string,
  account: {
    name_match?: boolean;
    account_name?: string;
    staff_allowed_at?: string | null;
  } & Record<string, any>,
  sourceAccount: string,
  amount: number,
) {
  await ensureNotFrozen(q, userId);
  const limits = await payoutLimits(q, userId);
  if (limits.locked_until)
    throw new AppError(
      423,
      'MONEY_LOCKED',
      `For your safety, withdrawals are paused until ${new Date(limits.locked_until).toLocaleString('en-NG')} after a ${limits.lock_reason}.`,
    );
  const [u] = await q.query('SELECT name,verified_name FROM users WHERE id=$1', [userId]);
  ensure(
    account.name_match ||
      !!account.staff_allowed_at ||
      namesAgree(String(account.account_name ?? ''), u.verified_name, u.name),
    409,
    'NAME_MISMATCH',
    'Withdrawals only go to a bank account in your own name. Add your own account, or ask support to check it.',
  );
  if (sourceAccount === 'wallet' || sourceAccount === 'seller_payable') {
    const free = await withdrawable(q, userId, sourceAccount);
    const held = await heldKobo(q, userId, sourceAccount);
    ensure(
      amount <= free,
      409,
      'FUNDS_ON_HOLD',
      held > 0
        ? sourceAccount === 'wallet'
          ? `${naira(held)} from recent card top-ups can be withdrawn ${DEPOSIT_HOLD_HOURS} hours after payment. You can withdraw up to ${naira(free)} now.`
          : `${naira(held)} of new earnings is held for ${NEW_EARNER_HOLD_DAYS} days in case of disputes. You can withdraw up to ${naira(free)} now.`
        : 'This is more than you can withdraw.',
    );
  }
  ensure(
    limits.daily_used_kobo + amount <= limits.daily_limit_kobo,
    409,
    'DAILY_LIMIT',
    `Your daily withdrawal limit is ${naira(limits.daily_limit_kobo)} (${naira(Math.max(0, limits.daily_limit_kobo - limits.daily_used_kobo))} left today). Verify your BVN to raise it.`,
  );
  ensure(
    limits.monthly_used_kobo + amount <= limits.monthly_limit_kobo,
    409,
    'MONTHLY_LIMIT',
    `Your monthly withdrawal limit is ${naira(limits.monthly_limit_kobo)}.`,
  );
}

/** Accounts that share a device or bank account with this one. */
export async function linkedAccounts(q: Query, a: string, b: string) {
  const [r] = await q.query(
    `SELECT EXISTS(SELECT 1 FROM user_devices x JOIN user_devices y ON y.device_id=x.device_id WHERE x.user_id=$1 AND y.user_id=$2) AS device,
            EXISTS(SELECT 1 FROM payout_accounts x JOIN payout_accounts y ON y.account_hash=x.account_hash WHERE x.user_id=$1 AND y.user_id=$2 AND x.account_hash IS NOT NULL) AS bank,
            EXISTS(SELECT 1 FROM users x JOIN users y ON y.phone=x.phone WHERE x.id=$1 AND y.id=$2) AS phone`,
    [a, b],
  );
  return r.device || r.bank || r.phone
    ? r.device
      ? 'device'
      : r.bank
        ? 'bank account'
        : 'phone'
    : null;
}

const seen = new Map<string, number>();
/**
 * Records the device an account uses (at most once an hour per account and device) and flags
 * accounts that share it. Runs outside the request's transaction; errors are ignored.
 */
export async function recordDevice(
  db: Database,
  userId: string,
  deviceId: string,
  ip: string | undefined,
  userAgent: string | undefined,
) {
  const key = `${userId}:${deviceId}`;
  if ((seen.get(key) ?? 0) > Date.now() - HOURS) return;
  seen.set(key, Date.now());
  if (seen.size > 50_000) seen.clear();
  await db.transaction(async (q) => {
    await q.query(
      `INSERT INTO user_devices(user_id,device_id,ip,user_agent) VALUES($1,$2,$3,$4)
       ON CONFLICT(user_id,device_id) DO UPDATE SET last_seen=now(),ip=EXCLUDED.ip,user_agent=EXCLUDED.user_agent`,
      [userId, deviceId, ip?.slice(0, 64) ?? null, userAgent?.slice(0, 300) ?? null],
    );
    const others = await q.query(
      'SELECT user_id FROM user_devices WHERE device_id=$1 AND user_id<>$2 ORDER BY first_seen LIMIT 20',
      [deviceId, userId],
    );
    for (const o of others)
      await flag(
        q,
        userId,
        'SHARED_DEVICE',
        'Signs in on the same device as another account.',
        'LOW',
        o.user_id,
      );
    if (others.length >= 2)
      await flag(
        q,
        userId,
        'MANY_ACCOUNTS_ONE_DEVICE',
        `${others.length + 1} accounts use one device.`,
        'HIGH',
      );
  });
}

/** Words and numbers that usually mean "pay me outside the app". */
const OFF_PLATFORM = [
  /\b\d{10}\b/,
  /\b(acct|account)\s*(no|number|num)\b/i,
  /\b(opay|palmpay|moniepoint|kuda|paga)\b/i,
  /\b(pay|transfer|send)\s+(me\s+)?(direct(ly)?|outside|to my)\b/i,
  /\bbank\s+transfer\b/i,
  /\bpay\s+(cash|before)\b/i,
];
export const OFF_PLATFORM_WARNING =
  'Only pay inside Ahia. Payments outside the app — bank transfers, cash or other apps — are not protected and can’t be refunded.';
export const looksOffPlatform = (text: string) => OFF_PLATFORM.some((re) => re.test(text));

/** Hourly checks for patterns staff should see. */
export async function riskSweep(db: Database) {
  await db.transaction(async (q) => {
    // Withdrawal soon after a card top-up of a similar amount.
    const quick = await q.query(
      `SELECT p.user_id,p.amount_kobo FROM payouts p
       WHERE p.created_at>now()-interval '1 day' AND p.source_account='wallet'
         AND EXISTS(SELECT 1 FROM funding f WHERE f.user_id=p.user_id AND f.status='SUCCESSFUL' AND f.purpose='wallet'
                    AND f.credited_at>p.created_at-interval '3 days' AND f.amount_kobo>=p.amount_kobo/2)`,
    );
    for (const r of quick)
      await flag(
        q,
        r.user_id,
        'DEPOSIT_THEN_WITHDRAW',
        `Asked to withdraw ${naira(Number(r.amount_kobo))} within 3 days of a card top-up.`,
        'MEDIUM',
      );
    // The same bank account on more than one user.
    const shared = await q.query(
      `SELECT a.user_id,b.user_id AS other FROM payout_accounts a JOIN payout_accounts b
         ON b.account_hash=a.account_hash AND b.user_id<>a.user_id WHERE a.active AND a.account_hash IS NOT NULL`,
    );
    for (const r of shared)
      await flag(
        q,
        r.user_id,
        'SHARED_BANK_ACCOUNT',
        'Uses the same bank account as another user.',
        'HIGH',
        r.other,
      );
    // Buyers who only buy from one seller they share a device with (fake reviews, promotion farming).
    const loyal = await q.query(
      `SELECT b.buyer_id,b.seller_id,COUNT(*)::int AS n FROM bookings b
       WHERE b.created_at>now()-interval '30 days' GROUP BY b.buyer_id,b.seller_id HAVING COUNT(*)>=5
         AND COUNT(*)=(SELECT COUNT(*) FROM bookings x WHERE x.buyer_id=b.buyer_id AND x.created_at>now()-interval '30 days')`,
    );
    for (const r of loyal)
      if (await linkedAccounts(q, r.buyer_id, r.seller_id))
        await flag(
          q,
          r.buyer_id,
          'SELF_DEALING',
          `${r.n} orders in 30 days, all from one seller linked to this account.`,
          'HIGH',
          r.seller_id,
        );
    // Several messages asking to pay outside the app.
    const chatty = await q.query(
      `SELECT sender_id,COUNT(*)::int AS n FROM messages WHERE warning IS NOT NULL AND created_at>now()-interval '7 days'
       GROUP BY sender_id HAVING COUNT(*)>=3`,
    );
    for (const r of chatty)
      await flag(
        q,
        r.sender_id,
        'OFF_PLATFORM_PAYMENT',
        `${r.n} messages this week look like requests to pay outside Ahia.`,
        'MEDIUM',
      );
    // Many new accounts from one device in a day.
    const farms = await q.query(
      `SELECT device_id,array_agg(user_id) AS users FROM user_devices WHERE first_seen>now()-interval '1 day'
       GROUP BY device_id HAVING COUNT(*)>=3`,
    );
    for (const r of farms)
      for (const u of r.users)
        await flag(
          q,
          u,
          'ACCOUNT_FARM',
          `${r.users.length} accounts started on one device today.`,
          'HIGH',
        );
  });
}

// ---------- staff: the Risk queue ----------
export function createRiskService(deps: AppDeps) {
  const { db } = deps;
  async function listRisk(_user: any, input: RequestInput) {
    const status = input.query.status === 'CLEARED' ? 'CLEARED' : 'OPEN';
    const rows = await db.query(
      `SELECT f.*,u.name,u.email,u.phone,u.frozen_at,u.bvn_verified_at,u.created_at AS joined_at,
         r.name AS related_name,c.name AS cleared_by_name,
         (SELECT json_build_object('id',a.id,'account_name',a.account_name,'bank_name',a.bank_name,'last4',a.account_last4,'allowed',a.staff_allowed_at IS NOT NULL) FROM payout_accounts a WHERE a.user_id=f.user_id AND a.active) AS payout_account,
         (SELECT COUNT(*)::int FROM risk_flags o WHERE o.user_id=f.user_id AND o.status='OPEN') AS open_flags
       FROM risk_flags f JOIN users u ON u.id=f.user_id LEFT JOIN users r ON r.id=f.related_user_id
       LEFT JOIN users c ON c.id=f.cleared_by
       WHERE f.status=$1
       ORDER BY CASE f.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,f.created_at DESC LIMIT 300`,
      [status],
    );
    return rows.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      detail: r.detail,
      status: r.status,
      created_at: r.created_at,
      user: {
        id: r.user_id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        frozen: !!r.frozen_at,
        bvn_verified: !!r.bvn_verified_at,
        joined_at: r.joined_at,
        open_flags: r.open_flags,
      },
      related: r.related_user_id ? { id: r.related_user_id, name: r.related_name } : null,
      payout_account: r.payout_account ?? null,
      cleared_by: r.cleared_by_name ?? null,
      cleared_at: r.cleared_at ?? null,
      note: r.note ?? null,
    }));
  }
  async function clearRisk(q: Query, u: any, input: RequestInput) {
    const d = z.object({ note: z.string().trim().min(3).max(500) }).parse(input.body);
    const [f] = await q.query(
      "UPDATE risk_flags SET status='CLEARED',cleared_by=$1,cleared_at=now(),note=$2 WHERE id=$3 AND status='OPEN' RETURNING id",
      [u.id, d.note, input.params.id],
    );
    ensure(f, 404, 'NOT_FOUND', 'That flag is not open.');
    await audit(q, u.id, 'risk.clear', f.id, d);
    return { ok: true };
  }
  /** Freezes an account: no withdrawals, orders, pay on delivery or delivery jobs. */
  async function freezeUser(q: Query, u: any, input: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(3).max(500) }).parse(input.body);
    const [t] = await q.query(
      'UPDATE users SET frozen_at=now(),frozen_reason=$1 WHERE id=$2 AND NOT admin RETURNING id',
      [d.reason, input.params.id],
    );
    ensure(t, 404, 'NOT_FOUND', 'Account not found (staff accounts can’t be frozen here).');
    // Drivers stop receiving jobs straight away.
    await q.query('UPDATE drivers SET online=FALSE WHERE user_id=$1', [t.id]);
    await audit(q, u.id, 'user.freeze', t.id, d);
    await notify(
      q,
      t.id,
      'security',
      'Your account is on hold',
      'Our team is reviewing recent activity. Withdrawals and new orders are paused. Contact support if you have questions.',
    );
    return { ok: true };
  }
  async function unfreezeUser(q: Query, u: any, input: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(3).max(500) }).parse(input.body);
    const [t] = await q.query(
      'UPDATE users SET frozen_at=NULL,frozen_reason=NULL WHERE id=$1 AND frozen_at IS NOT NULL RETURNING id',
      [input.params.id],
    );
    ensure(t, 404, 'NOT_FOUND', 'That account is not frozen.');
    await audit(q, u.id, 'user.unfreeze', t.id, d);
    await notify(q, t.id, 'security', 'Your account is active again', 'Thanks for your patience.');
    return { ok: true };
  }
  /** Lets withdrawals go to a bank account whose name doesn't match, after staff checked it. */
  async function allowPayoutAccount(q: Query, u: any, input: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(3).max(500) }).parse(input.body);
    const [a] = await q.query(
      'UPDATE payout_accounts SET staff_allowed_by=$1,staff_allowed_at=now() WHERE id=$2 AND active RETURNING id,user_id',
      [u.id, input.params.id],
    );
    ensure(a, 404, 'NOT_FOUND', 'Active bank account not found.');
    await audit(q, u.id, 'payout_account.allow', a.id, d);
    return { ok: true };
  }
  return { listRisk, clearRisk, freezeUser, unfreezeUser, allowPayoutAccount };
}
