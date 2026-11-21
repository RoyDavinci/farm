import { z } from 'zod';
import type { Query } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { haversineKm } from './routing.service.js';

export function requireCurrentDriverDocuments(rider: any) {
  const today = new Date().toISOString().slice(0, 10);
  for (const field of ['permit_expires_at', 'insurance_expires_at']) {
    const expiry = rider.profile_details?.[field];
    ensure(
      !expiry || expiry >= today,
      409,
      'DRIVER_DOCUMENT_EXPIRED',
      'This rider needs renewed verification documents.',
    );
  }
}
export function requireServiceArea(
  rider: any,
  area: { state?: string; city?: string; lga?: string; area?: string },
) {
  const profile = rider.profile_details || {},
    normal = (v: string) => v.trim().toLowerCase();
  if (profile.state)
    ensure(
      area.state && normal(profile.state) === normal(area.state),
      409,
      'OUTSIDE_SERVICE_AREA',
      'This rider does not serve the pickup state.',
    );
  if (profile.service_areas?.length) {
    const locations = [area.city, area.lga, area.area].filter(Boolean).map((v) => normal(v!));
    ensure(
      profile.service_areas.some((s: string) => locations.includes(normal(s))),
      409,
      'OUTSIDE_SERVICE_AREA',
      'Choose a rider serving this pickup city, LGA or area.',
    );
  }
}
export async function checkRider(q: Query, id: string, buyer: string, vehicle?: string) {
  const [rider] = await q.query(
    `SELECT d.*,u.name FROM drivers d JOIN users u ON u.id=d.user_id
     WHERE d.user_id=$1 AND d.status='APPROVED' AND u.status='ACTIVE'
       AND d.online AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
       AND d.location_at>now()-interval '5 minutes'`,
    [id],
  );
  ensure(rider && id !== buyer, 409, 'RIDER_UNAVAILABLE', 'Choose an available, verified rider.');
  requireCurrentDriverDocuments(rider);
  ensure(
    !vehicle || rider.vehicle_type === vehicle,
    409,
    'WRONG_VEHICLE',
    'Choose a rider with the selected vehicle.',
  );
  const [blocked] = await q.query(
    'SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',
    [buyer, id],
  );
  ensure(!blocked, 403, 'PARTICIPANT_BLOCKED', 'This rider is not available to contact.');
  return rider;
}

/** Called while mutate holds the rider's user row; serialises claims across both job types. */
export async function riderFree(q: Query, id: string, shoppingId?: string) {
  const [busy] = await q.query(
    `SELECT 1 WHERE EXISTS(SELECT 1 FROM deliveries WHERE driver_id=$1 AND status IN ('ASSIGNED','PICKED_UP'))
       OR EXISTS(SELECT 1 FROM shopping_requests WHERE rider_id=$1 AND status IN ('ACCEPTED','SHOPPING','PURCHASED') AND id<>$2) OR EXISTS(SELECT 1 FROM return_journeys WHERE driver_id=$1 AND status IN ('ACCEPTED','PICKED_UP')) OR EXISTS(SELECT 1 FROM parcel_jobs WHERE driver_id=$1 AND status IN ('ACCEPTED','PICKED_UP'))`,
    [id, shoppingId || ''],
  );
  ensure(!busy, 409, 'RIDER_BUSY', 'This rider already has an active job.');
}

/** ~1.1 km grid: search points finer than this reveal nothing extra about rider positions. */
const snap = (deg: number) => Math.round(deg * 100) / 100;
/** Distances shown to buyers: rounded up to the next 0.5 km, never below 0.5 km. */
export const distanceBand = (km: number) => Math.max(0.5, Math.ceil(km * 2) / 2);

export const nearbyRiderInput = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  vehicle_type: z.string().max(30).optional(),
  booking_id: z.uuid().optional(),
});

