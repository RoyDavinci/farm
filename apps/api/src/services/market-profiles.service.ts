import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
export const sellerDetailsInput = z.object({
  legal_name: z.string().trim().max(150).default(''),
  description: z.string().trim().max(2000).default(''),
  categories: z.array(z.string().trim().min(2).max(50)).max(20).default([]),
  country: z.string().trim().min(2).max(80).default('Nigeria'),
  street: z.string().trim().max(150).default(''),
  market_section: z.string().trim().max(100).default(''),
  block: z.string().trim().max(60).default(''),
  stall_number: z.string().trim().max(60).default(''),
  landmark: z.string().trim().max(200).default(''),
});
export const driverDetailsInput = z.object({
  state: z.string().trim().max(100).default(''),
  service_areas: z.array(z.string().trim().min(2).max(100)).max(20).default([]),
  permit_number: z.string().trim().max(100).default(''),
  permit_expires_at: z.iso.date().nullable().default(null),
  insurance_reference: z.string().trim().max(100).default(''),
  insurance_expires_at: z.iso.date().nullable().default(null),
});
export const waypointInput = z.object({
  id: z.uuid().optional(),
  market_id: z.uuid(),
  label: z.string().trim().min(2).max(150),
  kind: z.enum(['ENTRANCE', 'LANDMARK', 'SECTION', 'STALL']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  verified: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const pathInput = z.object({
  market_id: z.uuid(),
  from_id: z.uuid(),
  to_id: z.uuid(),
  metres: z.number().positive().max(100000),
  instructions: z.string().trim().max(1000).default(''),
  accessible: z.boolean().default(true),
  active: z.boolean().default(true),
});
export async function verificationBadges(q: Query, id: string) {
  const docs = await q.query(
    "SELECT subject,kind FROM seller_documents WHERE seller_id=$1 AND status='ACCEPTED'",
    [id],
  );
  const has = (subject: string, kind: string) =>
    docs.some((d) => d.subject === subject && d.kind === kind);
  const [s] = await q.query('SELECT status FROM sellers WHERE user_id=$1', [id]);
  const [d] = await q.query('SELECT status,profile_details FROM drivers WHERE user_id=$1', [id]);
  const valid = (date: string | undefined) =>
    !!date && date >= new Date().toISOString().slice(0, 10);
  return {
    identity: has('seller', 'government_id') || has('driver', 'government_id'),
    business: !!s && s.status === 'APPROVED' && has('seller', 'business_registration'),
    location: !!s && s.status === 'APPROVED' && has('seller', 'proof_of_address'),
    driver: !!d && d.status === 'APPROVED' && has('driver', 'drivers_licence'),
    vehicle:
      !!d &&
      d.status === 'APPROVED' &&
      has('driver', 'vehicle_registration') &&
      has('driver', 'vehicle_photo'),
    permit: !!d && valid(d.profile_details.permit_expires_at) && has('driver', 'operating_permit'),
    insurance: !!d && valid(d.profile_details.insurance_expires_at) && has('driver', 'insurance'),
  };
}
export function createMarketProfilesService({ db }: AppDeps) {
  async function sellerDetails(u: any) {
    const [p] = await db.query('SELECT profile_details FROM sellers WHERE user_id=$1', [u.id]);
    ensure(p, 404, 'NOT_FOUND', 'Seller profile not found.');
    return { details: p.profile_details, badges: await verificationBadges(db, u.id) };
  }
  async function saveSellerDetails(q: Query, u: any, i: RequestInput) {
    const d = sellerDetailsInput.parse(i.body);
    const [region] = await q.query(
      'SELECT code FROM market_regions WHERE enabled AND lower(country)=lower($1)',
      [d.country],
    );
    ensure(region, 409, 'REGION_UNAVAILABLE', 'Choose an active marketplace country.');
    const [s] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [u.id]);
    ensure(s, 404, 'NOT_FOUND', 'Seller profile not found.');
    for (const c of d.categories) {
      const [a] = await q.query('SELECT active FROM catalogue_categories WHERE name=$1', [c]);
      ensure(a?.active, 400, 'CATEGORY_UNAVAILABLE', 'Choose active categories.');
    }
    const addressFields = [
      'country',
      'street',
      'market_section',
      'block',
      'stall_number',
      'landmark',
    ] as const;
    const changed = addressFields.some(
      (k) => d[k] !== String(s.profile_details[k] || (k === 'country' ? 'Nigeria' : '')),
    );
    const address = [
      d.street,
      d.market_section,
      d.block && `Block ${d.block}`,
      d.stall_number && `Stall ${d.stall_number}`,
      d.landmark,
    ]
      .filter(Boolean)
      .join(', ');
    await q.query(
      "UPDATE sellers SET profile_details=$1,address=CASE WHEN $2<>'' THEN $2 ELSE address END,status=CASE WHEN $3 THEN 'PENDING' ELSE status END WHERE user_id=$4",
      [JSON.stringify(d), address, changed, u.id],
    );
    await audit(q, u.id, 'seller.details', u.id, { address_changed: changed });
    return { ok: true, requires_review: changed };
  }
  async function driverDetails(u: any) {
    const [p] = await db.query('SELECT profile_details FROM drivers WHERE user_id=$1', [u.id]);
    ensure(p, 404, 'NOT_FOUND', 'Driver profile not found.');
    return { details: p.profile_details, badges: await verificationBadges(db, u.id) };
  }
  async function saveDriverDetails(q: Query, u: any, i: RequestInput) {
    const d = driverDetailsInput.parse(i.body);
    const [p] = await q.query(
      "UPDATE drivers SET profile_details=$1,status='PENDING',online=false WHERE user_id=$2 RETURNING user_id",
      [JSON.stringify(d), u.id],
    );
    ensure(p, 404, 'NOT_FOUND', 'Driver profile not found.');
    await audit(q, u.id, 'driver.details', u.id, { requires_review: true });
    return { ok: true };
  }
  async function publicProfile(u: any, i: RequestInput) {
    const [s] = await db.query(
      "SELECT business_name,business_type,city,area,state,lga,profile_details->>'description' AS description,profile_details->'categories' AS categories FROM sellers WHERE user_id=$1 AND status='APPROVED'",
      [i.params.id],
    );
    ensure(s, 404, 'NOT_FOUND', 'Seller not found.');
    return { ...s, badges: await verificationBadges(db, i.params.id) };
  }
  async function marketMap(u: any, i: RequestInput) {
    const [m] = await db.query(
      "SELECT id,name,city,area FROM markets WHERE id=$1 AND status='ACTIVE'",
      [i.params.id],
    );
    ensure(m, 404, 'NOT_FOUND', 'Market not found.');
    return {
      market: m,
      waypoints: await db.query(
        "SELECT * FROM market_waypoints WHERE market_id=$1 AND active AND kind<>'STALL' AND verified ORDER BY kind,label",
        [m.id],
      ),
      paths: await db.query(
        "SELECT p.* FROM market_paths p JOIN market_waypoints a ON a.id=p.from_id JOIN market_waypoints b ON b.id=p.to_id WHERE p.market_id=$1 AND p.active AND a.active AND b.active AND a.verified AND b.verified AND a.kind<>'STALL' AND b.kind<>'STALL'",
        [m.id],
      ),
    };
  }
  async function mapping() {
    return {
      markets: await db.query('SELECT * FROM markets ORDER BY city,name LIMIT 200'),
      waypoints: await db.query(
        'SELECT * FROM market_waypoints ORDER BY market_id,label LIMIT 2000',
      ),
      paths: await db.query('SELECT * FROM market_paths ORDER BY market_id,id LIMIT 4000'),
    };
  }
  async function saveWaypoint(q: Query, u: any, i: RequestInput) {
    const d = waypointInput.parse(i.body),
      id = d.id || randomUUID();
    const [m] = await q.query("SELECT id FROM markets WHERE id=$1 AND status='ACTIVE'", [
      d.market_id,
    ]);
    ensure(m, 400, 'INVALID_MARKET', 'Choose an active market.');
    await q.query(
      'INSERT INTO market_waypoints(id,market_id,label,kind,latitude,longitude,verified,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET label=$3,kind=$4,latitude=$5,longitude=$6,verified=$7,active=$8,updated_at=now() WHERE market_waypoints.market_id=$2',
      [id, d.market_id, d.label, d.kind, d.latitude, d.longitude, d.verified, d.active],
    );
    await audit(q, u.id, 'market.waypoint', id, d);
    return { id };
  }
  async function savePath(q: Query, u: any, i: RequestInput) {
    const d = pathInput.parse(i.body);
    ensure(d.from_id !== d.to_id, 400, 'INVALID_PATH', 'Choose different endpoints.');
    const nodes = await q.query(
      'SELECT id FROM market_waypoints WHERE market_id=$1 AND id=ANY($2::text[])',
      [d.market_id, [d.from_id, d.to_id]],
    );
    ensure(nodes.length === 2, 400, 'INVALID_PATH', 'Both endpoints must belong to this market.');
    await q.query(
      'INSERT INTO market_paths(id,market_id,from_id,to_id,metres,instructions,accessible,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(from_id,to_id) DO UPDATE SET metres=$5,instructions=$6,accessible=$7,active=$8',
      [
        randomUUID(),
        d.market_id,
        d.from_id,
        d.to_id,
        d.metres,
        d.instructions,
        d.accessible,
        d.active,
      ],
    );
    await audit(q, u.id, 'market.path', d.market_id, d);
    return { ok: true };
  }
  async function bookingMap(u: any, i: RequestInput) {
    const [b] = await db.query(
      "SELECT pickup_market_id,pickup_latitude,pickup_longitude,pickup_address_snapshot FROM bookings WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2) AND status IN ('ACCEPTED','READY_FOR_PICKUP') AND reserved_until>now()",
      [i.params.id, u.id],
    );
    ensure(
      b?.pickup_market_id,
      404,
      'NO_MARKET',
      'No market was recorded for this accepted booking. Use the collection directions.',
    );
    const map = await marketMap(u, { ...i, params: { id: b.pickup_market_id } });
    const stalls = await db.query(
      "SELECT * FROM market_waypoints WHERE market_id=$1 AND active AND verified AND kind='STALL' AND abs(latitude-$2)<0.001 AND abs(longitude-$3)<0.001 ORDER BY power(latitude-$2,2)+power(longitude-$3,2) LIMIT 1",
      [b.pickup_market_id, b.pickup_latitude, b.pickup_longitude],
    );
    return {
      ...map,
      waypoints: [...map.waypoints, ...stalls],
      pickup_address: b.pickup_address_snapshot,
    };
  }
  async function bookingRoute(u: any, i: RequestInput) {
    const [b] = await db.query(
      "SELECT b.* FROM bookings b WHERE b.id=$1 AND (b.buyer_id=$2 OR b.seller_id=$2) AND b.status IN ('ACCEPTED','READY_FOR_PICKUP') AND b.reserved_until>now()",
      [i.params.id, u.id],
    );
    ensure(b, 404, 'NOT_FOUND', 'Accepted active booking required.');
    const d = z
      .object({
        from_id: z.uuid(),
        to_id: z.uuid(),
        accessible: z.enum(['true', 'false']).default('false'),
      })
      .parse(i.query);
    const nodes = (await bookingMap(u, i)).waypoints;
    ensure(
      nodes.some((n) => n.id === d.from_id) && nodes.some((n) => n.id === d.to_id),
      400,
      'INVALID_ROUTE',
      'Choose verified market points.',
    );
    const edges = await db.query(
      'SELECT * FROM market_paths WHERE market_id=$1 AND active AND ($2=false OR accessible)',
      [b.pickup_market_id, d.accessible === 'true'],
    );
    const distances = new Map<string, number>([[d.from_id, 0]]),
      previous = new Map<string, { node: string; edge: any }>(),
      pending = new Set<string>(nodes.map((n) => n.id));
    while (pending.size) {
      const a = [...pending]
        .filter((n) => distances.has(n))
        .sort((x, y) => distances.get(x)! - distances.get(y)!)[0];
      if (!a || a === d.to_id) break;
      pending.delete(a);
      for (const edge of edges.filter((e) => e.from_id === a || e.to_id === a)) {
        const target = edge.from_id === a ? edge.to_id : edge.from_id;
        if (!pending.has(target)) continue;
        const distance = distances.get(a)! + edge.metres;
        if (distance < (distances.get(target) ?? Infinity)) {
          distances.set(target, distance);
          previous.set(target, { node: a, edge });
        }
      }
    }
    ensure(
      distances.has(d.to_id),
      404,
      'NO_MAPPED_ROUTE',
      'No verified walkway connects these points. Use seller directions.',
    );
    const steps: any[] = [];
    let node = d.to_id;
    while (node !== d.from_id) {
      const p = previous.get(node)!;
      steps.unshift({
        from: nodes.find((n) => n.id === p.node),
        to: nodes.find((n) => n.id === node),
        metres: p.edge.metres,
        instructions: p.edge.instructions,
      });
      node = p.node;
    }
    return {
      metres: distances.get(d.to_id),
      steps,
      pickup_address: b.pickup_address_snapshot,
      notice:
        'Mapped walkways are guidance; confirm landmarks with the seller. GPS indoors may be inaccurate.',
    };
  }
  return {
    sellerDetails,
    saveSellerDetails,
    driverDetails,
    saveDriverDetails,
    publicProfile,
    marketMap,
    mapping,
    saveWaypoint,
    savePath,
    bookingMap,
    bookingRoute,
  };
}
