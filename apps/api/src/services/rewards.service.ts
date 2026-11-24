import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { ledger } from './ledger.service.js';
import {
  ensureNotFrozen,
  ensureVerifiedContact,
  flag,
  linkedAccounts,
  payoutLimits,
  withdrawable,
} from './risk.service.js';
import { checkTransactionPin } from './transaction-pin.service.js';

/**
 * Ahia IDs, wallet transfers, referral links and promo codes.
 *
 * Every account has a short public Ahia ID ("AH-48213957") used to receive transfers and as the
 * referral code. Rewards (referrals, promo codes) are Ahia credit: real wallet money that can be
 * spent straight away, but is held from withdrawals and transfers for `credit_hold_days`, so
 * rewards can't be farmed with fake accounts and cashed out. Rewards are paid from the
 * platform's marketing account.
 */

const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
/** "Chiamaka Obi" → "Chiamaka O." (enough to confirm, without showing the full name). */
export const shortName = (name: string) => {
  const [first, ...rest] = String(name || '')
    .trim()
    .split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : first || 'Ahia user';
};
/** Accepts "AH-48213957", "ah48213957" or "AH 4821 3957"; returns "AH-48213957". */
export const ahiaId = z
  .string()
  .trim()
  .transform((v) => {
    const digits = v.toUpperCase().replace(/[^0-9A-Z]/g, '');
    return /^AH\d{8}$/.test(digits) ? `AH-${digits.slice(2)}` : v.toUpperCase();
  })
  .pipe(z.string().regex(/^AH-\d{8}$/, 'Enter an Ahia ID like AH-48213957.'));

/** Daily total a person may send, by trust level (BVN and track record). */
const TRANSFER_DAILY = { BASIC: 10_000_000, VERIFIED: 100_000_000, TRUSTED: 500_000_000 };

/** Pays Ahia credit into a wallet from the marketing budget, and records it for the hold. */
export async function grantCredit(
  q: Query,
  userId: string,
  amount: number,
  source: 'REFERRAL' | 'WELCOME' | 'PROMO',
  reference: string,
  title: string,
  body: string,
) {
  if (amount <= 0) return;
  const id = randomUUID();
  await ledger(q, id, [
    { account: 'marketing', amount: -amount },
    { account: 'wallet', owner: userId, amount },
  ]);
  await q.query(
    'INSERT INTO wallet_credits(id,user_id,amount_kobo,source,reference) VALUES($1,$2,$3,$4,$5)',
    [id, userId, amount, source, reference],
  );
  await notify(q, userId, 'payment', title, body);
}

/**
 * After an order completes: the referral reward (first completed order of at least the minimum)
 * and any cashback promo the buyer is waiting on.
 */
export async function rewardsOnCompletion(q: Query, b: any) {
  const [s] = await q.query(
    'SELECT referral_reward_kobo,referral_welcome_kobo,referral_min_order_kobo,credit_hold_days FROM settings WHERE id=1',
  );
  const total = Number(b.total_kobo);
  const [buyer] = await q.query(
    'SELECT id,name,referred_by,referral_rewarded_at FROM users WHERE id=$1 FOR UPDATE',
    [b.buyer_id],
  );
  if (buyer?.referred_by && !buyer.referral_rewarded_at && total >= s.referral_min_order_kobo) {
    await q.query('UPDATE users SET referral_rewarded_at=now() WHERE id=$1', [buyer.id]);
    const link = await linkedAccounts(q, buyer.referred_by, buyer.id);
    if (link)
      await flag(
        q,
        buyer.id,
        'REFERRAL_ABUSE',
        `Referred by an account sharing their ${link}; no referral reward paid.`,
        'MEDIUM',
        buyer.referred_by,
      );
    else {
      const hold = `Spend it now; it can be withdrawn after ${s.credit_hold_days} days.`;
      await grantCredit(
        q,
        buyer.referred_by,
        s.referral_reward_kobo,
        'REFERRAL',
        buyer.id,
        `You earned ${naira(s.referral_reward_kobo)} 🎉`,
        `${shortName(buyer.name)} joined with your link and completed their first order. ${hold}`,
      );
      await grantCredit(
        q,
        buyer.id,
        s.referral_welcome_kobo,
        'WELCOME',
        buyer.referred_by,
        `Welcome gift: ${naira(s.referral_welcome_kobo)}`,
        `Thanks for your first order on Ahia. ${hold}`,
      );
    }
  }
  const pending = await q.query(
    `SELECT r.id,p.code,p.percent,p.max_kobo,p.min_order_kobo,p.ends_at FROM promo_redemptions r
     JOIN promo_codes p ON p.id=r.promo_id
     WHERE r.user_id=$1 AND r.status='PENDING' AND p.kind='CASHBACK'
     ORDER BY r.created_at FOR UPDATE OF r`,
    [b.buyer_id],
  );
  for (const r of pending) {
    if (r.ends_at && new Date(r.ends_at) < new Date()) {
      await q.query("UPDATE promo_redemptions SET status='EXPIRED' WHERE id=$1", [r.id]);
      continue;
    }
    if (total < Number(r.min_order_kobo)) continue;
    const amount = Math.min(Number(r.max_kobo) || Infinity, Math.round((total * r.percent) / 100));
    await q.query(
      "UPDATE promo_redemptions SET status='PAID',booking_id=$1,amount_kobo=$2,paid_at=now() WHERE id=$3",
      [b.id, amount, r.id],
    );
    await grantCredit(
      q,
      b.buyer_id,
      amount,
      'PROMO',
      r.id,
      `${naira(amount)} back with ${r.code}`,
      `${r.percent}% of your order “${b.title}” came back as Ahia credit.`,
    );
  }
}

