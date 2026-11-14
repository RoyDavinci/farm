import type { Query } from '../database/client.js';
import { notify } from './communications.service.js';

/** SQL: listing alias is bookable now from stock, or open for pre-orders before its harvest date. */
export const bookableSql = (a = 'l') =>
  `(EXISTS(SELECT 1 FROM listing_variants av WHERE av.listing_id=${a}.id AND av.active AND av.stock>=av.min_quantity) OR (${a}.available_from>now() AND ${a}.preorder_capacity>0 AND EXISTS(SELECT 1 FROM listing_variants pv WHERE pv.listing_id=${a}.id AND pv.active)))`;

export const visibleListing = `SELECT l.*,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,
  s.business_name,s.city,s.area,s.business_type,
  ${bookableSql('l')} AS in_stock
  FROM listings l JOIN sellers s ON s.user_id=l.seller_id
  WHERE s.status='APPROVED' AND l.status='ACTIVE' AND EXISTS(SELECT 1 FROM users su WHERE su.id=s.user_id AND su.status='ACTIVE')`;

/** A listing is bookable when it is active and at least one active option has its minimum in stock. */
export async function listingAvailable(q: Query, listingId: string) {
  const [row] = await q.query(
    `SELECT (l.status='ACTIVE' AND ${bookableSql('l')}) AS ok FROM listings l WHERE l.id=$1`,
    [listingId],
  );
  return !!row?.ok;
}

/** Tells waiting buyers a listing is bookable again. Each alert fires once, then is removed. */
export async function notifyIfRestocked(q: Query, listingId: string, wasAvailable: boolean) {
  if (wasAvailable || !(await listingAvailable(q, listingId))) return;
  const [l] = await q.query(
    'SELECT l.title,s.business_name FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1',
    [listingId],
  );
  const waiting = await q.query<{ buyer_id: string }>(
    'DELETE FROM stock_alerts WHERE listing_id=$1 RETURNING buyer_id',
    [listingId],
  );
  for (const w of waiting)
    await notify(
      q,
      w.buyer_id,
      'stock',
      'Back in stock',
      `${l.title} from ${l.business_name} is available to book again.`,
    );
}

/** Lets buyers who favourited a seller know about a newly published listing. */
export async function announceNewListing(q: Query, listing: Record<string, any>) {
  if (!(await listingAvailable(q, listing.id))) return;
  const [l] = await q.query(
    'SELECT l.title,s.business_name FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1',
    [listing.id],
  );
  const fans = await q.query<{ buyer_id: string }>(
    'SELECT buyer_id FROM favourites WHERE seller_id=$1',
    [listing.seller_id],
  );
  for (const f of fans)
    await notify(
      q,
      f.buyer_id,
      'stock',
      `New from ${l.business_name}`,
      `${l.title} is now available from a seller you follow.`,
    );
}
