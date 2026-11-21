import { validateCategory } from './catalogue-policy.service.js';
import { stopStatusBoosts } from './status-boost.service.js';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query, Database } from '../database/client.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { bookableSql } from './retention.service.js';
import { activePromotion } from './promotions.service.js';

export const statusAreaInput = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  state: z.string().trim().max(100).default(''),
  lga: z.string().trim().max(100).default(''),
  city: z.string().trim().max(100).default(''),
  category: z.string().trim().max(50).default(''),
  cursor: z.string().max(300).optional(),
});
export const publishStatusInput = z.object({
  listing_id: z.uuid(),
  caption: z.string().trim().max(500).default(''),
  media_url: z.url().max(2000).optional(),
});
const matchedBoost = `(SELECT boost.id FROM status_boosts boost WHERE boost.status_id=st.id AND boost.status='ACTIVE' AND boost.starts_at<=now() AND boost.ends_at>now()
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(boost.targets) target WHERE lower(target->>'state')=lower($4::text) AND
 ((target->>'kind'='LGA' AND $5::text<>'' AND lower(target->>'name')=lower($5::text)) OR (target->>'kind'='CITY' AND $8::text<>'' AND lower(target->>'name')=lower($8::text)))) LIMIT 1)`;
const statusSelect = `SELECT st.id,st.seller_id,st.listing_id,st.caption,st.media_url,st.thumbnail_url,st.status,st.created_at,st.expires_at,st.media_type,st.duration_seconds,
 l.title,l.category,l.price_kobo,l.unit,l.condition,s.business_name,s.city,s.area,s.state,s.lga,
 (${activePromotion} OR ${matchedBoost} IS NOT NULL) AS sponsored,
 ${matchedBoost} AS boost_id,
 CASE WHEN $2::float8 IS NOT NULL AND s.latitude IS NOT NULL THEN round((6371*acos(LEAST(1.0,GREATEST(-1.0,
 sin(radians(s.latitude))*sin(radians($2::float8))+cos(radians(s.latitude))*cos(radians($2::float8))*cos(radians(s.longitude-$3::float8))))))::numeric,0)::float8 ELSE NULL END AS distance_km
 FROM local_statuses st JOIN listings l ON l.id=st.listing_id JOIN sellers s ON s.user_id=st.seller_id JOIN users u ON u.id=s.user_id`;
const eligible = `st.status='ACTIVE' AND st.expires_at>now() AND s.status='APPROVED' AND u.status='ACTIVE' AND l.status='ACTIVE' AND ${bookableSql('l')}
 AND NOT EXISTS(SELECT 1 FROM catalogue_categories cp WHERE cp.name=l.category AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(cp.prohibited_terms) term WHERE strpos(lower(st.caption),lower(term))>0))
 AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=s.user_id) OR (blocked_id=$1 AND blocker_id=s.user_id))
 AND NOT EXISTS(SELECT 1 FROM local_status_mutes WHERE user_id=$1 AND ((kind='SELLER' AND target=s.user_id) OR (kind='CATEGORY' AND target=l.category)))
 AND ($6::text='' OR l.category=$6)
 AND (($4::text<>'' AND $5::text<>'' AND lower(s.state)=lower($4) AND lower(s.lga)=lower($5))
 OR ($2::float8 IS NOT NULL AND s.latitude IS NOT NULL AND 6371*acos(LEAST(1.0,GREATEST(-1.0,
 sin(radians(s.latitude))*sin(radians($2::float8))+cos(radians(s.latitude))*cos(radians($2::float8))*cos(radians(s.longitude-$3::float8))))) <= (SELECT status_radius_km FROM settings WHERE id=1)) OR ${matchedBoost} IS NOT NULL)`;