export function createRewardsService(deps: AppDeps) {
  const { db, config: c } = deps;
  const link = (code: string) =>
    `${(c as any).publicWebUrl || 'https://app.ahiamarketplace.com'}/?ref=${code}`;

  // ---- Transfers ------------------------------------------------------------------------
  async function findRecipient(user: any, input: RequestInput) {
    const id = ahiaId.parse(input.query.id);
    const [u] = await db.query(
      `SELECT u.id,u.ahia_id,u.name,s.business_name FROM users u LEFT JOIN sellers s ON s.user_id=u.id AND s.status='APPROVED'
       WHERE u.ahia_id=$1 AND u.status='ACTIVE' AND u.frozen_at IS NULL`,
      [id],
    );
    ensure(u, 404, 'NOT_FOUND', 'No Ahia account has this ID. Check it and try again.');
    ensure(u.id !== user.id, 400, 'SELF_TRANSFER', 'That’s your own Ahia ID.');
    return { ahia_id: u.ahia_id, name: shortName(u.name), business_name: u.business_name ?? null };
  }
  async function sendTransfer(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        to: ahiaId,
        amount_kobo: z.number().int().min(10000, 'Send at least ₦100.').max(1_000_000_000),
        note: z.string().trim().max(100).optional(),
      })
      .parse(input.body);
    const wrongPin = await checkTransactionPin(q, u.id, input.body?.transaction_pin);
    if (wrongPin) return wrongPin;
    await ensureNotFrozen(q, u.id);
    await ensureVerifiedContact(q, u.id);
    const [to] = await q.query(
      "SELECT id,name,ahia_id FROM users WHERE ahia_id=$1 AND status='ACTIVE' AND frozen_at IS NULL",
      [d.to],
    );
    ensure(to, 404, 'NOT_FOUND', 'No Ahia account has this ID. Check it and try again.');
    ensure(to.id !== u.id, 400, 'SELF_TRANSFER', 'You can’t send money to yourself.');
    const limits = await payoutLimits(q, u.id);
    if (limits.locked_until)
      throw new AppError(
        423,
        'MONEY_LOCKED',
        `For your safety, sending money is paused until ${new Date(limits.locked_until).toLocaleString('en-NG')} after a ${limits.lock_reason}.`,
      );
    const free = await withdrawable(q, u.id, 'wallet');
    ensure(
      d.amount_kobo <= free,
      409,
      'FUNDS_ON_HOLD',
      `You can send up to ${naira(free)} now. Recent card top-ups and Ahia credit can be spent in the app but not sent yet.`,
    );
    const [sent] = await q.query(
      "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM wallet_transfers WHERE from_user_id=$1 AND created_at>now()-interval '1 day'",
      [u.id],
    );
    const daily = TRANSFER_DAILY[limits.level as keyof typeof TRANSFER_DAILY];
    ensure(
      Number(sent.n) + d.amount_kobo <= daily,
      409,
      'DAILY_LIMIT',
      `You can send ${naira(daily)} a day (${naira(Math.max(0, daily - Number(sent.n)))} left today). Verify your BVN to raise it.`,
    );
    const id = randomUUID();
    await ledger(q, id, [
      { account: 'wallet', owner: u.id, amount: -d.amount_kobo },
      { account: 'wallet', owner: to.id, amount: d.amount_kobo },
    ]);
    await q.query(
      'INSERT INTO wallet_transfers(id,from_user_id,to_user_id,amount_kobo,note) VALUES($1,$2,$3,$4,$5)',
      [id, u.id, to.id, d.amount_kobo, d.note ?? null],
    );
    await audit(q, u.id, 'wallet.transfer', id, { to: to.id, amount_kobo: d.amount_kobo });
    await notify(
      q,
      to.id,
      'payment',
      `You received ${naira(d.amount_kobo)}`,
      `${shortName(u.name)} (${u.ahia_id}) sent you ${naira(d.amount_kobo)}${d.note ? `: “${d.note}”` : ''}. It’s in your wallet.`,
    );
    return {
      id,
      amount_kobo: d.amount_kobo,
      to: { ahia_id: to.ahia_id, name: shortName(to.name) },
    };
  }
  async function listTransfers(user: any, _input: RequestInput) {
    const rows = await db.query(
      `SELECT t.id,t.amount_kobo,t.note,t.created_at,t.from_user_id=$1 AS sent,
         o.ahia_id AS other_ahia_id,o.name AS other_name
       FROM wallet_transfers t JOIN users o ON o.id=CASE WHEN t.from_user_id=$1 THEN t.to_user_id ELSE t.from_user_id END
       WHERE t.from_user_id=$1 OR t.to_user_id=$1 ORDER BY t.created_at DESC LIMIT 50`,
      [user.id],
    );
    return rows.map((r: any) => ({
      id: r.id,
      amount_kobo: Number(r.amount_kobo),
      note: r.note,
      created_at: r.created_at,
      direction: r.sent ? ('SENT' as const) : ('RECEIVED' as const),
      other: { ahia_id: r.other_ahia_id, name: shortName(r.other_name) },
    }));
  }

  // ---- Referrals ------------------------------------------------------------------------
  async function myReferrals(user: any, _input: RequestInput) {
    const [s] = await db.query(
      'SELECT referral_reward_kobo,referral_welcome_kobo,referral_min_order_kobo,credit_hold_days FROM settings WHERE id=1',
    );
    const people = await db.query(
      'SELECT name,created_at,referral_rewarded_at FROM users WHERE referred_by=$1 ORDER BY created_at DESC LIMIT 100',
      [user.id],
    );
    const [earned] = await db.query(
      "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM wallet_credits WHERE user_id=$1 AND source='REFERRAL'",
      [user.id],
    );
    return {
      code: user.ahia_id as string,
      link: link(user.ahia_id),
      reward_kobo: s.referral_reward_kobo,
      welcome_kobo: s.referral_welcome_kobo,
      min_order_kobo: s.referral_min_order_kobo,
      hold_days: s.credit_hold_days,
      earned_kobo: Number(earned.n),
      invited: people.length,
      rewarded: people.filter((p: any) => p.referral_rewarded_at).length,
      people: people.map((p: any) => ({
        name: shortName(p.name),
        joined_at: p.created_at,
        rewarded: !!p.referral_rewarded_at,
      })),
    };
  }
  /** Who a referral code belongs to (for the sign-up screen: "Invited by Chiamaka O."). */
  async function referrer(_user: any, input: RequestInput) {
    const code = ahiaId.parse(input.query.code);
    const [u] = await db.query("SELECT name FROM users WHERE ahia_id=$1 AND status='ACTIVE'", [
      code,
    ]);
    ensure(u, 404, 'NOT_FOUND', 'This invite code isn’t valid.');
    return { code, name: shortName(u.name) };
  }

  // ---- Promo codes ----------------------------------------------------------------------
  async function redeemPromo(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        code: z
          .string()
          .trim()
          .min(3)
          .max(30)
          .transform((v) => v.toUpperCase()),
      })
      .parse(input.body);
    await ensureNotFrozen(q, u.id);
    const [p] = await q.query('SELECT * FROM promo_codes WHERE code=$1 FOR UPDATE', [d.code]);
    ensure(p && p.active, 404, 'PROMO_INVALID', 'This promo code isn’t valid.');
    ensure(
      !p.starts_at || new Date(p.starts_at) <= new Date(),
      409,
      'PROMO_NOT_STARTED',
      'This promo code hasn’t started yet.',
    );
    ensure(
      !p.ends_at || new Date(p.ends_at) > new Date(),
      409,
      'PROMO_ENDED',
      'This promo code has ended.',
    );
    const [used] = await q.query(
      'SELECT COUNT(*)::int AS n, bool_or(user_id=$2) AS mine FROM promo_redemptions WHERE promo_id=$1',
      [p.id, u.id],
    );
    ensure(!used.mine, 409, 'PROMO_USED', 'You’ve already used this promo code.');
    ensure(
      p.max_uses == null || used.n < p.max_uses,
      409,
      'PROMO_USED_UP',
      'This promo code has been used up.',
    );
    if (p.new_customers_only) {
      const [orders] = await q.query(
        "SELECT COUNT(*)::int AS n FROM bookings WHERE buyer_id=$1 AND status='COMPLETED'",
        [u.id],
      );
      ensure(!orders.n, 409, 'PROMO_NEW_ONLY', 'This promo code is for new customers only.');
    }
    const id = randomUUID();
    if (p.kind === 'CREDIT') {
      await q.query(
        "INSERT INTO promo_redemptions(id,promo_id,user_id,status,amount_kobo,paid_at) VALUES($1,$2,$3,'PAID',$4,now())",
        [id, p.id, u.id, p.amount_kobo],
      );
      await grantCredit(
        q,
        u.id,
        Number(p.amount_kobo),
        'PROMO',
        id,
        `${naira(Number(p.amount_kobo))} added with ${p.code}`,
        'Your promo credit is in your wallet. Spend it on any order.',
      );
      return {
        code: p.code,
        kind: 'CREDIT' as const,
        message: `${naira(Number(p.amount_kobo))} Ahia credit added to your wallet.`,
      };
    }
    await q.query(
      "INSERT INTO promo_redemptions(id,promo_id,user_id,status) VALUES($1,$2,$3,'PENDING')",
      [id, p.id, u.id],
    );
    return {
      code: p.code,
      kind: 'CASHBACK' as const,
      message: `${p.percent}% back${Number(p.max_kobo) ? ` (up to ${naira(Number(p.max_kobo))})` : ''} on your next completed order${Number(p.min_order_kobo) ? ` of ${naira(Number(p.min_order_kobo))} or more` : ''}.`,
    };
  }
  async function myPromos(user: any, _input: RequestInput) {
    return db.query(
      `SELECT r.id,p.code,p.kind,p.percent,p.max_kobo::int,p.min_order_kobo::int,p.ends_at,r.status,r.amount_kobo::int,r.created_at
       FROM promo_redemptions r JOIN promo_codes p ON p.id=r.promo_id WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 50`,
      [user.id],
    );
  }

  // ---- Staff ----------------------------------------------------------------------------
  async function adminPromos(_user: any, _input: RequestInput) {
    return db.query(
      `SELECT p.*,p.amount_kobo::int,p.max_kobo::int,p.min_order_kobo::int,
         (SELECT COUNT(*)::int FROM promo_redemptions r WHERE r.promo_id=p.id) AS uses,
         (SELECT COALESCE(SUM(amount_kobo),0)::int FROM promo_redemptions r WHERE r.promo_id=p.id AND r.status='PAID') AS paid_kobo
       FROM promo_codes p ORDER BY p.created_at DESC LIMIT 200`,
    );
  }
  async function createPromo(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        code: z
          .string()
          .trim()
          .transform((v) => v.toUpperCase())
          .pipe(z.string().regex(/^[A-Z0-9]{3,20}$/, 'Codes are 3–20 letters and numbers.')),
        kind: z.enum(['CREDIT', 'CASHBACK']),
        amount_kobo: z.number().int().min(0).max(100_000_000).default(0),
        percent: z.number().int().min(0).max(100).default(0),
        max_kobo: z.number().int().min(0).max(100_000_000).default(0),
        min_order_kobo: z.number().int().min(0).max(1_000_000_000).default(0),
        max_uses: z.number().int().min(1).max(1_000_000).nullable().default(null),
        new_customers_only: z.boolean().default(false),
        ends_at: z.iso.datetime({ offset: true }).nullable().default(null),
        note: z.string().trim().max(200).optional(),
      })
      .refine((x) => (x.kind === 'CREDIT' ? x.amount_kobo >= 100 : x.percent >= 1), {
        message: 'Give a credit amount, or a cashback percentage.',
      })
      .parse(input.body);
    const [exists] = await q.query('SELECT 1 FROM promo_codes WHERE code=$1', [d.code]);
    ensure(!exists, 409, 'PROMO_EXISTS', 'A promo code with this name already exists.');
    const id = randomUUID();
    await q.query(
      `INSERT INTO promo_codes(id,code,kind,amount_kobo,percent,max_kobo,min_order_kobo,max_uses,new_customers_only,ends_at,note,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        d.code,
        d.kind,
        d.amount_kobo,
        d.percent,
        d.max_kobo,
        d.min_order_kobo,
        d.max_uses,
        d.new_customers_only,
        d.ends_at,
        d.note ?? null,
        u.id,
      ],
    );
    await audit(q, u.id, 'promo.create', id, d);
    return { id, code: d.code };
  }
  async function setPromoActive(q: Query, u: any, input: RequestInput) {
    const d = z.object({ active: z.boolean() }).parse(input.body);
    const [p] = await q.query('UPDATE promo_codes SET active=$1 WHERE id=$2 RETURNING id', [
      d.active,
      input.params.id,
    ]);
    ensure(p, 404, 'NOT_FOUND', 'Promo code not found.');
    await audit(q, u.id, d.active ? 'promo.on' : 'promo.off', p.id);
    return { ok: true as const };
  }
  async function adminReferrals(_user: any, _input: RequestInput) {
    const [s] = await db.query(
      'SELECT referral_reward_kobo,referral_welcome_kobo,referral_min_order_kobo,credit_hold_days FROM settings WHERE id=1',
    );
    const [t] = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM users WHERE referred_by IS NOT NULL) AS invited,
              (SELECT COUNT(*)::int FROM users WHERE referral_rewarded_at IS NOT NULL) AS rewarded,
              (SELECT COALESCE(SUM(amount_kobo),0)::int FROM wallet_credits WHERE source IN ('REFERRAL','WELCOME')) AS referral_paid_kobo,
              (SELECT COALESCE(SUM(amount_kobo),0)::int FROM wallet_credits WHERE source='PROMO') AS promo_paid_kobo`,
    );
    const top = await db.query(
      `SELECT r.ahia_id,r.name,COUNT(*)::int AS invited,COUNT(u.referral_rewarded_at)::int AS rewarded
       FROM users u JOIN users r ON r.id=u.referred_by GROUP BY r.id ORDER BY invited DESC LIMIT 20`,
    );
    return { settings: s, totals: t, top };
  }
  async function saveReferralSettings(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        referral_reward_kobo: z.number().int().min(0).max(10_000_000),
        referral_welcome_kobo: z.number().int().min(0).max(10_000_000),
        referral_min_order_kobo: z.number().int().min(0).max(100_000_000),
        credit_hold_days: z.number().int().min(0).max(365),
      })
      .parse(input.body);
    await q.query(
      'UPDATE settings SET referral_reward_kobo=$1,referral_welcome_kobo=$2,referral_min_order_kobo=$3,credit_hold_days=$4 WHERE id=1',
      [
        d.referral_reward_kobo,
        d.referral_welcome_kobo,
        d.referral_min_order_kobo,
        d.credit_hold_days,
      ],
    );
    await audit(q, u.id, 'referrals.settings', 'settings', d);
    return { ok: true as const };
  }

  return {
    findRecipient,
    sendTransfer,
    listTransfers,
    myReferrals,
    referrer,
    redeemPromo,
    myPromos,
    adminPromos,
    createPromo,
    setPromoActive,
    adminReferrals,
    saveReferralSettings,
  };
}
