import { discoveryEvent } from './discovery-operations.service.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import type { SearchInput } from '../validators/geography.validators.js';
import { searchInput } from '../validators/geography.validators.js';
import { audit } from './audit.service.js';
import { attachVariants } from './catalog.service.js';
import { activePromotion } from './promotions.service.js';
import { bookableSql } from './retention.service.js';
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
  const args: (string | number | boolean)[] = [];
  const param = (value: string | number | boolean) => {
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
  if (d.delivery_available)
    conditions.push(`l.delivery_available=${param(d.delivery_available === 'true')}`);
  if (d.availability === 'preorder')
    conditions.push('l.available_from>now() AND l.preorder_capacity>0');
  if (d.availability === 'in_stock')
    conditions.push(
      'EXISTS(SELECT 1 FROM listing_variants sv WHERE sv.listing_id=l.id AND sv.active AND sv.stock>=sv.min_quantity) AND (l.available_from IS NULL OR l.available_from<=now())',
    );
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
  // Validated above: latitude and longitude are either both present or both absent.
  if (d.lat !== undefined && d.lng !== undefined) {
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

/** Business logic for geography requests. HTTP-free: callers pass plain input. */
export function createGeographyService(deps: AppDeps) {
  const { db, config: c } = deps;
  async function getMapConfig(user: any, input: RequestInput) {
    return {
      public_token: c.mapboxToken.startsWith('pk.') ? c.mapboxToken : null,
      permanent_geocoding: c.permanentGeocoding,
      public_pin_precision: 'approximate_2km_grid',
    };
  }
  async function geocode(user: any, input: RequestInput) {
    const { q } = z.object({ q: z.string().trim().min(3).max(200) }).parse(input.query);
    ensure(
      c.mapboxToken && c.permanentGeocoding,
      503,
      'GEOCODING_NOT_ENABLED',
      'Address search requires Mapbox permanent geocoding. You can use GPS or pick a pin instead.',
    );
    const params = new URLSearchParams({
      q,
      country: 'ng',
      limit: '5',
      permanent: 'true',
      access_token: c.mapboxToken,
    });
    const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    ensure(response.ok, 502, 'MAP_PROVIDER_ERROR', 'Address lookup is temporarily unavailable.');
    const data: any = await response.json();
    return data.features.map((f: any) => ({
      id: f.id,
      label: f.properties.full_address || f.properties.name,
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1],
    }));
  }
  async function listMarkets(user: any, input: RequestInput) {
    const { city } = z.object({ city: z.string().max(100).default('') }).parse(input.query);
    return await db.prisma.market.findMany({
      where: { status: 'ACTIVE', city: { contains: city, mode: 'insensitive' } },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      take: 200,
    });
  }
  async function updateSellerLocation(q: Query, u: any, input: RequestInput) {
    const d = coordinates
      .extend({
        state: z.string().trim().max(100).optional(),
        lga: z.string().trim().max(100).optional(),
        address: z.string().trim().min(8).max(500),
        city: z.string().trim().min(2).max(100),
        area: z.string().trim().min(2).max(100),
        market_id: z.uuid().nullable().optional(),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(input.body);
    const [seller] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [u.id]);
    ensure(seller, 404, 'NOT_FOUND', 'Seller profile not found.');
    await q.query(
      "UPDATE sellers SET address=$1,city=$2,area=$3,status='PENDING',reason=NULL WHERE user_id=$4",
      [d.address, d.city, d.area, u.id],
    );
    await q.query(
      'UPDATE sellers SET state=COALESCE($1,state),lga=COALESCE($2,lga) WHERE user_id=$3',
      [d.state ?? null, d.lga ?? null, u.id],
    );
    await setLocation(q, u.id, d);
    await q.query(
      'INSERT INTO location_history(id,seller_id,actor_id,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [
        randomUUID(),
        u.id,
        u.id,
        JSON.stringify({
          address: seller.address,
          state: seller.state,
          lga: seller.lga,
          city: seller.city,
          area: seller.area,
          latitude: seller.latitude,
          longitude: seller.longitude,
        }),
        JSON.stringify(d),
        d.reason,
      ],
    );
    await audit(q, u.id, 'seller.location_update', u.id, { reason: d.reason });
    return { ok: true, status: 'PENDING' };
  }
  async function search(user: any, input: RequestInput) {
    const d = searchInput.parse(input.query);
    await discoveryEvent(db, user.id, 'SEARCH', undefined, d.category);
    return await searchListings(db, d);
  }
  async function createMarket(q: Query, u: any, input: RequestInput) {
    const d = coordinates
      .partial()
      .extend({
        name: z.string().trim().min(2).max(120),
        city: z.string().trim().min(2).max(100),
        area: z.string().trim().min(2).max(100),
      })
      .parse(input.body);
    ensure(
      (d.latitude == null) === (d.longitude == null),
      400,
      'INVALID_COORDINATES',
      'Provide both coordinates.',
    );
    const [market] = await q.query(
      'INSERT INTO markets(id,name,city,area,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [randomUUID(), d.name, d.city, d.area, d.latitude ?? null, d.longitude ?? null],
    );
    await audit(q, u.id, 'market.create', market.id);
    return market;
  }
  return { getMapConfig, geocode, listMarkets, updateSellerLocation, search, createMarket };
}