function areaParams(user: any, input: RequestInput) {
  const d = statusAreaInput.parse(input.query);
  ensure(
    (d.lat === undefined) === (d.lng === undefined),
    400,
    'LOCATION_REQUIRED',
    'Send both coordinates.',
  );
  // A manually selected LGA takes precedence over GPS from a previous search.
  const manual = !!(d.state && (d.lga || d.city));
  return {
    d,
    args: [
      user.id,
      manual ? null : (d.lat ?? null),
      manual ? null : (d.lng ?? null),
      d.state,
      d.lga,
      d.category,
    ],
  };
}
export async function expireLocalStatuses(db: Database) {
  await db.query(
    "UPDATE local_statuses SET status='EXPIRED' WHERE id IN (SELECT id FROM local_statuses WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED)",
  );
}
export function createLocalStatusService({ db, config }: AppDeps) {
  async function feed(user: any, input: RequestInput) {
    const { d, args } = areaParams(user, input);
    const score = `(CASE WHEN COALESCE((SELECT categories ? l.category FROM discovery_preferences WHERE user_id=$1),false) THEN 4 ELSE 0 END + CASE WHEN EXISTS(SELECT 1 FROM favourites WHERE buyer_id=$1 AND seller_id=s.user_id) THEN 2 ELSE 0 END)`;
    let cursor: null | { score: number; time: string; id: string } = null;
    if (d.cursor) {
      try {
        cursor = z
          .object({
            score: z.number().int().min(0).max(6),
            time: z.iso.datetime({ offset: true }),
            id: z.uuid(),
          })
          .parse(JSON.parse(Buffer.from(d.cursor, 'base64url').toString()));
      } catch {
        ensure(false, 400, 'INVALID_CURSOR', 'Reload Local Status to continue browsing.');
      }
    }
    const rankedSelect = statusSelect.replace(
      'SELECT st.id',
      `SELECT ${score} AS relevance_score,st.id`,
    );
    const rows = await db.query(
      `WITH ranked AS (${rankedSelect} WHERE ${eligible}) SELECT * FROM ranked WHERE ($7::text IS NULL OR (relevance_score,created_at,id)<($9::int,$10::timestamptz,$11::text)) ORDER BY relevance_score DESC,created_at DESC,id DESC LIMIT 13`,
      [
        ...args,
        d.cursor ?? null,
        d.city,
        cursor?.score ?? 0,
        cursor?.time ?? null,
        cursor?.id ?? null,
      ],
    );
    const items = rows.slice(0, 12),
      last = items.at(-1);
    return {
      items,
      next_cursor:
        rows.length > 12 && last
          ? Buffer.from(
              JSON.stringify({
                score: last.relevance_score,
                time: new Date(last.created_at).toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
  }
  async function publish(q: Query, user: any, input: RequestInput) {
    const d = publishStatusInput.parse(input.body);
    const [seller] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [user.id]);
    ensure(
      seller?.status === 'APPROVED',
      403,
      'SELLER_NOT_APPROVED',
      'Approved sellers can publish a Local Status.',
    );
    ensure(
      (seller.latitude != null && seller.longitude != null) || (seller.state && seller.lga),
      409,
      'STATUS_LOCATION_REQUIRED',
      'Set your pickup pin or state and LGA before publishing.',
    );
    const [listing] = await q.query(
      `SELECT l.* FROM listings l WHERE l.id=$1 AND l.seller_id=$2 AND l.status='ACTIVE' AND ${bookableSql('l')} FOR SHARE`,
      [d.listing_id, user.id],
    );
    ensure(
      listing,
      409,
      'LISTING_UNAVAILABLE',
      'Choose one of your active, available product listings.',
    );
    const [settings] = await q.query(
      'SELECT status_lifetime_hours,status_max_active FROM settings WHERE id=1',
    );
    await validateCategory(q, listing.category, listing.title, d.caption);
    const [count] = await q.query(
      "SELECT COUNT(*)::int AS n FROM local_statuses WHERE seller_id=$1 AND status='ACTIVE' AND expires_at>now()",
      [user.id],
    );
    ensure(
      count.n < settings.status_max_active,
      409,
      'STATUS_LIMIT',
      'You have reached the active status limit. Delete an update or wait for expiry.',
    );
    const url = d.media_url || listing.image_url;
    ensure(url, 400, 'PHOTO_REQUIRED', 'Upload a photo or choose a listing with a photo.');
    const [own] = await q.query(
      'SELECT url,thumbnail_url,media_type,duration_seconds FROM media WHERE owner_id=$1 AND url=$2',
      [user.id, url],
    );
    ensure(
      own ||
        listing.image_url === url ||
        (Array.isArray(listing.image_urls) && listing.image_urls.includes(url)),
      403,
      'INVALID_MEDIA',
      'Use your own uploaded image or a photo from this listing.',
    );
    const [row] = await q.query(
      "INSERT INTO local_statuses(id,seller_id,listing_id,caption,media_url,thumbnail_url,media_type,duration_seconds,expires_at) VALUES($1,$2,$3,$4,$5,$6,$8,$9,now()+($7::int*interval '1 hour')) RETURNING *",
      [
        randomUUID(),
        user.id,
        listing.id,
        d.caption,
        url,
        own?.thumbnail_url || url,
        settings.status_lifetime_hours,
        own?.media_type || 'IMAGE',
        own?.duration_seconds ?? null,
      ],
    );
    await audit(q, user.id, 'local_status.publish', row.id, { listing_id: listing.id });
    // Voluntary discovery: no broadcast email, in-app notification or push on publication.
    return { id: row.id, expires_at: row.expires_at };
  }
  async function mine(user: any) {
    const rows = await db.query(
      `SELECT st.*,l.title,(${activePromotion} OR EXISTS(SELECT 1 FROM status_boosts b WHERE b.status_id=st.id AND b.status='ACTIVE' AND b.ends_at>now())) AS sponsored,l.status='ACTIVE' AND ${bookableSql('l')} AS listing_available
   FROM local_statuses st JOIN listings l ON l.id=st.listing_id WHERE st.seller_id=$1 ORDER BY st.created_at DESC LIMIT 50`,
      [user.id],
    );
    for (const row of rows) {
      row.analytics = await db.query(
        `SELECT kinds.sponsored,(SELECT COUNT(*)::int FROM status_clicks sc WHERE sc.status_id=$1 AND sc.sponsored=kinds.sponsored AND sc.conversation_id IS NOT NULL) AS enquiries,COALESCE(v.views,0) AS views,COALESCE(v.unique_viewers,0) AS unique_viewers,COALESCE(v.product_clicks,0) AS product_clicks,
 COALESCE(c.bookings,0) AS bookings,COALESCE(c.accepted_bookings,0) AS accepted_bookings,COALESCE(c.paid_bookings,0) AS paid_bookings,COALESCE(c.completed_bookings,0) AS completed_bookings,COALESCE(c.cancelled_bookings,0) AS cancelled_bookings,COALESCE(c.completed_gross_kobo,0)::bigint AS completed_gross_kobo
 FROM (VALUES(FALSE),(TRUE)) kinds(sponsored)
 LEFT JOIN (SELECT sponsored,SUM(views)::int AS views,COUNT(DISTINCT viewer_key) FILTER(WHERE views>0)::int AS unique_viewers,SUM(clicks)::int AS product_clicks FROM local_status_events WHERE status_id=$1 GROUP BY sponsored) v USING(sponsored)
 LEFT JOIN (SELECT c.sponsored,COUNT(*)::int AS bookings,COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM events e WHERE e.booking_id=b.id AND e.to_status='ACCEPTED'))::int AS accepted_bookings,
 COUNT(*) FILTER(WHERE b.paid)::int AS paid_bookings,COUNT(*) FILTER(WHERE b.status='COMPLETED')::int AS completed_bookings,
 COUNT(*) FILTER(WHERE b.status IN ('CANCELLED','EXPIRED','DECLINED'))::int AS cancelled_bookings,COALESCE(SUM(b.total_kobo) FILTER(WHERE b.status='COMPLETED'),0)::bigint AS completed_gross_kobo
 FROM status_clicks c JOIN bookings b ON b.id=c.booking_id WHERE c.status_id=$1 GROUP BY c.sponsored) c USING(sponsored)`,
        [row.id],
      );
    }
    return rows;
  }
  async function remove(q: Query, user: any, input: RequestInput) {
    const [row] = await q.query(
      "UPDATE local_statuses SET status='DELETED' WHERE id=$1 AND seller_id=$2 AND status IN ('ACTIVE','EXPIRED') RETURNING id",
      [input.params.id, user.id],
    );
    ensure(row, 404, 'NOT_FOUND', 'Status not found or already removed.');
    await stopStatusBoosts(q, row.id, user.id, 'Status deleted by seller.');
    await audit(q, user.id, 'local_status.delete', row.id);
    return { ok: true };
  }
  async function event(q: Query, user: any, input: RequestInput) {
    const d = z.object({ kind: z.enum(['view', 'click']) }).parse(input.body),
      { args, d: scope } = areaParams(user, input);
    const [row] = await q.query(`${statusSelect} WHERE ${eligible} AND st.id=$7`, [
      ...args,
      input.params.id,
      scope.city,
    ]);
    ensure(row, 404, 'NOT_FOUND', 'This status is no longer available in your discovery area.');
    if (row.seller_id === user.id) return { ok: true, attribution_token: null };
    const key = createHmac('sha256', config.otpSecret)
      .update(`status-viewer:${row.id}:${user.id}`)
      .digest('hex');
    const view = d.kind === 'view';
    await q.query(
      `INSERT INTO local_status_events(status_id,viewer_key,sponsored,views,clicks,last_view_at,last_click_at,campaign_key) VALUES($1,$2,$3,$4,$5,CASE WHEN $4::int>0 THEN now() END,CASE WHEN $5::int>0 THEN now() END,$6)
   ON CONFLICT(status_id,viewer_key,sponsored,campaign_key) DO UPDATE SET
   views=local_status_events.views+CASE WHEN $4::int>0 AND (local_status_events.last_view_at IS NULL OR local_status_events.last_view_at<now()-interval '5 minutes') THEN 1 ELSE 0 END,
   clicks=local_status_events.clicks+CASE WHEN $5::int>0 AND (local_status_events.last_click_at IS NULL OR local_status_events.last_click_at<now()-interval '5 minutes') THEN 1 ELSE 0 END,
   last_view_at=CASE WHEN $4::int>0 AND (local_status_events.last_view_at IS NULL OR local_status_events.last_view_at<now()-interval '5 minutes') THEN now() ELSE local_status_events.last_view_at END,
   last_click_at=CASE WHEN $5::int>0 AND (local_status_events.last_click_at IS NULL OR local_status_events.last_click_at<now()-interval '5 minutes') THEN now() ELSE local_status_events.last_click_at END`,
      [
        row.id,
        key,
        row.sponsored,
        view ? 1 : 0,
        view ? 0 : 1,
        row.boost_id || (row.sponsored ? 'listing' : 'organic'),
      ],
    );
    let token: string | null = null;
    if (!view) {
      token = randomUUID();
      await q.query(
        "INSERT INTO status_clicks(id,buyer_id,status_id,listing_id,campaign_id,sponsored,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours')",
        [token, user.id, row.id, row.listing_id, row.boost_id, row.sponsored],
      );
    }
    return { ok: true, attribution_token: token };
  }
  async function preferences(user: any) {
    return db.query(
      "SELECT m.kind,m.target,CASE WHEN m.kind='SELLER' THEN (SELECT business_name FROM sellers WHERE user_id=m.target) ELSE m.target END AS label FROM local_status_mutes m WHERE m.user_id=$1 ORDER BY m.created_at DESC LIMIT 200",
      [user.id],
    );
  }
  async function mute(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        kind: z.enum(['SELLER', 'CATEGORY']),
        target: z.string().trim().min(1).max(100),
        muted: z.boolean(),
      })
      .parse(input.body);
    if (d.kind === 'CATEGORY') z.string().trim().min(2).max(50).parse(d.target);
    else z.uuid().parse(d.target);
    if (d.muted)
      await q.query(
        'INSERT INTO local_status_mutes(user_id,kind,target) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [user.id, d.kind, d.target],
      );
    else
      await q.query('DELETE FROM local_status_mutes WHERE user_id=$1 AND kind=$2 AND target=$3', [
        user.id,
        d.kind,
        d.target,
      ]);
    return { ok: true };
  }
  async function report(q: Query, user: any, input: RequestInput) {
    const { reason } = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(input.body),
      { args, d: scope } = areaParams(user, input);
    const [row] = await q.query(`${statusSelect} WHERE ${eligible} AND st.id=$7`, [
      ...args,
      input.params.id,
      scope.city,
    ]);
    ensure(row, 404, 'NOT_FOUND', 'Status not found.');
    await q.query(
      'INSERT INTO local_status_reports(id,status_id,reporter_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(status_id,reporter_id) DO UPDATE SET reason=EXCLUDED.reason',
      [randomUUID(), row.id, user.id, reason],
    );
    await audit(q, user.id, 'local_status.report', row.id);
    return { ok: true };
  }
  async function adminList() {
    return db.query(`SELECT st.*,l.title,s.business_name,
 (SELECT count(*)::int FROM local_status_reports WHERE status_id=st.id) AS report_count,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('reason',reason,'created_at',created_at)) FROM local_status_reports WHERE status_id=st.id),'[]') AS reports
 FROM local_statuses st JOIN listings l ON l.id=st.listing_id JOIN sellers s ON s.user_id=st.seller_id ORDER BY report_count DESC,st.created_at DESC LIMIT 200`);
  }
  async function moderate(q: Query, user: any, input: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(input.body);
    const [row] = await q.query(
      "UPDATE local_statuses SET status='REMOVED',moderation_reason=$1 WHERE id=$2 AND status<>'REMOVED' RETURNING id",
      [d.reason, input.params.id],
    );
    ensure(row, 404, 'NOT_FOUND', 'Status not found or already removed.');
    await stopStatusBoosts(q, row.id, user.id, 'Status removed by moderation.');
    await audit(q, user.id, 'local_status.remove', row.id, { reason: d.reason });
    return { ok: true };
  }
  return { feed, publish, mine, remove, event, preferences, mute, report, adminList, moderate };
}
