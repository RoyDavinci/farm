import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { integrations } from '../integrations/index.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
import { createMarketplaceService } from './listing.service.js';

const n = (v: unknown) => Number(v ?? 0);
/** Market figures need at least this many sellers in a group before they are shown. */
const MIN_SELLERS = 3;

export const sellerFeatureDefaults = {
  insights: false,
  ai_assistant: false,
  business_report: false,
  bulk_import: false,
  team_seats: 0,
  api_access: false,
};
export type SellerFeatures = typeof sellerFeatureDefaults;

export const planInput = z.object({
  audience: z.enum(['SELLER', 'BUYER']),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(400).default(''),
  price_kobo: z.number().int().min(0).max(10_000_000_000),
  period_days: z.number().int().min(1).max(366),
  features: z.record(z.string(), z.union([z.boolean(), z.number()])).default({}),
  active: z.boolean().default(true),
});
export const subscribeInput = z.object({
  plan_id: z.string().max(64),
  /** proceeds (sellers only), card (Paystack/Flutterwave checkout) or transfer (staff confirm). */
  pay_with: z.enum(['proceeds', 'card', 'transfer']).optional(),
});
export const activateInput = z.object({ reference: z.string().trim().min(3).max(120) });
export const listingAssistInput = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(''),
  category: z.string().trim().min(2).max(60),
  unit: z.string().trim().max(30).default('piece'),
  price_kobo: z.number().int().min(0).optional(),
});
export const rfqInput = z.object({
  business_name: z.string().trim().max(120).default(''),
  title: z.string().trim().min(3).max(120),
  category: z.string().trim().min(2).max(60),
  quantity: z.number().positive().max(10_000_000),
  unit: z.string().trim().min(1).max(30),
  details: z.string().trim().max(2000).default(''),
  state: z.string().trim().max(40).default(''),
  city: z.string().trim().max(60).default(''),
  needed_by: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  budget_kobo: z.number().int().min(0).nullable().optional(),
});
export const quoteInput = z.object({
  total_kobo: z.number().int().min(1).max(100_000_000_000),
  delivery_days: z.number().int().min(0).max(365),
  note: z.string().trim().max(1000).default(''),
});
export const teamInput = z.object({
  contact: z.string().trim().min(5).max(160),
  role: z.enum(['MANAGER', 'STAFF']).default('STAFF'),
});
export const importInput = z.object({
  items: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        category: z.string(),
        unit: z.string(),
        price_kobo: z.number(),
        stock: z.number(),
      }),
    )
    .min(1)
    .max(200),
});

/** The features of the user's active seller plan (defaults when they have none). */
export async function sellerFeatures(
  q: Query,
  userId: string,
): Promise<SellerFeatures & { plan: string | null }> {
  const [row] = await q.query(
    `SELECT p.id,p.features FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
     WHERE s.user_id=$1 AND p.audience='SELLER' AND s.status='ACTIVE' AND s.ends_at>now() ORDER BY p.price_kobo DESC LIMIT 1`,
    [userId],
  );
  return { ...sellerFeatureDefaults, ...(row?.features || {}), plan: row?.id ?? null };
}
async function requireFeature(
  q: Query,
  userId: string,
  feature: keyof SellerFeatures,
  label: string,
) {
  const f = await sellerFeatures(q, userId);
  ensure(
    f[feature],
    402,
    'UPGRADE_REQUIRED',
    `${label} is part of the Seller Pro and Business plans.`,
  );
  return f;
}
const expire = (q: Query) =>
  q.query("UPDATE subscriptions SET status='EXPIRED' WHERE status='ACTIVE' AND ends_at<=now()");

/**
 * Growth-stage modules: seller subscriptions and buyer membership, the listing assistant, business
 * report and market insights (rule-based, with an AI provider if one is plugged in), market research
 * reports, B2B requests for quotes, team members and bulk upload for enterprise sellers.
 */
