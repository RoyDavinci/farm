import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { createBookingsService } from './booking.service.js';
import { unitPrice } from './catalog.service.js';
import { notify } from './communications.service.js';
import { words } from './deals.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
import { bookableSql } from './retention.service.js';
import { ensureNotFrozen } from './risk.service.js';

/**
 * Group buying, like sharing a goat at the market: someone starts a group for one purchase and
 * splits it into shares; others join (or are invited) and each pays their share into a group
 * escrow. When the last share is taken the order goes to the seller under the starter's name;
 * the starter collects and shares out. Ahia funds a small discount (1–3%) from its commission.
 * If the group doesn't fill in 48 hours, or the seller declines, everyone gets their money back.
 */

const HOURS_OPEN = 48;
const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
/** Bigger groups save a bit more: 2 people 1%, 3 people 2%, 4+ people 3%. */
const discountFor = (shares: number) => (shares >= 4 ? 300 : shares === 3 ? 200 : 100);

/** Commission rate (bps) the platform earns on this listing; the discount can't exceed it. */
async function commissionBps(q: Query, category: string) {
  const [s] = await q.query('SELECT commission_bps,monetisation FROM settings WHERE id=1');
  if (s.monetisation?.transaction_commission === false) return 0;
  const [c] = await q.query('SELECT commission_bps FROM catalogue_categories WHERE name=$1', [
    category,
  ]);
  return Number(c?.commission_bps ?? s.commission_bps);
}

const members = (q: Query, groupId: string) =>
  q.query('SELECT user_id,shares,paid_kobo FROM group_buy_members WHERE group_id=$1', [groupId]);

/** Gives every member back what they paid (from the group escrow, or the order's escrow). */
async function refundMembers(
  q: Query,
  group: any,
  from: { account: string; owner: string },
  reason: string,
) {
  const list = await members(q, group.id);
  const total = list.reduce((s: number, m: any) => s + m.paid_kobo, 0);
  if (total > 0)
    await ledger(q, group.id, [
      { account: from.account, owner: from.owner, amount: -total },
      ...list.map((m: any) => ({ account: 'wallet', owner: m.user_id, amount: m.paid_kobo })),
    ]);
  for (const m of list)
    await notify(
      q,
      m.user_id,
      'group_buy',
      'Group buy refunded',
      `${reason} Your ${naira(m.paid_kobo)} is back in your wallet.`,
    );
}

/** When the seller accepts a group order: pay it from the group escrow plus Ahia's discount. */
export async function fundGroupBooking(q: Query, b: any) {
  const [g] = await q.query('SELECT * FROM group_buys WHERE id=$1 FOR UPDATE', [b.group_buy_id]);
  if (!g) return;
  const have = await lockedBalance(q, g.id, 'group_escrow');
  const total = Number(b.total_kobo);
  // The discount comes out of Ahia's commission, never the seller's money.
  const subsidy = Math.max(0, Math.min(total - have, Number(b.commission_kobo)));
  const fromGroup = Math.min(have, total - subsidy);
  await ledger(q, b.id, [
    { account: 'group_escrow', owner: g.id, amount: -fromGroup },
    ...(subsidy ? [{ account: 'platform_revenue', amount: -subsidy }] : []),
    { account: 'escrow', owner: b.id, amount: fromGroup + subsidy },
  ]);
  await q.query('UPDATE bookings SET paid=TRUE WHERE id=$1', [b.id]);
  // If the price fell since the group started, the extra goes back to members.
  const left = have - fromGroup;
  if (left > 0) {
    const list = await members(q, g.id);
    const paid = list.reduce((s: number, m: any) => s + m.paid_kobo, 0);
    let rest = left;
    const shares = list.map((m: any, i: number) => {
      const amount = i === list.length - 1 ? rest : Math.floor((left * m.paid_kobo) / paid);
      rest -= amount;
      return { account: 'wallet', owner: m.user_id, amount };
    });
    await ledger(q, g.id, [
      { account: 'group_escrow', owner: g.id, amount: -left },
      ...shares.filter((x) => x.amount > 0),
    ]);
  }
}

/**
 * A group order ended without completing (declined, cancelled, expired): refund members from
 * wherever the money is, and give Ahia back its discount.
 */
