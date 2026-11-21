import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
export const tariffInput = z.object({
  state: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  vehicle_type: z.string().max(30),
  active: z.boolean(),
  base_kobo: z.number().int().min(0).max(10000000),
  per_km_kobo: z.number().int().min(0).max(1000000),
  per_kg_kobo: z.number().int().min(0).max(1000000),
  max_weight_kg: z.number().positive().max(10000),
  waiting_per_minute_kobo: z.number().int().min(0).max(100000),
  demand_bps: z.number().int().min(10000).max(30000),
  surcharge_kobo: z.number().int().min(0).max(10000000),
  reason: z.string().trim().min(5).max(1000),
});
export const loadInput = z.object({
  weight_kg: z.number().positive().max(10000).default(1),
  waiting_minutes: z.number().int().min(0).max(120).default(0),
});
export async function regionalFare(
  q: Query,
  area: { state?: string; city?: string },
  vehicle: string,
  km: number,
  load: z.infer<typeof loadInput>,
  fallback: number,
) {
  const [t] = await q.query(
    'SELECT * FROM delivery_tariffs WHERE lower(state)=lower($1) AND lower(city)=lower($2) AND vehicle_type=$3',
    [area.state || '', area.city || '', vehicle],
  );
  if (!t)
    return {
      fare_kobo: fallback,
      pricing: { source: 'standard', weight_kg: load.weight_kg, waiting_minutes: 0 },
    };
  ensure(t.active, 409, 'VEHICLE_UNAVAILABLE', 'This vehicle is unavailable in the pickup area.');
  ensure(
    load.weight_kg <= t.max_weight_kg,
    400,
    'PACKAGE_TOO_HEAVY',
    `This vehicle permits at most ${t.max_weight_kg} kg.`,
  );
  const base =
    t.base_kobo +
    Math.ceil(km * t.per_km_kobo) +
    Math.ceil(load.weight_kg * t.per_kg_kobo) +
    load.waiting_minutes * t.waiting_per_minute_kobo;
  const fare = Math.ceil((base * t.demand_bps) / 10000) + t.surcharge_kobo;
  ensure(fare > 0 && fare <= 100000000, 400, 'FARE_LIMIT', 'Fare is outside the supported limit.');
  return {
    fare_kobo: fare,
    pricing: {
      source: 'regional',
      state: t.state,
      city: t.city,
      weight_kg: load.weight_kg,
      waiting_minutes: load.waiting_minutes,
      base_kobo: t.base_kobo,
      distance_kobo: Math.ceil(km * t.per_km_kobo),
      load_kobo: Math.ceil(load.weight_kg * t.per_kg_kobo),
      waiting_kobo: load.waiting_minutes * t.waiting_per_minute_kobo,
      demand_bps: t.demand_bps,
      surcharge_kobo: t.surcharge_kobo,
      reason: t.reason,
    },
  };
}
export async function deliveryParty(q: Query, id: string, u: any, lock = false) {
  const [d] = await q.query(`SELECT * FROM deliveries WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [
    id,
  ]);
  ensure(
    d && (d.buyer_id === u.id || d.seller_id === u.id || d.driver_id === u.id),
    404,
    'NOT_FOUND',
    'Delivery not found.',
  );
  return d;
}
export function createDeliveryOperationsService({ db, config }: AppDeps) {
  async function backgroundConsent(q: Query, u: any, i: RequestInput) {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(i.body);
    const [d] = await q.query(
      "UPDATE drivers SET background_tracking=$1 WHERE user_id=$2 AND status='APPROVED' AND (NOT $1 OR online) RETURNING user_id",
      [enabled, u.id],
    );
    ensure(d, 409, 'DRIVER_UNAVAILABLE', 'An approved online rider is required.');
    await audit(q, u.id, 'location.background_consent', u.id, { enabled });
    return { ok: true };
  }
  async function backgroundLocation(q: Query, u: any, i: RequestInput) {
    const p = z
      .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
      .parse(i.body);
    const [d] = await q.query(
      "UPDATE drivers SET latitude=$1,longitude=$2,location_at=now() WHERE user_id=$3 AND status='APPROVED' AND online AND background_tracking RETURNING user_id",
      [p.latitude, p.longitude, u.id],
    );
    ensure(d, 409, 'TRACKING_DISABLED', 'Background sharing is not enabled for this online rider.');
    await q.query(
      "UPDATE shopping_requests SET rider_latitude=$1,rider_longitude=$2,rider_location_at=now() WHERE rider_id=$3 AND status IN ('SHOPPING','PURCHASED') AND NOT review_open",
      [p.latitude, p.longitude, u.id],
    );
    await q.query(
      "UPDATE deliveries SET driver_latitude=$1,driver_longitude=$2,driver_location_at=now() WHERE driver_id=$3 AND status IN ('ASSIGNED','PICKED_UP')",
      [p.latitude, p.longitude, u.id],
    );
    await q.query(
      "UPDATE parcel_jobs SET driver_latitude=$1,driver_longitude=$2,location_at=now() WHERE driver_id=$3 AND status IN ('ACCEPTED','PICKED_UP') AND NOT review_open",
      [p.latitude, p.longitude, u.id],
    );
    return { ok: true };
  }
  async function timeline(u: any, i: RequestInput) {
    const d = await deliveryParty(db, i.params.id, u);
    const [policy] = await db.query('SELECT draft FROM marketplace_policies WHERE id=1');
    const minutes = Number(policy.draft.inspection_minutes || 15);
    return {
      inspection_minutes: minutes,
      inspection_deadline: d.inspection_started_at
        ? new Date(new Date(d.inspection_started_at).getTime() + minutes * 60000)
        : null,
      inspection_policy_state: 'DRAFT',
      stage: d.progress_stage || d.status,
      scheduled_at: d.scheduled_at,
      inspection_started_at: d.inspection_started_at,
      inspection_accepted_at: d.inspection_accepted_at,
      milestones: await db.query(
        'SELECT stage,created_at FROM delivery_milestones WHERE delivery_id=$1 ORDER BY created_at,id',
        [d.id],
      ),
      rating:
        (
          await db.query(
            'SELECT punctuality,care,professionalism,comment FROM driver_ratings WHERE delivery_id=$1',
            [d.id],
          )
        )[0] || null,
    };
  }
  async function milestone(q: Query, u: any, i: RequestInput) {
    const d = await deliveryParty(q, i.params.id, u, true);
    ensure(d.driver_id === u.id, 403, 'FORBIDDEN', 'Assigned rider only.');
    const { stage } = z
      .object({
        stage: z.enum(['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROPOFF', 'ARRIVED_DROPOFF']),
      })
      .parse(i.body);
    const allowed: Record<string, string[]> = {
      EN_ROUTE_PICKUP: ['ASSIGNED'],
      ARRIVED_PICKUP: ['EN_ROUTE_PICKUP'],
      EN_ROUTE_DROPOFF: ['GOODS_COLLECTED', 'PICKED_UP'],
      ARRIVED_DROPOFF: ['EN_ROUTE_DROPOFF'],
    };
    const current = d.progress_stage || d.status;
    ensure(
      (stage.includes('PICKUP') ? d.status === 'ASSIGNED' : d.status === 'PICKED_UP') &&
        allowed[stage].includes(current),
      409,
      'INVALID_TRANSITION',
      'Complete the preceding delivery step first.',
    );
    await q.query(
      'INSERT INTO delivery_milestones(id,delivery_id,actor_id,stage) VALUES($1,$2,$3,$4)',
      [randomUUID(), d.id, u.id, stage],
    );
    await q.query('UPDATE deliveries SET progress_stage=$1 WHERE id=$2', [stage, d.id]);
    await audit(q, u.id, 'delivery.milestone', d.id, { stage });
    await notify(
      q,
      d.buyer_id,
      'delivery',
      'Delivery progress',
      stage.toLowerCase().replaceAll('_', ' '),
      d.booking_id,
    );
    return { ok: true };
  }
  async function schedule(q: Query, u: any, i: RequestInput) {
    const d = await deliveryParty(q, i.params.id, u, true);
    ensure(
      d.buyer_id === u.id && d.status === 'OPEN',
      409,
      'INVALID_TRANSITION',
      'Only an unassigned delivery can be scheduled.',
    );
    const { scheduled_at } = z
      .object({ scheduled_at: z.iso.datetime({ offset: true }).nullable() })
      .parse(i.body);
    const [b] = await q.query('SELECT reserved_until FROM bookings WHERE id=$1', [d.booking_id]);
    ensure(
      !scheduled_at ||
        (new Date(scheduled_at).getTime() > Date.now() &&
          new Date(scheduled_at) < new Date(b.reserved_until)),
      400,
      'INVALID_SCHEDULE',
      'Schedule within the current stock reservation.',
    );
    await q.query('UPDATE deliveries SET scheduled_at=$1 WHERE id=$2', [scheduled_at, d.id]);
    await audit(q, u.id, 'delivery.schedule', d.id, { scheduled_at });
    return { ok: true };
  }
  async function retry(q: Query, u: any, i: RequestInput) {
    const d = await deliveryParty(q, i.params.id, u, true);
    ensure(
      d.buyer_id === u.id && d.status === 'OPEN',
      409,
      'INVALID_TRANSITION',
      'Only an unassigned delivery can be retried.',
    );
    await q.query('UPDATE deliveries SET requested_driver_id=NULL,scheduled_at=NULL WHERE id=$1', [
      d.id,
    ]);
    await audit(q, u.id, 'delivery.retry', d.id);
    return { ok: true };
  }
  async function inspection(q: Query, u: any, i: RequestInput) {
    ensure(
      config.demo,
      409,
      'POLICY_REVIEW_REQUIRED',
      'Inspection policy is available for development review. Live rules need approval.',
    );
    const d = await deliveryParty(q, i.params.id, u, true);
    ensure(
      d.buyer_id === u.id &&
        d.status === 'PICKED_UP' &&
        d.progress_stage === 'ARRIVED_DROPOFF' &&
        d.pay_on_delivery,
      409,
      'INVALID_TRANSITION',
      'Inspection is available when a digital POD order arrives.',
    );
    const { action } = z.object({ action: z.enum(['start', 'accept']) }).parse(i.body);
    if (action === 'start')
      await q.query(
        'UPDATE deliveries SET inspection_started_at=COALESCE(inspection_started_at,now()) WHERE id=$1',
        [d.id],
      );
    else {
      ensure(d.inspection_started_at, 409, 'INSPECTION_REQUIRED', 'Start inspecting first.');
      await q.query(
        'UPDATE deliveries SET inspection_accepted_at=COALESCE(inspection_accepted_at,now()) WHERE id=$1',
        [d.id],
      );
    }
    await audit(q, u.id, `inspection.${action}`, d.id);
    return { ok: true };
  }
  async function rateDriver(q: Query, u: any, i: RequestInput) {
    const d = await deliveryParty(q, i.params.id, u, true);
    ensure(
      d.buyer_id === u.id && d.status === 'DELIVERED',
      403,
      'REVIEW_NOT_ALLOWED',
      'Only the buyer may review a completed delivery.',
    );
    const v = z
      .object({
        punctuality: z.number().int().min(1).max(5),
        care: z.number().int().min(1).max(5),
        professionalism: z.number().int().min(1).max(5),
        comment: z.string().trim().max(1000).default(''),
      })
      .parse(i.body);
    await q.query(
      'INSERT INTO driver_ratings(id,delivery_id,buyer_id,driver_id,punctuality,care,professionalism,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(), d.id, u.id, d.driver_id, v.punctuality, v.care, v.professionalism, v.comment],
    );
    await audit(q, u.id, 'driver.rating', d.id);
    return { ok: true };
  }
  async function incident(q: Query, u: any, i: RequestInput) {
    const d = await deliveryParty(q, i.params.id, u);
    const v = z
      .object({
        kind: z.enum(['UNSAFE_CONDUCT', 'DAMAGE', 'LOST_GOODS', 'ABUSE', 'OTHER']),
        description: z.string().trim().min(10).max(4000),
      })
      .parse(i.body);
    const id = randomUUID();
    await q.query(
      'INSERT INTO delivery_incidents(id,delivery_id,reporter_id,kind,description) VALUES($1,$2,$3,$4,$5)',
      [id, d.id, u.id, v.kind, v.description],
    );
    await audit(q, u.id, 'delivery.incident', id);
    return { id };
  }
  async function tariffs() {
    return db.query('SELECT * FROM delivery_tariffs ORDER BY state,city,vehicle_type');
  }
  async function saveTariff(q: Query, u: any, i: RequestInput) {
    const v = tariffInput.parse(i.body);
    await q.query(
      'INSERT INTO delivery_tariffs(id,state,city,vehicle_type,active,base_kobo,per_km_kobo,per_kg_kobo,max_weight_kg,waiting_per_minute_kobo,demand_bps,surcharge_kobo,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(lower(state),lower(city),vehicle_type) DO UPDATE SET active=$5,base_kobo=$6,per_km_kobo=$7,per_kg_kobo=$8,max_weight_kg=$9,waiting_per_minute_kobo=$10,demand_bps=$11,surcharge_kobo=$12,reason=$13',
      [
        randomUUID(),
        v.state,
        v.city,
        v.vehicle_type,
        v.active,
        v.base_kobo,
        v.per_km_kobo,
        v.per_kg_kobo,
        v.max_weight_kg,
        v.waiting_per_minute_kobo,
        v.demand_bps,
        v.surcharge_kobo,
        v.reason,
      ],
    );
    await audit(q, u.id, 'tariff.save', `${v.state}/${v.city}/${v.vehicle_type}`, v);
    return { ok: true };
  }
  async function incidents() {
    return db.query(
      'SELECT i.*,b.title FROM delivery_incidents i JOIN deliveries d ON d.id=i.delivery_id JOIN bookings b ON b.id=d.booking_id ORDER BY i.created_at DESC LIMIT 200',
    );
  }
  async function resolveIncident(q: Query, u: any, i: RequestInput) {
    const { resolution } = z
      .object({ resolution: z.string().trim().min(10).max(4000) })
      .parse(i.body);
    const [d] = await q.query(
      "UPDATE delivery_incidents SET status='RESOLVED',resolution=$1 WHERE id=$2 AND status='OPEN' RETURNING id",
      [resolution, i.params.id],
    );
    ensure(d, 404, 'NOT_FOUND', 'Open incident not found.');
    await audit(q, u.id, 'incident.resolve', d.id, { resolution });
    return { ok: true };
  }
  return {
    backgroundConsent,
    backgroundLocation,
    timeline,
    milestone,
    schedule,
    retry,
    inspection,
    rateDriver,
    incident,
    tariffs,
    saveTariff,
    incidents,
    resolveIncident,
  };
}
