import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
import { verifiedSql } from './business-verification.service.js';
import { stateAt } from '../config/nigeria-states.js';
import { storage } from '../lib/storage.js';
import sharp from 'sharp';

export const monetisationKeys = [
  'transaction_commission',
  'delivery_commission',
  'sponsored_products',
  'featured_sellers',
  'local_ads',
] as const;
export type Monetisation = Record<(typeof monetisationKeys)[number], boolean>;
export const switchesInput = z.object(
  Object.fromEntries(monetisationKeys.map((k) => [k, z.boolean()])) as Record<
    (typeof monetisationKeys)[number],
    z.ZodBoolean
  >,
);

/** Owner switches for commissions and paid features (all on unless switched off). */
export async function monetisation(q: Query): Promise<Monetisation> {
  const [s] = await q.query('SELECT monetisation FROM settings WHERE id=1');
  const m = s?.monetisation || {};
  return Object.fromEntries(monetisationKeys.map((k) => [k, m[k] !== false])) as Monetisation;
}

export const packageInput = z.object({
  kind: z.enum(['PRODUCT', 'SELLER']),
  name: z.string().trim().min(2).max(60),
  days: z.number().int().min(1).max(365),
  price_kobo: z.number().int().min(0).max(10_000_000_000),
  active: z.boolean().default(true),
});
export const featureShopInput = z.object({ package_id: z.string().max(64) });
export const adInput = z.object({
  advertiser: z.string().trim().min(2).max(120),
  contact_name: z.string().trim().max(120).default(''),
  contact_phone: z.string().trim().max(30).default(''),
  contact_email: z.string().trim().max(160).default(''),
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().max(240).default(''),
  image_url: z.string().url().max(500).nullable().optional(),
  link_url: z.string().url().max(500).nullable().optional(),
  cta: z.string().trim().min(2).max(24).default('Learn more'),
  states: z.array(z.string().trim().min(2).max(40)).max(37).default([]),
  lgas: z.array(z.string().trim().min(2).max(60)).max(50).default([]),
  categories: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  price_kobo: z.number().int().min(0).max(10_000_000_000),
});
export const adStatusInput = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']) });
export const adPaymentInput = z.object({
  amount_kobo: z.number().int().min(1).max(10_000_000_000),
  /** Bank transfer or invoice reference the advertiser paid with. */
  reference: z.string().trim().min(3).max(120),
});
export const partnerInput = z.object({
  name: z.string().trim().min(2).max(120),
  contact_name: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(160).default(''),
  states: z.array(z.string().trim().min(2).max(40)).max(37).default([]),
  commission_bps: z.number().int().min(0).max(5000),
  status: z.enum(['ACTIVE', 'PAUSED']).default('ACTIVE'),
  notes: z.string().trim().max(1000).default(''),
});
export const partnerDriverInput = z.object({
  driver_id: z.string().max(64),
  remove: z.boolean().default(false),
});
export const reportInput = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Where each platform_revenue posting came from, by the ledger reference it carries. */
const STREAM_SQL = `CASE
  WHEN EXISTS(SELECT 1 FROM bookings x WHERE x.id=l.reference) THEN 'transaction_commission'
  WHEN EXISTS(SELECT 1 FROM deliveries x WHERE x.id=l.reference AND x.partner_id IS NOT NULL) THEN 'delivery_partner_commission'
  WHEN EXISTS(SELECT 1 FROM deliveries x WHERE x.id=l.reference) THEN 'delivery_commission'
  WHEN EXISTS(SELECT 1 FROM parcel_jobs x WHERE x.id=l.reference) THEN 'parcel_delivery'
  WHEN EXISTS(SELECT 1 FROM promotions x WHERE x.id=l.reference) THEN 'sponsored_products'
  WHEN EXISTS(SELECT 1 FROM featured_sellers x WHERE x.id=l.reference) THEN 'featured_sellers'
  WHEN EXISTS(SELECT 1 FROM ad_campaigns x WHERE x.id=l.reference) THEN 'local_ads'
  WHEN EXISTS(SELECT 1 FROM status_boosts x WHERE x.id=l.reference) THEN 'status_boosts'
  WHEN EXISTS(SELECT 1 FROM shopping_requests x WHERE x.id=l.reference) THEN 'rider_shopping'
  WHEN EXISTS(SELECT 1 FROM payouts x WHERE x.id=l.reference) THEN 'payout_fees'
  WHEN EXISTS(SELECT 1 FROM return_journeys x WHERE x.id=l.reference) THEN 'return_transport'
  WHEN EXISTS(SELECT 1 FROM disputes x WHERE x.id=l.reference) THEN 'refund_adjustments'
  WHEN EXISTS(SELECT 1 FROM subscriptions x WHERE x.id=l.reference) THEN 'subscriptions'
  ELSE 'other' END`;