export function createRidersService({ db }: AppDeps) {
  async function nearbyRiders(user: any, input: RequestInput) {
    const d = nearbyRiderInput.parse(input.query);
    const [settings] = await db.query('SELECT delivery_radius_km FROM settings WHERE id=1');
    let excludedSeller: string | null = null;
    // Riders' live positions must not be recoverable by probing from chosen points: a booking
    // search uses the booking's own pickup point, any other point is snapped to a ~1 km grid,
    // and distances are reported in 0.5 km bands.
    let point = { lat: snap(d.lat), lng: snap(d.lng) };
    if (d.booking_id) {
      const [booking] = await db.query(
        "SELECT seller_id,pickup_latitude,pickup_longitude FROM bookings WHERE id=$1 AND buyer_id=$2 AND status IN ('ACCEPTED','READY_FOR_PICKUP')",
        [d.booking_id, user.id],
      );
      ensure(booking, 404, 'NOT_FOUND', 'Accepted booking not found.');
      excludedSeller = booking.seller_id;
      if (booking.pickup_latitude != null && booking.pickup_longitude != null)
        point = { lat: booking.pickup_latitude, lng: booking.pickup_longitude };
    }
    const rows = await db.query(
      `WITH nearby AS (
       SELECT dr.user_id AS id,u.name,dr.vehicle_type,v.name AS vehicle_name,dr.city,
         COALESCE(dr.profile_details->>'permit_expires_at','')>=to_char(now(),'YYYY-MM-DD') AS permit_current,
         COALESCE(dr.profile_details->>'insurance_expires_at','')>=to_char(now(),'YYYY-MM-DD') AS insurance_current,
         6371*acos(LEAST(1.0,GREATEST(-1.0,sin(radians(dr.latitude))*sin(radians($1::float8))+
           cos(radians(dr.latitude))*cos(radians($1::float8))*cos(radians(dr.longitude-$2::float8))))) AS distance_km,
         (SELECT COUNT(*)::int FROM deliveries WHERE driver_id=dr.user_id AND status='DELIVERED')+
         (SELECT COUNT(*)::int FROM shopping_requests WHERE rider_id=dr.user_id AND status='DELIVERED') AS completed_jobs
       FROM drivers dr JOIN users u ON u.id=dr.user_id JOIN vehicle_types v ON v.code=dr.vehicle_type
       WHERE dr.status='APPROVED' AND u.status='ACTIVE' AND dr.online AND v.active
         AND dr.latitude IS NOT NULL AND dr.longitude IS NOT NULL AND dr.location_at>now()-interval '5 minutes'
         AND (COALESCE(dr.profile_details->>'permit_expires_at','')='' OR dr.profile_details->>'permit_expires_at'>=to_char(now(),'YYYY-MM-DD'))
         AND (COALESCE(dr.profile_details->>'insurance_expires_at','')='' OR dr.profile_details->>'insurance_expires_at'>=to_char(now(),'YYYY-MM-DD'))
         AND dr.user_id<>$3 AND dr.user_id<>COALESCE($6::text,'') AND ($4::text IS NULL OR dr.vehicle_type=$4)
         AND NOT EXISTS(SELECT 1 FROM deliveries WHERE driver_id=dr.user_id AND status IN ('ASSIGNED','PICKED_UP'))
         AND NOT EXISTS(SELECT 1 FROM shopping_requests WHERE rider_id=dr.user_id AND status IN ('ACCEPTED','SHOPPING','PURCHASED'))
         AND NOT EXISTS(SELECT 1 FROM return_journeys WHERE driver_id=dr.user_id AND status IN ('ACCEPTED','PICKED_UP'))
         AND NOT EXISTS(SELECT 1 FROM parcel_jobs WHERE driver_id=dr.user_id AND status IN ('ACCEPTED','PICKED_UP'))
         AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$3 AND blocked_id=dr.user_id) OR (blocker_id=dr.user_id AND blocked_id=$3))
       ) SELECT * FROM nearby WHERE distance_km<=$5 ORDER BY GREATEST(1,ceil(distance_km*2)),id LIMIT 30`,
      [
        point.lat,
        point.lng,
        user.id,
        d.vehicle_type || null,
        settings.delivery_radius_km,
        excludedSeller,
      ],
    );
    // No private contact data or exact live rider coordinates in the directory.
    const ids = rows.map((r) => r.id);
    const docs = ids.length
      ? await db.query(
          "SELECT seller_id,kind FROM seller_documents WHERE subject='driver' AND status='ACCEPTED' AND seller_id=ANY($1::text[])",
          [ids],
        )
      : [];
    const scores = ids.length
      ? await db.query(
          'SELECT driver_id,ROUND(AVG((punctuality+care+professionalism)/3.0),1)::float AS score FROM driver_ratings WHERE driver_id=ANY($1::text[]) GROUP BY driver_id',
          [ids],
        )
      : [];
    return rows.map((r) => {
      const { permit_current, insurance_current, ...safe } = r;
      const has = (kind: string) => docs.some((d) => d.seller_id === r.id && d.kind === kind);
      return {
        ...safe,
        distance_km: distanceBand(r.distance_km),
        verified: true,
        rating_avg: scores.find((s) => s.driver_id === r.id)?.score ?? null,
        badges: {
          identity: has('government_id'),
          driver: has('drivers_licence'),
          vehicle: has('vehicle_registration') && has('vehicle_photo'),
          permit: permit_current && has('operating_permit'),
          insurance: insurance_current && has('insurance'),
        },
      };
    });
  }
  return { nearbyRiders };
}

export function requireNearby(
  rider: any,
  point: { latitude: number; longitude: number },
  radius: number,
) {
  ensure(
    haversineKm(rider.latitude, rider.longitude, point.latitude, point.longitude) <= radius,
    409,
    'RIDER_TOO_FAR',
    'The rider has moved outside the service radius. Choose another rider.',
  );
}