export async function refundGroupBooking(q: Query, b: any, reason: string) {
  const [g] = await q.query('SELECT * FROM group_buys WHERE id=$1 FOR UPDATE', [b.group_buy_id]);
  if (!g || g.status !== 'ORDERED') return;
  if (b.paid) {
    const inEscrow = await lockedBalance(q, b.id, 'escrow');
    const list = await members(q, g.id);
    const paid = list.reduce((s: number, m: any) => s + m.paid_kobo, 0);
    const refunds = list.map((m: any) => ({
      account: 'wallet',
      owner: m.user_id,
      amount: m.paid_kobo,
    }));
    const platform = inEscrow - paid;
    await ledger(q, b.id, [
      { account: 'escrow', owner: b.id, amount: -inEscrow },
      ...refunds,
      ...(platform ? [{ account: 'platform_revenue', amount: platform }] : []),
    ]);
    await q.query('UPDATE bookings SET paid=FALSE WHERE id=$1', [b.id]);
    for (const m of list)
      await notify(
        q,
        m.user_id,
        'group_buy',
        'Group buy refunded',
        `${reason} Your ${naira(m.paid_kobo)} is back in your wallet.`,
      );
  } else await refundMembers(q, g, { account: 'group_escrow', owner: g.id }, reason);
  await q.query("UPDATE group_buys SET status='CANCELLED' WHERE id=$1", [g.id]);
}

/** Groups that didn't fill in time: refund and close. */
export async function expireGroupBuys(db: Database) {
  await db.transaction(async (q) => {
    const due = await q.query(
      "SELECT * FROM group_buys WHERE status='OPEN' AND expires_at<=now() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED",
    );
    for (const g of due) {
      await refundMembers(
        q,
        g,
        { account: 'group_escrow', owner: g.id },
        'The group didn’t fill in time.',
      );
      await q.query("UPDATE group_buys SET status='EXPIRED' WHERE id=$1", [g.id]);
    }
  });
}

