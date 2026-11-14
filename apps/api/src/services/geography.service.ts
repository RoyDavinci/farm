import { attachVariants } from './catalog.service.js';
import { activePromotion } from './promotions.service.js';
import { bookableSql } from './retention.service.js';
import type { SearchInput } from '../validators/geography.validators.js';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
export const coordinates = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export function publicPin(lat: number, lng: number) {
  return {
    latitude: Number((Math.floor(lat / 0.02) * 0.02 + 0.01).toFixed(5)),
    longitude: Number((Math.floor(lng / 0.02) * 0.02 + 0.01).toFixed(5)),
  };
}
export async function setLocation(
  q: Query,
  uid: string,
  data: { latitude?: number | null; longitude?: number | null; market_id?: string | null },
) {
  if (data.market_id) {
    const [market] = await q.query("SELECT id FROM markets WHERE id=$1 AND status='ACTIVE'", [
      data.market_id,
    ]);
    ensure(market, 400, 'INVALID_MARKET', 'Choose an active market.');
  }
  ensure(
    (data.latitude == null) === (data.longitude == null),
    400,
    'INVALID_COORDINATES',
    'Provide both latitude and longitude.',
  );
  const pin =
    data.latitude != null && data.longitude != null
      ? publicPin(data.latitude, data.longitude)
      : null;
  await q.query(
    'UPDATE sellers SET latitude=$1,longitude=$2,public_latitude=$3,public_longitude=$4,market_id=$5 WHERE user_id=$6',
    [
      data.latitude ?? null,
      data.longitude ?? null,
      pin?.latitude ?? null,
      pin?.longitude ?? null,
      data.market_id || null,
      uid,
    ],
  );
}

export async function searchListings(db: Database, d: SearchInput) {
  ensure(
    (d.lat === undefined) === (d.lng === undefined),
    400,
    'INVALID_COORDINATES',
    'Provide both latitude and longitude.',
  );
  ensure(
    d.sort !== 'distance' || d.lat !== undefined,
    400,
    'LOCATION_REQUIRED',
    'Choose a location to sort by distance.',
  );
  let offset = 0;
  if (d.cursor) {
    const decoded = Buffer.from(d.cursor, 'base64url').toString();
    ensure(/^\d{1,6}$/.test(decoded), 400, 'INVALID_CURSOR', 'Invalid page cursor.');
    offset = Number(decoded);
    ensure(offset <= 100000, 400, 'INVALID_CURSOR', 'Page limit exceeded.');
  }
  const args: (string | number)[] = [];
  const param = (value: string | number) => {
    args.push(value);
    return `$${args.length}`;
  };
  const conditions = [
    "s.status='APPROVED'",
    "u.status='ACTIVE'",
    "l.status='ACTIVE'",
    bookableSql('l'),
  ];
  if (d.q) {
    const p = param(`%${d.q}%`);
    conditions.push(
      `(l.title ILIKE ${p} OR l.description ILIKE ${p} OR s.business_name ILIKE ${p})`,
    );
  }
  if (d.city) conditions.push(`s.city ILIKE ${param(`%${d.city}%`)}`);
  if (d.area) conditions.push(`s.area ILIKE ${param(`%${d.area}%`)}`);
  if (d.market_id) conditions.push(`s.market_id=${param(d.market_id)}`);
  if (d.category) conditions.push(`l.category=${param(d.category)}`);
  if (d.seller_type) conditions.push(`s.business_type=${param(d.seller_type)}`);
  if (d.min_price !== undefined || d.max_price !== undefined) {
    ensure(
      d.min_price === undefined || d.max_price === undefined || d.min_price <= d.max_price,
      400,
      'INVALID_PRICE_RANGE',
      'Minimum price cannot exceed maximum price.',
    );
    const variantConditions = [
      'pv.listing_id=l.id',
      'pv.active',
      '(pv.stock>=pv.min_quantity OR (l.available_from>now() AND l.preorder_capacity>=pv.min_quantity))',
    ];
    if (d.min_price !== undefined) variantConditions.push(`pv.price_kobo>=${param(d.min_price)}`);
    if (d.max_price !== undefined) variantConditions.push(`pv.price_kobo<=${param(d.max_price)}`);
    conditions.push(
      `EXISTS(SELECT 1 FROM listing_variants pv WHERE ${variantConditions.join(' AND ')})`,
    );
  }
  if (d.wholesale === 'true')
    conditions.push(
      'EXISTS(SELECT 1 FROM listing_variants wv WHERE wv.listing_id=l.id AND wv.active AND jsonb_array_length(wv.wholesale_tiers)>0)',
    );
  const rating = 'COALESCE((SELECT AVG(r.score) FROM ratings r WHERE r.seller_id=s.user_id),0)';
  if (d.min_rating) conditions.push(`${rating}>=${param(d.min_rating)}`);
  let distance = 'NULL::double precision';
  if (d.lat !== undefined) {
    const lat = param(d.lat),
      lng = param(d.lng);
    distance = `6371*acos(LEAST(1.0,GREATEST(-1.0,sin(radians(${lat}::double precision))*sin(radians(s.public_latitude))+cos(radians(${lat}::double precision))*cos(radians(s.public_latitude))*cos(radians(s.public_longitude-${lng}::double precision)))))`;
    conditions.push('s.public_latitude IS NOT NULL');
    conditions.push(`(${distance})<=${param(d.radius_km)}`);
  }
  const order = {
    recent: 'l.created_at DESC,l.id DESC',
    distance: 'distance_km ASC,l.id DESC',
    price_asc: 'search_price ASC,l.id DESC',
    price_desc: 'search_price DESC,l.id DESC',
    rating: 'rating_avg DESC,l.id DESC',
  }[d.sort];
  const columns = `SELECT l.*,s.business_name,s.city,s.area,s.business_type,s.market_id,s.public_latitude,s.public_longitude,${rating} AS rating_avg,${distance} AS distance_km,COALESCE((SELECT MIN(v.price_kobo) FROM listing_variants v WHERE v.listing_id=l.id AND v.active AND v.stock>=v.min_quantity),(SELECT MIN(v.price_kobo) FROM listing_variants v WHERE v.listing_id=l.id AND v.active)) AS search_price,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url`;
  const from = `FROM listings l JOIN sellers s ON s.user_id=l.seller_id JOIN users u ON u.id=s.user_id WHERE ${conditions.join(' AND ')}`;
  // Sponsored placements match the same filters, appear only on the first page and are labelled.
  const sponsored = d.cursor
    ? []
    : await db.query(
        `${columns},TRUE AS sponsored ${from} AND ${activePromotion} ORDER BY random() LIMIT 2`,
        [...args],
      );
  const rows = await db.query(
    `${columns} ${from} ORDER BY ${order} LIMIT ${param(d.limit + 1)} OFFSET ${param(offset)}`,
    args,
  );
  const hasMore = rows.length > d.limit;
  return {
    items: await attachVariants(db, rows.slice(0, d.limit)),
    sponsored: await attachVariants(db, sponsored),
    next_cursor: hasMore ? Buffer.from(String(offset + d.limit)).toString('base64url') : null,
    distance_precision: 'approximate' as const,
  };
}