export const streamLabels: Record<string, string> = {
  transaction_commission: 'Transaction commission',
  delivery_commission: 'Delivery commission (independent riders)',
  delivery_partner_commission: 'Delivery partner commission',
  parcel_delivery: 'Parcel delivery',
  sponsored_products: 'Sponsored products',
  featured_sellers: 'Featured sellers',
  local_ads: 'Local business advertising',
  status_boosts: 'Status boosts',
  rider_shopping: 'Rider shopping',
  payout_fees: 'Payout fees',
  return_transport: 'Return transport',
  refund_adjustments: 'Refund adjustments',
  subscriptions: 'Subscriptions and membership',
  other: 'Other',
};
const n = (v: unknown) => Number(v ?? 0);

/**
 * Revenue features: owner switches, fixed promotion packages, featured shops (paid from seller
 * proceeds), local business advertising (paid offline and recorded), delivery partner companies,
 * and income by stream. Paid visibility is always labelled and never grants verification.
 */
export function createRevenueService(deps: AppDeps) {
  const { db } = deps;

  // ---------- switches ----------
  async function getSwitches(_user: any, _input?: RequestInput) {
    return monetisation(db);
  }
  async function saveSwitches(q: Query, user: any, input: RequestInput) {
    const d = switchesInput.parse(input.body);
    await q.query('UPDATE settings SET monetisation=$1 WHERE id=1', [JSON.stringify(d)]);
    await audit(q, user.id, 'revenue.switches', 'settings', d);
    return d;
  }

  // ---------- packages ----------
  async function listPackages(_user: any, input: RequestInput) {
    const { kind } = z
      .object({ kind: z.enum(['PRODUCT', 'SELLER']).optional() })
      .parse(input.query);
    return (
      await db.query(
        'SELECT * FROM promotion_packages WHERE active AND ($1::text IS NULL OR kind=$1) ORDER BY kind,days',
        [kind ?? null],
      )
    ).map((p: any) => ({ ...p, price_kobo: n(p.price_kobo) }));
  }
  async function adminPackages(_user: any, _input?: RequestInput) {
    return (await db.query('SELECT * FROM promotion_packages ORDER BY kind,days')).map(
      (p: any) => ({
        ...p,
        price_kobo: n(p.price_kobo),
      }),
    );
  }
  async function savePackage(q: Query, user: any, input: RequestInput) {
    const d = packageInput.parse(input.body);
    const id = input.params.id || randomUUID();
    await q.query(
      `INSERT INTO promotion_packages(id,kind,name,days,price_kobo,active) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET kind=$2,name=$3,days=$4,price_kobo=$5,active=$6`,
      [id, d.kind, d.name, d.days, d.price_kobo, d.active],
    );
    await audit(q, user.id, 'revenue.package', id, d);
    return { id };
  }

  // ---------- featured shops ----------
  async function featureMyShop(q: Query, user: any, input: RequestInput) {
    const d = featureShopInput.parse(input.body);
    ensure(
      (await monetisation(q)).featured_sellers,
      409,
      'FEATURE_PAUSED',
      'Featured shops are paused right now.',
    );
    const [s] = await q.query('SELECT status FROM sellers WHERE user_id=$1 FOR UPDATE', [user.id]);
    ensure(s?.status === 'APPROVED', 403, 'SELLER_NOT_APPROVED', 'Approved sellers only.');
    const [pkg] = await q.query(
      "SELECT * FROM promotion_packages WHERE id=$1 AND kind='SELLER' AND active",
      [d.package_id],
    );
    ensure(pkg, 400, 'UNKNOWN_PACKAGE', 'Choose one of the featured shop packages.');
    const [running] = await q.query(
      "SELECT id FROM featured_sellers WHERE seller_id=$1 AND status='ACTIVE' AND ends_at>now()",
      [user.id],
    );
    ensure(!running, 409, 'ALREADY_FEATURED', 'Your shop is already featured.');
    const fee = n(pkg.price_kobo);
    ensure(
      (await lockedBalance(q, user.id, 'seller_payable')) >= fee,
      409,
      'INSUFFICIENT_PROCEEDS',
      `${pkg.name} costs ₦${(fee / 100).toLocaleString('en-NG')}, paid from your sales proceeds.`,
    );
    const id = randomUUID();
    await q.query(
      "INSERT INTO featured_sellers(id,seller_id,package_id,days,fee_kobo,ends_at) VALUES($1,$2,$3,$4,$5,now()+$4::int*interval '1 day')",
      [id, user.id, pkg.id, pkg.days, fee],
    );
    if (fee)
      await ledger(q, id, [
        { account: 'seller_payable', owner: user.id, amount: -fee },
        { account: 'platform_revenue', amount: fee },
      ]);
    await audit(q, user.id, 'featured_seller.create', id, { package: pkg.id, fee });
    return { id, ends_in_days: pkg.days as number, fee_kobo: fee };
  }
  async function myFeatured(user: any, _input?: RequestInput) {
    return (
      await db.query(
        "SELECT f.*,p.name AS package_name,(f.status='ACTIVE' AND f.ends_at>now()) AS running FROM featured_sellers f LEFT JOIN promotion_packages p ON p.id=f.package_id WHERE f.seller_id=$1 ORDER BY f.created_at DESC LIMIT 20",
        [user.id],
      )
    ).map((f: any) => ({ ...f, fee_kobo: n(f.fee_kobo), refund_kobo: n(f.refund_kobo) }));
  }
  /** Featured shops for the Home rail; nearest first when the buyer shares an area. */
  async function featuredSellers(user: any, input: RequestInput) {
    const d = z
      .object({
        state: z.string().max(40).optional(),
        lga: z.string().max(60).optional(),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
      })
      .parse(input.query);
    if (!(await monetisation(db)).featured_sellers) return [];
    if (!d.state && d.lat != null && d.lng != null) d.state = stateAt(d.lat, d.lng);
    return db.query(
      `SELECT s.user_id AS seller_id,s.business_name,s.business_type,s.area,s.city,s.state,${verifiedSql()} AS verified,
         COALESCE((SELECT ROUND(AVG(r.score),1)::float8 FROM ratings r WHERE r.seller_id=s.user_id),0) AS rating_avg,
         (SELECT COUNT(*)::int FROM ratings r WHERE r.seller_id=s.user_id) AS rating_count,
         (SELECT COUNT(*)::int FROM listings l WHERE l.seller_id=s.user_id AND l.status='ACTIVE') AS products,
         (SELECT COALESCE(m.thumbnail_url,l.image_url) FROM listings l LEFT JOIN media m ON m.url=l.image_url
            WHERE l.seller_id=s.user_id AND l.status='ACTIVE' AND l.image_url IS NOT NULL ORDER BY l.created_at DESC LIMIT 1) AS image_url
       FROM featured_sellers f JOIN sellers s ON s.user_id=f.seller_id
       WHERE f.status='ACTIVE' AND f.starts_at<=now() AND f.ends_at>now() AND s.status='APPROVED' AND s.user_id<>$1
       ORDER BY (lower(s.lga)=lower($3)) DESC,(lower(s.state)=lower($2)) DESC,random() LIMIT 10`,
      [user.id, d.state ?? '', d.lga ?? ''],
    );
  }
  async function adminFeatured(_user: any, _input?: RequestInput) {
    return (
      await db.query(
        `SELECT f.*,s.business_name,p.name AS package_name,(f.status='ACTIVE' AND f.ends_at>now()) AS running
         FROM featured_sellers f JOIN sellers s ON s.user_id=f.seller_id LEFT JOIN promotion_packages p ON p.id=f.package_id
         ORDER BY running DESC,f.created_at DESC LIMIT 200`,
      )
    ).map((f: any) => ({ ...f, fee_kobo: n(f.fee_kobo), refund_kobo: n(f.refund_kobo) }));
  }
  async function cancelFeatured(q: Query, user: any, input: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(5).max(500) }).parse(input.body);
    const [f] = await q.query('SELECT * FROM featured_sellers WHERE id=$1 FOR UPDATE', [
      input.params.id,
    ]);
    ensure(f, 404, 'NOT_FOUND', 'Featured shop not found.');
    ensure(
      f.status === 'ACTIVE' && new Date(f.ends_at).getTime() > Date.now(),
      409,
      'INVALID_TRANSITION',
      'Only running featured shops can be stopped.',
    );
    const unused = Math.floor((new Date(f.ends_at).getTime() - Date.now()) / 86400000);
    const refund = Math.min(n(f.fee_kobo), Math.round((n(f.fee_kobo) / f.days) * unused));
    if (refund)
      await ledger(q, f.id, [
        { account: 'platform_revenue', amount: -refund },
        { account: 'seller_payable', owner: f.seller_id, amount: refund },
      ]);
    await q.query(
      "UPDATE featured_sellers SET status='CANCELLED',cancel_reason=$1,refund_kobo=$2,ends_at=LEAST(ends_at,now()) WHERE id=$3",
      [d.reason, refund, f.id],
    );
    await audit(q, user.id, 'featured_seller.cancel', f.id, { ...d, refund });
    await notify(
      q,
      f.seller_id,
      'promotion',
      'Featured shop stopped',
      `${d.reason}${refund ? ` ₦${(refund / 100).toLocaleString('en-NG')} for unused days was returned to your proceeds.` : ''}`,
    );
    return { ok: true, refund_kobo: refund };
  }

  // ---------- local business advertising ----------
  const adOut = (a: any) => ({ ...a, price_kobo: n(a.price_kobo), paid_kobo: n(a.paid_kobo) });
  async function serveAds(_user: any, input: RequestInput) {
    const d = z
      .object({
        state: z.string().max(40).optional(),
        lga: z.string().max(60).optional(),
        category: z.string().max(60).optional(),
        limit: z.coerce.number().int().min(1).max(5).default(1),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
      })
      .parse(input.query);
    if (!(await monetisation(db)).local_ads) return [];
    // A buyer who shares their location is placed in a state for targeting.
    if (!d.state && d.lat != null && d.lng != null) d.state = stateAt(d.lat, d.lng);
    const rows = await db.query(
      `UPDATE ad_campaigns SET impressions=impressions+1 WHERE id IN (
         SELECT id FROM ad_campaigns WHERE status='ACTIVE' AND starts_at<=now() AND ends_at>now() AND paid_kobo>=price_kobo
           AND (cardinality(states)=0 OR lower($1) = ANY(SELECT lower(x) FROM unnest(states) x))
           AND (cardinality(lgas)=0 OR lower($2) = ANY(SELECT lower(x) FROM unnest(lgas) x))
           AND (cardinality(categories)=0 OR $3 = ANY(categories) OR $3='')
         ORDER BY random() LIMIT $4)
       RETURNING id,advertiser,title,body,image_url,link_url,cta`,
      [d.state ?? '', d.lga ?? '', d.category ?? '', d.limit],
    );
    return rows.map((a: any) => ({ ...a, label: 'Advertisement' }));
  }
  async function clickAd(_user: any, input: RequestInput) {
    const [a] = await db.query(
      "UPDATE ad_campaigns SET clicks=clicks+1 WHERE id=$1 AND status='ACTIVE' RETURNING link_url",
      [input.params.id],
    );
    ensure(a, 404, 'NOT_FOUND', 'This advert has ended.');
    return { link_url: a.link_url as string | null };
  }
  async function adminAds(_user: any, _input?: RequestInput) {
    return (
      await db.query(
        `SELECT a.*,(a.status='ACTIVE' AND a.starts_at<=now() AND a.ends_at>now() AND a.paid_kobo>=a.price_kobo) AS live,
           CASE WHEN a.impressions>0 THEN ROUND(a.clicks*1000.0/a.impressions)/10 ELSE 0 END::float8 AS click_rate
         FROM ad_campaigns a ORDER BY live DESC,a.created_at DESC LIMIT 200`,
      )
    ).map(adOut);
  }
  async function saveAd(q: Query, user: any, input: RequestInput) {
    const d = adInput.parse(input.body);
    ensure(
      new Date(d.ends_at) > new Date(d.starts_at),
      400,
      'INVALID_DATES',
      'The end date must be after the start.',
    );
    const id = input.params.id || randomUUID();
    if (input.params.id) {
      const [a] = await q.query('SELECT id FROM ad_campaigns WHERE id=$1', [id]);
      ensure(a, 404, 'NOT_FOUND', 'Campaign not found.');
    }
    await q.query(
      `INSERT INTO ad_campaigns(id,advertiser,contact_name,contact_phone,contact_email,title,body,image_url,link_url,cta,states,lgas,categories,starts_at,ends_at,price_kobo,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT(id) DO UPDATE SET advertiser=$2,contact_name=$3,contact_phone=$4,contact_email=$5,title=$6,body=$7,image_url=$8,
         link_url=$9,cta=$10,states=$11,lgas=$12,categories=$13,starts_at=$14,ends_at=$15,price_kobo=$16`,
      [
        id,
        d.advertiser,
        d.contact_name,
        d.contact_phone,
        d.contact_email,
        d.title,
        d.body,
        d.image_url ?? null,
        d.link_url ?? null,
        d.cta,
        d.states,
        d.lgas,
        d.categories,
        d.starts_at,
        d.ends_at,
        d.price_kobo,
        user.id,
      ],
    );
    await audit(q, user.id, 'ad.save', id, { advertiser: d.advertiser, price_kobo: d.price_kobo });
    return { id };
  }
  async function setAdStatus(q: Query, user: any, input: RequestInput) {
    const d = adStatusInput.parse(input.body);
    const [a] = await q.query('SELECT * FROM ad_campaigns WHERE id=$1 FOR UPDATE', [
      input.params.id,
    ]);
    ensure(a, 404, 'NOT_FOUND', 'Campaign not found.');
    ensure(
      d.status !== 'ACTIVE' || n(a.paid_kobo) >= n(a.price_kobo),
      409,
      'NOT_PAID',
      'Record the advertiser’s payment before the campaign goes live.',
    );
    await q.query('UPDATE ad_campaigns SET status=$1 WHERE id=$2', [d.status, a.id]);
    await audit(q, user.id, `ad.${d.status.toLowerCase()}`, a.id);
    return { ok: true };
  }
  /** Advertisers pay by transfer or invoice; staff record it, and it becomes revenue. */
  async function recordAdPayment(q: Query, user: any, input: RequestInput) {
    const d = adPaymentInput.parse(input.body);
    const [a] = await q.query('SELECT * FROM ad_campaigns WHERE id=$1 FOR UPDATE', [
      input.params.id,
    ]);
    ensure(a, 404, 'NOT_FOUND', 'Campaign not found.');
    ensure(
      n(a.paid_kobo) + d.amount_kobo <= n(a.price_kobo),
      400,
      'OVERPAYMENT',
      `Only ₦${((n(a.price_kobo) - n(a.paid_kobo)) / 100).toLocaleString('en-NG')} is outstanding on this campaign.`,
    );
    await q.query(
      'INSERT INTO ad_payments(id,campaign_id,amount_kobo,reference,recorded_by) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), a.id, d.amount_kobo, d.reference, user.id],
    );
    await q.query('UPDATE ad_campaigns SET paid_kobo=paid_kobo+$1 WHERE id=$2', [
      d.amount_kobo,
      a.id,
    ]);
    await ledger(q, a.id, [
      { account: 'advertising_receipts', amount: -d.amount_kobo },
      { account: 'platform_revenue', amount: d.amount_kobo },
    ]);
    await audit(q, user.id, 'ad.payment', a.id, d);
    return { ok: true };
  }

  /** Staff upload an advert banner (JPEG, PNG or WebP); stored and served like product photos. */
  async function uploadAdImage(user: any, input: RequestInput) {
    const [a] = await db.query('SELECT id FROM ad_campaigns WHERE id=$1', [input.params.id]);
    ensure(a, 404, 'NOT_FOUND', 'Campaign not found.');
    ensure(input.file, 400, 'IMAGE_REQUIRED', 'Choose a JPEG, PNG or WebP image under 5 MB.');
    const meta = await sharp(input.file.buffer, { limitInputPixels: 40000000 })
      .metadata()
      .catch(() => null);
    ensure(
      meta && ['jpeg', 'png', 'webp'].includes(meta.format || ''),
      400,
      'INVALID_IMAGE',
      'This file is not a supported image.',
    );
    const full = await sharp(input.file.buffer, { limitInputPixels: 40000000 })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const key = randomUUID();
    const store = storage(deps.config);
    const storageKey = `ads/${a.id}/${key}.webp`;
    await store.put(storageKey, full, 'image/webp');
    const url = `${deps.config.publicApiUrl.replace(/\/$/, '')}/media/${key}.webp`;
    await db.query(
      'INSERT INTO media(id,owner_id,url,thumbnail_url,storage_provider,storage_key,thumbnail_key) VALUES($1,$2,$3,$3,$4,$5,$5)',
      [key, user.id, url, store.provider(), storageKey],
    );
    await db.query('UPDATE ad_campaigns SET image_url=$1 WHERE id=$2', [url, a.id]);
    await db.transaction((q) => audit(q, user.id, 'ad.image', a.id, { url }));
    return { image_url: url };
  }

  // ---------- delivery partners ----------
  async function adminPartners(_user: any, _input?: RequestInput) {
    return (
      await db.query(
        `SELECT p.*,(SELECT COUNT(*)::int FROM drivers d WHERE d.partner_id=p.id) AS drivers,
           (SELECT COUNT(*)::int FROM deliveries d WHERE d.partner_id=p.id) AS deliveries,
           COALESCE((SELECT SUM(l.amount_kobo) FROM ledger l JOIN deliveries d ON d.id=l.reference
             WHERE d.partner_id=p.id AND l.account='platform_revenue'),0)::bigint AS commission_kobo,
           (SELECT json_agg(json_build_object('driver_id',d.user_id,'name',u.name,'vehicle_type',d.vehicle_type,'city',d.city))
              FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.partner_id=p.id) AS riders
         FROM delivery_partners p ORDER BY p.status,p.name`,
      )
    ).map((p: any) => ({ ...p, commission_kobo: n(p.commission_kobo), riders: p.riders || [] }));
  }
  async function savePartner(q: Query, user: any, input: RequestInput) {
    const d = partnerInput.parse(input.body);
    const id = input.params.id || randomUUID();
    await q.query(
      `INSERT INTO delivery_partners(id,name,contact_name,phone,email,states,commission_bps,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET name=$2,contact_name=$3,phone=$4,email=$5,states=$6,commission_bps=$7,status=$8,notes=$9`,
      [id, d.name, d.contact_name, d.phone, d.email, d.states, d.commission_bps, d.status, d.notes],
    );
    await audit(q, user.id, 'delivery_partner.save', id, d);
    return { id };
  }
  async function assignPartnerDriver(q: Query, user: any, input: RequestInput) {
    const d = partnerDriverInput.parse(input.body);
    const [p] = await q.query('SELECT id FROM delivery_partners WHERE id=$1', [input.params.id]);
    ensure(p, 404, 'NOT_FOUND', 'Partner not found.');
    const [driver] = await q.query(
      'UPDATE drivers SET partner_id=$1 WHERE user_id=$2 RETURNING user_id',
      [d.remove ? null : p.id, d.driver_id],
    );
    ensure(driver, 404, 'NOT_FOUND', 'Rider not found.');
    await audit(
      q,
      user.id,
      d.remove ? 'delivery_partner.remove_rider' : 'delivery_partner.add_rider',
      p.id,
      {
        driver_id: d.driver_id,
      },
    );
    return { ok: true };
  }

  // ---------- revenue report ----------
  async function revenueReport(_user: any, input: RequestInput) {
    const d = reportInput.parse(input.query);
    const to = d.to ?? new Date().toISOString().slice(0, 10);
    const from = d.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    ensure(from <= to, 400, 'INVALID_RANGE', 'The start date must be before the end date.');
    const rows = await db.query(
      `SELECT ${STREAM_SQL} AS stream,to_char(l.created_at AT TIME ZONE 'Africa/Lagos','YYYY-MM-DD') AS day,
         SUM(l.amount_kobo)::bigint AS amount,COUNT(*)::int AS entries
       FROM ledger l WHERE l.account='platform_revenue'
         AND l.created_at>=($1::date AT TIME ZONE 'Africa/Lagos') AND l.created_at<(($2::date+1) AT TIME ZONE 'Africa/Lagos')
       GROUP BY 1,2 ORDER BY 2`,
      [from, to],
    );
    const streams = new Map<string, { amount: number; entries: number }>();
    const days = new Map<string, number>();
    for (const r of rows) {
      const s = streams.get(r.stream) || { amount: 0, entries: 0 };
      s.amount += n(r.amount);
      s.entries += r.entries;
      streams.set(r.stream, s);
      days.set(r.day, (days.get(r.day) || 0) + n(r.amount));
    }
    const total = [...streams.values()].reduce((a, s) => a + s.amount, 0);
    const [counts] = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed_orders,
         COUNT(*) FILTER (WHERE status IN ('CANCELLED','DECLINED','EXPIRED'))::int AS cancelled_orders,
         COALESCE(SUM(total_kobo) FILTER (WHERE status='COMPLETED'),0)::bigint AS gross_kobo
       FROM bookings WHERE created_at>=($1::date AT TIME ZONE 'Africa/Lagos') AND created_at<(($2::date+1) AT TIME ZONE 'Africa/Lagos')`,
      [from, to],
    );
    const series: { day: string; amount_kobo: number }[] = [];
    for (
      let t = new Date(`${from}T00:00:00Z`);
      t <= new Date(`${to}T00:00:00Z`);
      t = new Date(t.getTime() + 86400000)
    ) {
      const day = t.toISOString().slice(0, 10);
      series.push({ day, amount_kobo: days.get(day) || 0 });
    }
    return {
      from,
      to,
      total_kobo: total,
      streams: Object.keys(streamLabels)
        .map((key) => ({
          stream: key,
          label: streamLabels[key],
          amount_kobo: streams.get(key)?.amount || 0,
          entries: streams.get(key)?.entries || 0,
          share: total ? Math.round(((streams.get(key)?.amount || 0) / total) * 1000) / 10 : 0,
        }))
        .filter((s) => s.amount_kobo !== 0 || s.entries > 0),
      orders: {
        completed: counts.completed_orders,
        cancelled: counts.cancelled_orders,
        gross_kobo: n(counts.gross_kobo),
      },
      series: series.slice(-92),
      switches: await monetisation(db),
      note: 'Income is counted when it is posted to the ledger (for example a commission when an order completes). Refunds appear as negative adjustments.',
    };
  }

  return {
    getSwitches,
    saveSwitches,
    listPackages,
    adminPackages,
    savePackage,
    featureMyShop,
    myFeatured,
    featuredSellers,
    adminFeatured,
    cancelFeatured,
    serveAds,
    clickAd,
    adminAds,
    saveAd,
    setAdStatus,
    recordAdPayment,
    uploadAdImage,
    adminPartners,
    savePartner,
    assignPartnerDriver,
    revenueReport,
  };
}