export function createGrowthService(deps: AppDeps) {
  const { db } = deps;
  const marketplace = createMarketplaceService(deps);

  // ---------------------------------------------------------------- plans & subscriptions
  const planOut = (p: any) => ({ ...p, price_kobo: n(p.price_kobo) });
  async function listPlans(_user: any, input: RequestInput) {
    const { audience } = z
      .object({ audience: z.enum(['SELLER', 'BUYER']).optional() })
      .parse(input.query);
    return (
      await db.query(
        'SELECT * FROM subscription_plans WHERE active AND ($1::text IS NULL OR audience=$1) ORDER BY audience,price_kobo',
        [audience ?? null],
      )
    ).map(planOut);
  }
  async function mySubscriptions(user: any, _input?: RequestInput) {
    await expire(db);
    const subs = (
      await db.query(
        `SELECT s.*,p.name,p.audience,p.features FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
         WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT 20`,
        [user.id],
      )
    ).map((s: any) => ({ ...s, fee_kobo: n(s.fee_kobo) }));
    return { subscriptions: subs, seller_features: await sellerFeatures(db, user.id) };
  }
  async function subscribe(q: Query, user: any, input: RequestInput) {
    const d = subscribeInput.parse(input.body);
    await expire(q);
    const [plan] = await q.query('SELECT * FROM subscription_plans WHERE id=$1 AND active', [
      d.plan_id,
    ]);
    ensure(plan, 400, 'UNKNOWN_PLAN', 'Choose one of the plans.');
    const [current] = await q.query(
      `SELECT s.id FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
       WHERE s.user_id=$1 AND p.audience=$2 AND s.status='ACTIVE' AND s.ends_at>now()`,
      [user.id, plan.audience],
    );
    ensure(
      !current,
      409,
      'ALREADY_SUBSCRIBED',
      'You already have a plan. Cancel it first to change.',
    );
    // An unpaid earlier attempt is replaced by this one.
    await q.query(
      `UPDATE subscriptions s SET status='CANCELLED',cancelled_at=now() FROM subscription_plans p
       WHERE p.id=s.plan_id AND s.user_id=$1 AND p.audience=$2 AND s.status='PENDING_PAYMENT'`,
      [user.id, plan.audience],
    );
    const fee = n(plan.price_kobo);
    const id = randomUUID();
    if (plan.audience === 'SELLER') {
      const [s] = await q.query('SELECT status FROM sellers WHERE user_id=$1', [user.id]);
      ensure(
        s?.status === 'APPROVED',
        403,
        'SELLER_NOT_APPROVED',
        'Approved sellers can subscribe.',
      );
    }
    const payWith =
      d.pay_with ??
      (plan.audience === 'SELLER' ? 'proceeds' : deps.config.payments ? 'card' : 'transfer');
    ensure(
      payWith !== 'proceeds' || plan.audience === 'SELLER',
      400,
      'INVALID_PAYMENT',
      'Only sellers can pay from sales proceeds.',
    );
    ensure(
      payWith !== 'card' || deps.config.payments,
      503,
      'PAYMENTS_DISABLED',
      'Card payments are not enabled.',
    );
    // Card: the plan waits for the Paystack/Flutterwave checkout (POST /wallet/checkout,
    // purpose "subscription"); it starts as soon as the payment is confirmed.
    if (fee && payWith === 'card') {
      await q.query(
        "INSERT INTO subscriptions(id,plan_id,user_id,status,fee_kobo,payment_method) VALUES($1,$2,$3,'PENDING_PAYMENT',$4,'card')",
        [id, plan.id, user.id, fee],
      );
      return {
        id,
        status: 'PENDING_PAYMENT' as const,
        pay_by_card: true,
        message: `Pay ₦${(fee / 100).toLocaleString('en-NG')} by card to start ${plan.name}.`,
      };
    }
    if (payWith === 'proceeds') {
      ensure(
        (await lockedBalance(q, user.id, 'seller_payable')) >= fee,
        409,
        'INSUFFICIENT_PROCEEDS',
        `${plan.name} costs ₦${(fee / 100).toLocaleString('en-NG')}. Your sales proceeds aren’t enough yet; you can pay by card instead.`,
      );
      await q.query(
        "INSERT INTO subscriptions(id,plan_id,user_id,status,fee_kobo,payment_method,starts_at,ends_at) VALUES($1,$2,$3,'ACTIVE',$4,'proceeds',now(),now()+$5::int*interval '1 day')",
        [id, plan.id, user.id, fee, plan.period_days],
      );
      if (fee)
        await ledger(q, id, [
          { account: 'seller_payable', owner: user.id, amount: -fee },
          { account: 'platform_revenue', amount: fee },
        ]);
      await audit(q, user.id, 'subscription.start', id, { plan: plan.id, fee });
      return { id, status: 'ACTIVE' as const, message: `${plan.name} is active.` };
    }
    // Free plans start at once; bank transfers wait for staff to confirm the payment.
    await q.query(
      `INSERT INTO subscriptions(id,plan_id,user_id,status,fee_kobo,payment_method,starts_at,ends_at)
       VALUES($1,$2,$3,$4,$5::bigint,'manual',CASE WHEN $5::bigint=0 THEN now() END,CASE WHEN $5::bigint=0 THEN now()+$6::int*interval '1 day' END)`,
      [id, plan.id, user.id, fee ? 'PENDING_PAYMENT' : 'ACTIVE', fee, plan.period_days],
    );
    return {
      id,
      status: (fee ? 'PENDING_PAYMENT' : 'ACTIVE') as 'PENDING_PAYMENT' | 'ACTIVE',
      message: fee
        ? `Pay by bank transfer and Ahia will switch ${plan.name} on once the payment is confirmed.`
        : `${plan.name} is active.`,
    };
  }
  async function cancelSubscription(q: Query, user: any, input: RequestInput) {
    const [s] = await q.query(
      "UPDATE subscriptions SET status='CANCELLED',cancelled_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('ACTIVE','PENDING_PAYMENT') RETURNING id",
      [input.params.id, user.id],
    );
    ensure(s, 404, 'NOT_FOUND', 'No active plan to cancel.');
    await audit(q, user.id, 'subscription.cancel', s.id);
    return { ok: true };
  }
  async function adminPlans(_user: any, _input?: RequestInput) {
    return (await db.query('SELECT * FROM subscription_plans ORDER BY audience,price_kobo')).map(
      planOut,
    );
  }
  async function savePlan(q: Query, user: any, input: RequestInput) {
    const d = planInput.parse(input.body);
    const id = input.params.id || randomUUID();
    await q.query(
      `INSERT INTO subscription_plans(id,audience,name,description,price_kobo,period_days,features,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(id) DO UPDATE SET audience=$2,name=$3,description=$4,price_kobo=$5,period_days=$6,features=$7,active=$8`,
      [
        id,
        d.audience,
        d.name,
        d.description,
        d.price_kobo,
        d.period_days,
        JSON.stringify(d.features),
        d.active,
      ],
    );
    await audit(q, user.id, 'subscription_plan.save', id, d);
    return { id };
  }
  async function adminSubscriptions(_user: any, _input?: RequestInput) {
    await expire(db);
    return (
      await db.query(
        `SELECT s.*,p.name AS plan_name,p.audience,u.name AS user_name,u.email FROM subscriptions s
         JOIN subscription_plans p ON p.id=s.plan_id JOIN users u ON u.id=s.user_id ORDER BY (s.status='PENDING_PAYMENT') DESC,s.created_at DESC LIMIT 200`,
      )
    ).map((s: any) => ({ ...s, fee_kobo: n(s.fee_kobo) }));
  }
  /** Staff confirm a membership paid by transfer; it starts now and the fee becomes revenue. */
  async function activateSubscription(q: Query, user: any, input: RequestInput) {
    const d = activateInput.parse(input.body);
    const [s] = await q.query(
      "SELECT s.*,p.period_days,p.name FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.id=$1 AND s.status='PENDING_PAYMENT' FOR UPDATE OF s",
      [input.params.id],
    );
    ensure(s, 404, 'NOT_FOUND', 'No pending subscription with that id.');
    await q.query(
      "UPDATE subscriptions SET status='ACTIVE',payment_reference=$1,starts_at=now(),ends_at=now()+$2::int*interval '1 day' WHERE id=$3",
      [d.reference, s.period_days, s.id],
    );
    if (n(s.fee_kobo))
      await ledger(q, s.id, [
        { account: 'subscription_receipts', amount: -n(s.fee_kobo) },
        { account: 'platform_revenue', amount: n(s.fee_kobo) },
      ]);
    await audit(q, user.id, 'subscription.activate', s.id, d);
    await notify(
      q,
      s.user_id,
      'subscription',
      `${s.name} is active`,
      'Thank you! Your membership is now active.',
    );
    return { ok: true };
  }

  // ---------------------------------------------------------------- AI-assisted tools (rules + optional AI)
  /** Listing assistant: tidier title, a fuller description and a price check against the market. */
  async function listingAssist(user: any, input: RequestInput) {
    const d = listingAssistInput.parse(input.body);
    await requireFeature(db, user.id, 'ai_assistant', 'The listing assistant');
    const [market] = await db.query(
      `SELECT COUNT(DISTINCT l.seller_id)::int AS sellers,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY v.price_kobo)::bigint AS median,
         MIN(v.price_kobo)::bigint AS low,MAX(v.price_kobo)::bigint AS high
       FROM listings l JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary
       WHERE l.status='ACTIVE' AND l.category=$1 AND v.unit=$2 AND l.seller_id<>$3`,
      [d.category, d.unit, user.id],
    );
    const title = d.title
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c, i) => (i === 0 ? c.toUpperCase() : c));
    const tips: string[] = [];
    if (title.length < 15)
      tips.push(
        'Add the size, brand or variety to the title (for example “50 kg bag” or “128 GB”).',
      );
    if (d.description.length < 60)
      tips.push('Describe condition, size, freshness or warranty: buyers trust detailed listings.');
    if (!/\d/.test(d.title + d.description))
      tips.push('Mention a quantity or size so buyers know exactly what they get.');
    tips.push('Use a clear photo in daylight on a plain background.');
    const enoughMarket = market && market.sellers >= MIN_SELLERS && market.median;
    if (enoughMarket && d.price_kobo) {
      const ratio = d.price_kobo / n(market.median);
      if (ratio > 1.25)
        tips.push(
          'Your price is well above similar listings; explain why (quality, size) or consider lowering it.',
        );
      if (ratio < 0.75)
        tips.push('Your price is well below similar listings; check it covers your costs.');
    }
    let description =
      d.description.trim() ||
      `${title}. Sold per ${d.unit}. Available for pickup or delivery — message me to confirm stock and collection time.`;
    let source = 'rules';
    const ai = integrations.ai();
    if (ai.available) {
      const text = await ai
        .complete({
          task: 'listing',
          prompt: `Improve this Nigerian marketplace product description in plain English, under 80 words, without inventing facts. Title: ${title}. Category: ${d.category}. Unit: ${d.unit}. Current description: ${d.description}`,
          maxWords: 80,
        })
        .catch(() => null);
      if (text) [description, source] = [text.trim(), ai.name];
    }
    return {
      title,
      description,
      tips,
      price: enoughMarket
        ? {
            median_kobo: n(market.median),
            low_kobo: n(market.low),
            high_kobo: n(market.high),
            sellers: market.sellers,
          }
        : null,
      source,
    };
  }

  /** Business report: sales, best sellers, slow movers and practical next steps. */
  async function businessReport(user: any, input: RequestInput) {
    const { days } = z
      .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
      .parse(input.query);
    await requireFeature(db, user.id, 'business_report', 'The business report');
    const [sales] = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed,COUNT(*) FILTER (WHERE status IN ('DECLINED','EXPIRED','CANCELLED'))::int AS lost,
         COUNT(*)::int AS requests,COALESCE(SUM(total_kobo) FILTER (WHERE status='COMPLETED'),0)::bigint AS gross,
         COALESCE(SUM(total_kobo-commission_kobo) FILTER (WHERE status='COMPLETED'),0)::bigint AS net
       FROM bookings WHERE seller_id=$1 AND created_at>now()-$2::int*interval '1 day'`,
      [user.id, days],
    );
    const top = await db.query(
      `SELECT l.id,l.title,COUNT(b.id)::int AS orders,COALESCE(SUM(b.total_kobo),0)::bigint AS gross FROM listings l
       JOIN bookings b ON b.listing_id=l.id AND b.status='COMPLETED' AND b.created_at>now()-$2::int*interval '1 day'
       WHERE l.seller_id=$1 GROUP BY l.id ORDER BY gross DESC LIMIT 5`,
      [user.id, days],
    );
    const slow = await db.query(
      `SELECT l.id,l.title,v.stock FROM listings l JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary
       WHERE l.seller_id=$1 AND l.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.listing_id=l.id AND b.created_at>now()-$2::int*interval '1 day')
       ORDER BY v.stock DESC LIMIT 5`,
      [user.id, days],
    );
    const low = await db.query(
      `SELECT l.id,l.title,v.stock FROM listings l JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary
       WHERE l.seller_id=$1 AND l.status='ACTIVE' AND v.stock<=3 ORDER BY v.stock LIMIT 5`,
      [user.id],
    );
    const [rating] = await db.query(
      'SELECT ROUND(AVG(score),1)::float8 AS avg,COUNT(*)::int AS n FROM ratings WHERE seller_id=$1',
      [user.id],
    );
    const actions: string[] = [];
    const acceptRate = sales.requests ? (sales.requests - sales.lost) / sales.requests : 1;
    if (sales.requests && acceptRate < 0.7)
      actions.push(
        'Many requests were declined or expired. Keep stock up to date and reply within a few hours.',
      );
    if (low.length)
      actions.push(
        `Restock soon: ${low
          .map((l: any) => l.title)
          .slice(0, 3)
          .join(', ')}.`,
      );
    if (slow.length)
      actions.push(
        `No orders lately for ${slow.length} product${slow.length === 1 ? '' : 's'}: try a better photo, a clearer title or a small discount.`,
      );
    if (!rating.n) actions.push('Ask happy buyers to leave a review: rated shops sell more.');
    if (!sales.completed)
      actions.push('Share your shop link on WhatsApp to bring your first buyers.');
    return {
      days,
      sales: {
        requests: sales.requests,
        completed: sales.completed,
        lost: sales.lost,
        gross_kobo: n(sales.gross),
        net_kobo: n(sales.net),
      },
      top_products: top.map((t: any) => ({ ...t, gross: undefined, gross_kobo: n(t.gross) })),
      slow_products: slow,
      low_stock: low,
      rating: { avg: rating.avg, count: rating.n },
      actions,
      source: 'rules',
    };
  }

  /** Market intelligence: prices and demand for a category, by state; small groups are hidden. */
  async function marketInsights(user: any, input: RequestInput) {
    const d = z
      .object({ category: z.string().max(60), state: z.string().max(40).optional() })
      .parse(input.query);
    await requireFeature(db, user.id, 'insights', 'Market insights');
    return insightsFor(d.category, d.state ?? '');
  }
  async function insightsFor(category: string, state: string) {
    const [prices] = await db.query(
      `SELECT COUNT(DISTINCT l.seller_id)::int AS sellers,COUNT(*)::int AS listings,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY v.price_kobo)::bigint AS median,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY v.price_kobo)::bigint AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY v.price_kobo)::bigint AS p75
       FROM listings l JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary JOIN sellers s ON s.user_id=l.seller_id
       WHERE l.status='ACTIVE' AND l.category=$1 AND ($2='' OR lower(s.state)=lower($2))`,
      [category, state],
    );
    const [demand] = await db.query(
      `SELECT COUNT(*) FILTER (WHERE b.created_at>now()-interval '30 days')::int AS orders_30,
         COUNT(*) FILTER (WHERE b.created_at<=now()-interval '30 days' AND b.created_at>now()-interval '60 days')::int AS orders_prev,
         (SELECT COUNT(*)::int FROM marketplace_events e WHERE e.kind='SEARCH' AND e.category=$1 AND e.created_at>now()-interval '30 days') AS searches_30
       FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN sellers s ON s.user_id=b.seller_id
       WHERE l.category=$1 AND ($2='' OR lower(s.state)=lower($2))`,
      [category, state],
    );
    const top = await db.query(
      `SELECT l.title,COUNT(*)::int AS orders FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN sellers s ON s.user_id=b.seller_id
       WHERE l.category=$1 AND ($2='' OR lower(s.state)=lower($2)) AND b.created_at>now()-interval '60 days'
       GROUP BY l.title HAVING COUNT(DISTINCT b.seller_id)>=$3 ORDER BY orders DESC LIMIT 5`,
      [category, state, MIN_SELLERS],
    );
    const enough = prices.sellers >= MIN_SELLERS;
    const trend = demand.orders_prev
      ? Math.round(((demand.orders_30 - demand.orders_prev) / demand.orders_prev) * 100)
      : null;
    return {
      category,
      state: state || 'All of Nigeria',
      sellers: prices.sellers,
      listings: prices.listings,
      price: enough
        ? { median_kobo: n(prices.median), p25_kobo: n(prices.p25), p75_kobo: n(prices.p75) }
        : null,
      demand: enough
        ? {
            orders_30_days: demand.orders_30,
            change_percent: trend,
            searches_30_days: demand.searches_30,
          }
        : null,
      popular: top,
      note: enough
        ? 'Figures combine all sellers in this group; no single seller or buyer can be identified.'
        : `Not enough sellers in this group yet (at least ${MIN_SELLERS} are needed to protect their privacy).`,
    };
  }

  /** Market research report for staff and research clients: anonymised, small groups suppressed. */
  async function researchReport(_user: any, input: RequestInput) {
    const d = z.object({ state: z.string().max(40).optional() }).parse(input.query);
    const rows = await db.query(
      `SELECT l.category,COUNT(DISTINCT l.seller_id)::int AS sellers,COUNT(*)::int AS listings,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY v.price_kobo)::bigint AS median_price,
         (SELECT COUNT(*)::int FROM bookings b JOIN listings x ON x.id=b.listing_id JOIN sellers xs ON xs.user_id=b.seller_id
            WHERE x.category=l.category AND b.created_at>now()-interval '30 days' AND ($1='' OR lower(xs.state)=lower($1))) AS orders_30,
         (SELECT COALESCE(SUM(b.total_kobo),0)::bigint FROM bookings b JOIN listings x ON x.id=b.listing_id JOIN sellers xs ON xs.user_id=b.seller_id
            WHERE x.category=l.category AND b.status='COMPLETED' AND b.created_at>now()-interval '30 days' AND ($1='' OR lower(xs.state)=lower($1))) AS gmv_30,
         (SELECT COUNT(*)::int FROM marketplace_events e WHERE e.kind='SEARCH' AND e.category=l.category AND e.created_at>now()-interval '30 days') AS searches_30
       FROM listings l JOIN listing_variants v ON v.listing_id=l.id AND v.is_primary JOIN sellers s ON s.user_id=l.seller_id
       WHERE l.status='ACTIVE' AND ($1='' OR lower(s.state)=lower($1)) GROUP BY l.category ORDER BY listings DESC`,
      [d.state ?? ''],
    );
    return {
      state: d.state || 'All of Nigeria',
      generated_at: new Date().toISOString(),
      rows: rows.map((r: any) => {
        const ok = r.sellers >= MIN_SELLERS;
        return {
          category: r.category,
          sellers: r.sellers,
          listings: r.listings,
          median_price_kobo: ok ? n(r.median_price) : null,
          orders_30_days: ok ? r.orders_30 : null,
          gmv_30_days_kobo: ok ? n(r.gmv_30) : null,
          searches_30_days: r.searches_30,
          suppressed: !ok,
        };
      }),
      note: `Anonymised and aggregated. Groups with fewer than ${MIN_SELLERS} sellers are hidden. No personal data is included.`,
    };
  }

  // ---------------------------------------------------------------- B2B requests for quotes
  async function createRfq(q: Query, user: any, input: RequestInput) {
    const d = rfqInput.parse(input.body);
    const [open] = await q.query(
      "SELECT COUNT(*)::int AS n FROM rfqs WHERE buyer_id=$1 AND status='OPEN'",
      [user.id],
    );
    ensure(open.n < 20, 400, 'RFQ_LIMIT', 'You can have up to 20 open requests.');
    const id = randomUUID();
    await q.query(
      'INSERT INTO rfqs(id,buyer_id,business_name,title,category,quantity,unit,details,state,city,needed_by,budget_kobo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        id,
        user.id,
        d.business_name,
        d.title,
        d.category,
        d.quantity,
        d.unit,
        d.details,
        d.state,
        d.city,
        d.needed_by ?? null,
        d.budget_kobo ?? null,
      ],
    );
    return { id };
  }
  const rfqOut = (r: any) => ({
    ...r,
    budget_kobo: r.budget_kobo == null ? null : n(r.budget_kobo),
    needed_by: r.needed_by ? new Date(r.needed_by).toISOString().slice(0, 10) : null,
  });
  async function myRfqs(user: any, _input?: RequestInput) {
    return (
      await db.query(
        "SELECT r.*,(SELECT COUNT(*)::int FROM rfq_quotes x WHERE x.rfq_id=r.id) AS quotes FROM rfqs r WHERE r.buyer_id=$1 ORDER BY (r.status='OPEN') DESC,r.created_at DESC LIMIT 50",
        [user.id],
      )
    ).map(rfqOut);
  }
  /** Open requests sellers can quote on, matching categories they sell in first. */
  async function openRfqs(user: any, _input?: RequestInput) {
    const [s] = await db.query(
      "SELECT user_id FROM sellers WHERE user_id=$1 AND status='APPROVED'",
      [user.id],
    );
    ensure(s, 403, 'SELLER_NOT_APPROVED', 'Approved sellers can quote on bulk requests.');
    return (
      await db.query(
        `SELECT r.id,r.business_name,r.title,r.category,r.quantity,r.unit,r.details,r.state,r.city,r.needed_by,r.budget_kobo,r.status,r.created_at,
           EXISTS(SELECT 1 FROM listings l WHERE l.seller_id=$1 AND l.category=r.category AND l.status='ACTIVE') AS matches_my_shop,
           (SELECT row_to_json(x) FROM (SELECT id,total_kobo,delivery_days,note,status FROM rfq_quotes WHERE rfq_id=r.id AND seller_id=$1) x) AS my_quote
         FROM rfqs r WHERE r.status='OPEN' AND r.buyer_id<>$1 ORDER BY matches_my_shop DESC,r.created_at DESC LIMIT 60`,
        [user.id],
      )
    ).map(rfqOut);
  }
  async function getRfq(user: any, input: RequestInput) {
    const [r] = await db.query('SELECT * FROM rfqs WHERE id=$1', [input.params.id]);
    ensure(r && r.buyer_id === user.id, 404, 'NOT_FOUND', 'Request not found.');
    const quotes = await db.query(
      `SELECT q.id,q.total_kobo,q.delivery_days,q.note,q.status,q.created_at,s.user_id AS seller_id,s.business_name,s.area,s.city,
         (s.verification_status='VERIFIED' AND s.verification_expires_at>now()) AS verified,
         (SELECT ROUND(AVG(score),1)::float8 FROM ratings WHERE seller_id=s.user_id) AS rating_avg
       FROM rfq_quotes q JOIN sellers s ON s.user_id=q.seller_id WHERE q.rfq_id=$1 ORDER BY q.total_kobo`,
      [r.id],
    );
    return {
      ...rfqOut(r),
      quotes: quotes.map((x: any) => ({ ...x, total_kobo: n(x.total_kobo) })),
    };
  }
  async function submitQuote(q: Query, user: any, input: RequestInput) {
    const d = quoteInput.parse(input.body);
    const [r] = await q.query("SELECT * FROM rfqs WHERE id=$1 AND status='OPEN'", [
      input.params.id,
    ]);
    ensure(r, 404, 'NOT_FOUND', 'This request is no longer open.');
    ensure(r.buyer_id !== user.id, 400, 'OWN_REQUEST', 'You can’t quote on your own request.');
    const [s] = await q.query(
      "SELECT business_name FROM sellers WHERE user_id=$1 AND status='APPROVED'",
      [user.id],
    );
    ensure(s, 403, 'SELLER_NOT_APPROVED', 'Approved sellers can quote.');
    const id = randomUUID();
    await q.query(
      `INSERT INTO rfq_quotes(id,rfq_id,seller_id,total_kobo,delivery_days,note) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(rfq_id,seller_id) DO UPDATE SET total_kobo=EXCLUDED.total_kobo,delivery_days=EXCLUDED.delivery_days,note=EXCLUDED.note,status='SUBMITTED',created_at=now()`,
      [id, r.id, user.id, d.total_kobo, d.delivery_days, d.note],
    );
    await notify(
      q,
      r.buyer_id,
      'rfq',
      'New quote on your bulk request',
      `${s.business_name} quoted ₦${(d.total_kobo / 100).toLocaleString('en-NG')} for “${r.title}”.`,
    );
    return { ok: true };
  }
  async function acceptQuote(q: Query, user: any, input: RequestInput) {
    const [r] = await q.query(
      "SELECT * FROM rfqs WHERE id=$1 AND buyer_id=$2 AND status='OPEN' FOR UPDATE",
      [input.params.id, user.id],
    );
    ensure(r, 404, 'NOT_FOUND', 'Open request not found.');
    const [quote] = await q.query(
      "UPDATE rfq_quotes SET status='ACCEPTED' WHERE id=$1 AND rfq_id=$2 RETURNING seller_id,total_kobo",
      [input.params.quoteId, r.id],
    );
    ensure(quote, 404, 'NOT_FOUND', 'Quote not found.');
    await q.query("UPDATE rfq_quotes SET status='DECLINED' WHERE rfq_id=$1 AND id<>$2", [
      r.id,
      input.params.quoteId,
    ]);
    await q.query("UPDATE rfqs SET status='AWARDED' WHERE id=$1", [r.id]);
    await notify(
      q,
      quote.seller_id,
      'rfq',
      'Your quote was accepted',
      `${user.name} accepted your quote for “${r.title}”. They will contact you to arrange payment and delivery.`,
    );
    return { ok: true, seller_id: quote.seller_id as string };
  }
  async function closeRfq(q: Query, user: any, input: RequestInput) {
    const [r] = await q.query(
      "UPDATE rfqs SET status='CLOSED' WHERE id=$1 AND buyer_id=$2 AND status='OPEN' RETURNING id",
      [input.params.id, user.id],
    );
    ensure(r, 404, 'NOT_FOUND', 'Open request not found.');
    return { ok: true };
  }

  // ---------------------------------------------------------------- enterprise: team and bulk upload
  async function listTeam(user: any, _input?: RequestInput) {
    const f = await sellerFeatures(db, user.id);
    const members = await db.query(
      'SELECT m.user_id,u.name,u.email,m.role,m.added_at FROM seller_team_members m JOIN users u ON u.id=m.user_id WHERE m.seller_id=$1 ORDER BY m.added_at',
      [user.id],
    );
    const activity = await db.query(
      `SELECT a.id,u.name AS member_name,a.role,a.method,a.path,a.status,a.created_at FROM team_activity a JOIN users u ON u.id=a.member_id
       WHERE a.seller_id=$1 ORDER BY a.created_at DESC LIMIT 30`,
      [user.id],
    );
    return {
      seats: f.team_seats,
      members,
      activity,
      note: 'Staff manage products, stories, orders and chats. Managers can also cancel orders, bulk upload and quote on bulk requests. Money, plans and the team stay with you.',
    };
  }
  /** Shops this user works for, to switch into from the app. */
  async function myTeams(user: any, _input?: RequestInput) {
    return db.query(
      `SELECT m.seller_id,s.business_name,s.area,s.city,m.role,m.added_at FROM seller_team_members m
       JOIN sellers s ON s.user_id=m.seller_id WHERE m.user_id=$1 AND s.status='APPROVED' ORDER BY s.business_name`,
      [user.id],
    );
  }
  async function addTeamMember(q: Query, user: any, input: RequestInput) {
    const d = teamInput.parse(input.body);
    const f = await requireFeature(q, user.id, 'team_seats', 'Team accounts');
    const [count] = await q.query(
      'SELECT COUNT(*)::int AS n FROM seller_team_members WHERE seller_id=$1',
      [user.id],
    );
    ensure(
      count.n < f.team_seats,
      400,
      'SEATS_FULL',
      `Your plan includes ${f.team_seats} team seat${f.team_seats === 1 ? '' : 's'}.`,
    );
    const [member] = await q.query(
      "SELECT id,name FROM users WHERE (lower(email)=lower($1) OR phone=$1) AND status='ACTIVE'",
      [d.contact],
    );
    ensure(member, 404, 'USER_NOT_FOUND', 'No Ahia account uses that email or phone number.');
    ensure(member.id !== user.id, 400, 'SELF', 'You are already the owner.');
    await q.query(
      'INSERT INTO seller_team_members(seller_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(seller_id,user_id) DO UPDATE SET role=EXCLUDED.role',
      [user.id, member.id, d.role],
    );
    await audit(q, user.id, 'team.add', member.id, { role: d.role });
    await notify(
      q,
      member.id,
      'team',
      'You joined a shop team',
      `${user.name} added you to their shop team as ${d.role.toLowerCase()}.`,
    );
    return { ok: true };
  }
  async function removeTeamMember(q: Query, user: any, input: RequestInput) {
    const [m] = await q.query(
      'DELETE FROM seller_team_members WHERE seller_id=$1 AND user_id=$2 RETURNING user_id',
      [user.id, input.params.userId],
    );
    ensure(m, 404, 'NOT_FOUND', 'Not on your team.');
    return { ok: true };
  }
  /** Bulk upload: up to 200 listings at once, each checked like a normal listing; all or nothing. */
  async function importListings(q: Query, user: any, input: RequestInput) {
    const d = importInput.parse(input.body);
    await requireFeature(q, user.id, 'bulk_import', 'Bulk upload');
    const ids: string[] = [];
    for (const [i, item] of d.items.entries()) {
      try {
        const created: any = await marketplace.createListing(q, user, {
          body: item,
          params: {},
          query: {},
        } as unknown as RequestInput);
        ids.push(created.id);
      } catch (e: any) {
        e.message = `Row ${i + 1} (${item.title || 'untitled'}): ${e.message}`;
        throw e;
      }
    }
    return { created: ids.length, ids };
  }

  return {
    listPlans,
    mySubscriptions,
    subscribe,
    cancelSubscription,
    adminPlans,
    savePlan,
    adminSubscriptions,
    activateSubscription,
    listingAssist,
    businessReport,
    marketInsights,
    researchReport,
    createRfq,
    myRfqs,
    openRfqs,
    getRfq,
    submitQuote,
    acceptQuote,
    closeRfq,
    listTeam,
    myTeams,
    addTeamMember,
    removeTeamMember,
    importListings,
  };
}
