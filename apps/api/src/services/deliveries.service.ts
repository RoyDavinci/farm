import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { ledger } from './ledger.service.js';

/** Straight-line distance in km. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Roads are longer than the straight line; 1.3 is a common urban detour factor. */
export const ROAD_FACTOR = 1.3;

export function fareFor(
  v: { base_fare_kobo: number; per_km_kobo: number; min_fare_kobo: number },
  km: number,
) {
  const raw = v.base_fare_kobo + Math.ceil(km * v.per_km_kobo);
  // Round up to the nearest ₦50 so cash-like amounts are easy to read.
  return Math.max(v.min_fare_kobo, Math.ceil(raw / 5000) * 5000);
}

export const point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const pin = () => String(randomInt(100000, 1000000));

/** Cancels an unfinished delivery and refunds a prepaid fare. Used by booking release/expiry. */
export async function cancelDelivery(q: Query, d: any, reason: string, actor: string | null) {
  if (!['OPEN', 'ASSIGNED'].includes(d.status)) return;
  if (d.fare_paid)
    await ledger(q, d.id, [
      { account: 'delivery_escrow', owner: d.id, amount: -Number(d.fare_kobo) },
      { account: 'wallet', owner: d.buyer_id, amount: Number(d.fare_kobo) },
    ]);
  await q.query(
    "UPDATE deliveries SET status='CANCELLED',cancel_reason=$1,fare_paid=FALSE WHERE id=$2",
    [reason, d.id],
  );
  await audit(q, actor, 'delivery.cancel', d.id, { reason });
  if (d.driver_id && d.driver_id !== actor)
    await notify(q, d.driver_id, 'delivery', 'Delivery cancelled', reason, d.booking_id);
}