export function createGroupBuyService(deps: AppDeps) {
  const { db } = deps;
  const bookings = createBookingsService(deps);

  async function view(q: Query, id: string, userId: string) {
    const [g] = await q.query(
      `SELECT g.*,l.title,l.unit,l.image_url,l.category,s.business_name,s.area,s.city,u.name AS creator_name,
         b.status AS booking_status,b.pickup_code,
         (SELECT COALESCE(SUM(m.shares),0)::int FROM group_buy_members m WHERE m.group_id=g.id) AS taken
       FROM group_buys g JOIN listings l ON l.id=g.listing_id JOIN sellers s ON s.user_id=l.seller_id
       JOIN users u ON u.id=g.creator_id LEFT JOIN bookings b ON b.id=g.booking_id WHERE g.id=$1`,
      [id],
    );
    ensure(g, 404, 'NOT_FOUND', 'Group buy not found.');
    const list = await q.query(
      'SELECT m.user_id,m.shares,u.name FROM group_buy_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY m.joined_at',
      [id],
    );
    const mine = list.find((m: any) => m.user_id === userId);
    return {
      id: g.id,
      listing_id: g.listing_id,
      title: g.title,
      unit: g.unit,
      image_url: g.image_url,
      business_name: g.business_name,
      area: g.area,
      city: g.city,
      quantity: g.quantity,
      shares: g.shares,
      taken: g.taken,
      spots_left: g.shares - g.taken,
      full_price_kobo: g.full_price_kobo,
      share_price_kobo: g.share_price_kobo,
      discount_pct: g.discount_bps / 100,
      note: g.note,
      status: g.status,
      expires_at: g.expires_at,
      creator_name: g.creator_name,
      is_creator: g.creator_id === userId,
      // First names only: enough to recognise neighbours, not to profile them.
      members: list.map((m: any) => ({
        name: String(m.name).split(' ')[0],
        shares: m.shares,
        you: m.user_id === userId,
      })),
      joined: !!mine,
      booking_status: g.booking_status ?? null,
      // The starter collects for the group.
      pickup_code: g.creator_id === userId ? (g.pickup_code ?? null) : null,
    };
  }

  /** Pays a member's share into the group escrow. */
  async function payShare(q: Query, userId: string, g: any, shares: number) {
    const amount = g.share_price_kobo * shares;
    ensure(
      (await lockedBalance(q, userId, 'wallet')) >= amount,
      409,
      'INSUFFICIENT_BALANCE',
      `Add ${naira(amount)} to your wallet to take your share.`,
    );
    await ledger(q, g.id, [
      { account: 'wallet', owner: userId, amount: -amount },
      { account: 'group_escrow', owner: g.id, amount },
    ]);
    return amount;
  }

  /** People who searched for, watched or asked for something like this recently. */
  async function interested(q: Query, g: any, title: string) {
    const w = words(title);
    if (!w.length) return [];
    return await q.query(
      `SELECT user_id,reason FROM (
         SELECT DISTINCT ON (user_id) user_id,reason FROM (
           SELECT user_id,'searched for it' AS reason FROM search_queries
             WHERE day>current_date-30 AND EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE q LIKE '%'||x||'%')
           UNION ALL SELECT user_id,'watching its price' FROM price_watches
             WHERE active AND (listing_id=$2 OR EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE lower(label) LIKE '%'||x||'%'))
           UNION ALL SELECT buyer_id,'asked sellers for it' FROM product_requests
             WHERE created_at>now()-interval '30 days' AND EXISTS(SELECT 1 FROM unnest($1::text[]) x WHERE lower(text) LIKE '%'||x||'%')
         ) x ORDER BY user_id) y
       WHERE user_id NOT IN ($3,$4) AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=y.user_id AND (u.status<>'ACTIVE' OR u.frozen_at IS NOT NULL))
       LIMIT 20`,
      [w, g.listing_id, g.creator_id, g.seller_id],
    );
  }

  /** Start a group buy for a product: how many units, split into how many shares. */
  async function startGroup(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        listing_id: z.string().max(60),
        variant_id: z.string().max(60).optional(),
        quantity: z.number().int().min(1).max(1000).default(1),
        shares: z.number().int().min(2).max(10),
        note: z.string().trim().max(200).optional(),
      })
      .parse(input.body);
    await ensureNotFrozen(q, user.id);
    const [l] = await q.query(
      `SELECT l.* FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1 AND l.status='ACTIVE' AND s.status='APPROVED' AND ${bookableSql('l')}`,
      [d.listing_id],
    );
    ensure(l, 404, 'NOT_FOUND', 'This product isn’t available.');
    ensure(
      l.seller_id !== user.id,
      400,
      'OWN_LISTING',
      'You can’t start a group buy for your own product.',
    );
    const [v] = await q.query(
      `SELECT * FROM listing_variants WHERE listing_id=$1 AND active AND ${d.variant_id ? 'id=$2' : 'is_primary'}`,
      d.variant_id ? [l.id, d.variant_id] : [l.id],
    );
    ensure(
      v && v.stock >= d.quantity && d.quantity >= v.min_quantity,
      409,
      'OUT_OF_STOCK',
      'Not enough stock for this group.',
    );
    const full = unitPrice(v as any, d.quantity) * d.quantity;
    ensure(full <= 100000000, 400, 'ORDER_LIMIT', 'Order exceeds the current ₦1,000,000 limit.');
    const discount = Math.min(discountFor(d.shares), await commissionBps(q, l.category));
    // Shares are whole naira, rounded up.
    const share = Math.ceil((full * (10000 - discount)) / 10000 / d.shares / 100) * 100;
    const [open] = await q.query(
      "SELECT COUNT(*)::int AS n FROM group_buys WHERE creator_id=$1 AND status='OPEN'",
      [user.id],
    );
    ensure(open.n < 5, 400, 'GROUP_LIMIT', 'You can have up to 5 open group buys.');
    const id = randomUUID();
    const g = {
      id,
      listing_id: l.id,
      seller_id: l.seller_id,
      creator_id: user.id,
      share_price_kobo: share,
    };
    await q.query(
      `INSERT INTO group_buys(id,listing_id,variant_id,creator_id,quantity,shares,full_price_kobo,discount_bps,share_price_kobo,note,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+make_interval(hours=>$11))`,
      [
        id,
        l.id,
        v.id,
        user.id,
        d.quantity,
        d.shares,
        full,
        discount,
        share,
        d.note ?? null,
        HOURS_OPEN,
      ],
    );
    const paid = await payShare(q, user.id, g, 1);
    await q.query(
      'INSERT INTO group_buy_members(group_id,user_id,shares,paid_kobo) VALUES($1,$2,1,$3)',
      [id, user.id, paid],
    );
    // Tell people who want the same thing.
    for (const p of await interested(q, g, l.title)) {
      await q.query(
        'INSERT INTO group_buy_invites(group_id,user_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [id, p.user_id, p.reason],
      );
      await notify(
        q,
        p.user_id,
        'group_buy',
        `Share ${l.title} and save ${discount / 100}%`,
        `${d.shares - 1} of ${d.shares} shares left at ${naira(share)} each. Open Group buys to join.`,
      );
    }
    await audit(q, user.id, 'group_buy.start', id, { shares: d.shares, discount_bps: discount });
    return await view(q, id, user.id);
  }

  /** When every share is taken, the order goes to the seller in the starter's name. */
  async function placeOrder(q: Query, g: any) {
    const b: any = await bookings.createBooking(q, { id: g.creator_id }, {
      body: { listing_id: g.listing_id, variant_id: g.variant_id, quantity: g.quantity },
      params: {},
      query: {},
    } as unknown as RequestInput);
    await q.query('UPDATE bookings SET group_buy_id=$1 WHERE id=$2', [g.id, b.id]);
    await q.query("UPDATE group_buys SET status='ORDERED',booking_id=$1 WHERE id=$2", [b.id, g.id]);
    for (const m of await members(q, g.id))
      await notify(
        q,
        m.user_id,
        'group_buy',
        'Your group is full',
        `The order went to the seller. ${m.user_id === g.creator_id ? 'You collect it and share it out.' : 'The starter collects it and shares it out.'}`,
        b.id,
      );
  }

  async function joinGroup(q: Query, user: any, input: RequestInput) {
    await ensureNotFrozen(q, user.id);
    const [g] = await q.query(
      `SELECT g.*,l.seller_id FROM group_buys g JOIN listings l ON l.id=g.listing_id WHERE g.id=$1 FOR UPDATE OF g`,
      [input.params.id],
    );
    ensure(g, 404, 'NOT_FOUND', 'Group buy not found.');
    ensure(
      g.status === 'OPEN' && new Date(g.expires_at) > new Date(),
      409,
      'GROUP_CLOSED',
      'This group buy is closed.',
    );
    ensure(
      g.seller_id !== user.id,
      400,
      'OWN_LISTING',
      'Sellers can’t join groups for their own products.',
    );
    const [already] = await q.query(
      'SELECT 1 FROM group_buy_members WHERE group_id=$1 AND user_id=$2',
      [g.id, user.id],
    );
    ensure(!already, 409, 'ALREADY_JOINED', 'You’re already in this group.');
    const [t] = await q.query(
      'SELECT COALESCE(SUM(shares),0)::int AS n FROM group_buy_members WHERE group_id=$1',
      [g.id],
    );
    ensure(t.n < g.shares, 409, 'GROUP_FULL', 'This group is already full.');
    const [invite] = await q.query(
      'SELECT invited_by FROM group_buy_invites WHERE group_id=$1 AND user_id=$2',
      [g.id, user.id],
    );
    const paid = await payShare(q, user.id, g, 1);
    await q.query(
      'INSERT INTO group_buy_members(group_id,user_id,shares,paid_kobo,invited_by) VALUES($1,$2,1,$3,$4)',
      [g.id, user.id, paid, invite?.invited_by ?? null],
    );
    await notify(
      q,
      g.creator_id,
      'group_buy',
      'Someone joined your group buy',
      `${t.n + 1} of ${g.shares} shares taken.`,
    );
    if (t.n + 1 >= g.shares) await placeOrder(q, g);
    return await view(q, g.id, user.id);
  }

  /** Leave before the group fills (your share is refunded); the starter leaving cancels it. */
  async function leaveGroup(q: Query, user: any, input: RequestInput) {
    const [g] = await q.query('SELECT * FROM group_buys WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(g, 404, 'NOT_FOUND', 'Group buy not found.');
    ensure(g.status === 'OPEN', 409, 'GROUP_CLOSED', 'The order has already gone to the seller.');
    const [m] = await q.query('SELECT * FROM group_buy_members WHERE group_id=$1 AND user_id=$2', [
      g.id,
      user.id,
    ]);
    ensure(m, 404, 'NOT_A_MEMBER', 'You’re not in this group.');
    if (g.creator_id === user.id) {
      await refundMembers(
        q,
        g,
        { account: 'group_escrow', owner: g.id },
        'The starter cancelled the group buy.',
      );
      await q.query("UPDATE group_buys SET status='CANCELLED' WHERE id=$1", [g.id]);
    } else {
      await ledger(q, g.id, [
        { account: 'group_escrow', owner: g.id, amount: -m.paid_kobo },
        { account: 'wallet', owner: user.id, amount: m.paid_kobo },
      ]);
      await q.query('DELETE FROM group_buy_members WHERE group_id=$1 AND user_id=$2', [
        g.id,
        user.id,
      ]);
    }
    return { ok: true as const };
  }

  /** Members invite someone by their email or phone (an Ahia account). */
  async function invite(q: Query, user: any, input: RequestInput) {
    const d = z.object({ contact: z.string().trim().min(5).max(160) }).parse(input.body);
    const [g] = await q.query(
      `SELECT g.*,l.title FROM group_buys g JOIN listings l ON l.id=g.listing_id
       WHERE g.id=$1 AND g.status='OPEN' AND EXISTS(SELECT 1 FROM group_buy_members m WHERE m.group_id=g.id AND m.user_id=$2)`,
      [input.params.id, user.id],
    );
    ensure(g, 404, 'NOT_FOUND', 'Open group buy not found.');
    const [u] = await q.query(
      "SELECT id FROM users WHERE (lower(email)=lower($1) OR phone=$1) AND status='ACTIVE'",
      [d.contact],
    );
    ensure(
      u,
      404,
      'USER_NOT_FOUND',
      'No Ahia account uses that email or phone. Share the link instead.',
    );
    await q.query(
      `INSERT INTO group_buy_invites(group_id,user_id,invited_by,reason) VALUES($1,$2,$3,'invited')
       ON CONFLICT(group_id,user_id) DO UPDATE SET invited_by=EXCLUDED.invited_by`,
      [g.id, u.id, user.id],
    );
    await notify(
      q,
      u.id,
      'group_buy',
      `${user.name} invited you to share ${g.title}`,
      `Take a share for ${naira(g.share_price_kobo)} (${g.discount_bps / 100}% off). Open Group buys to join.`,
    );
    return { ok: true as const };
  }

  /** Open groups to join (optionally for one product or search), plus my groups. */
  async function listGroups(user: any, input: RequestInput) {
    const d = z
      .object({ listing_id: z.string().max(60).optional(), q: z.string().max(100).optional() })
      .parse(input.query);
    const w = words(d.q || '');
    const open = await db.query(
      `SELECT g.id FROM group_buys g JOIN listings l ON l.id=g.listing_id
       WHERE g.status='OPEN' AND g.expires_at>now()
         AND ($1::text IS NULL OR g.listing_id=$1)
         AND (cardinality($2::text[])=0 OR EXISTS(SELECT 1 FROM unnest($2::text[]) x WHERE l.title ILIKE '%'||x||'%'))
         AND NOT EXISTS(SELECT 1 FROM group_buy_members m WHERE m.group_id=g.id AND m.user_id=$3)
       ORDER BY (EXISTS(SELECT 1 FROM group_buy_invites i WHERE i.group_id=g.id AND i.user_id=$3)) DESC,g.expires_at LIMIT 30`,
      [d.listing_id ?? null, w, user.id],
    );
    const mine = await db.query(
      `SELECT g.id FROM group_buys g JOIN group_buy_members m ON m.group_id=g.id AND m.user_id=$1
       ORDER BY g.created_at DESC LIMIT 30`,
      [user.id],
    );
    return {
      open: await Promise.all(open.map((g: any) => view(db, g.id, user.id))),
      mine: await Promise.all(mine.map((g: any) => view(db, g.id, user.id))),
    };
  }
  async function getGroup(user: any, input: RequestInput) {
    return await view(db, String(input.params.id), user.id);
  }
  return { startGroup, joinGroup, leaveGroup, invite, listGroups, getGroup };
}
