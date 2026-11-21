import type { Config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import type { RedisClient } from '../lib/redis.js';

export interface Point {
  latitude: number;
  longitude: number;
}
export interface Distance {
  km: number;
  /** 'road' = Mapbox driving route; 'estimate' = straight line × ROAD_FACTOR. */
  method: 'road' | 'estimate';
}

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

const CACHE_SECONDS = 30 * 60;
const round = (n: number) => n.toFixed(4); // ~11 m: same pins give the same route

/**
 * Driving distance between two points. Uses Mapbox Directions when a token is configured, caches
 * the answer (in Redis when available, so a quote and the delivery request made on different
 * instances agree), and falls back to the straight-line estimate if Mapbox is unset, slow or down.
 */
export function createRouting(
  c: Config,
  redis?: RedisClient | null,
  send: typeof fetch = (...args) => fetch(...args),
) {
  const memory = new Map<string, { value: Distance; expires: number }>();
  const estimate = (a: Point, b: Point): Distance => ({
    km:
      Math.round(haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * ROAD_FACTOR * 10) /
      10,
    method: 'estimate',
  });
  async function cached(key: string): Promise<Distance | null> {
    const hit = memory.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const shared = redis ? await redis.get(key).catch(() => null) : null;
    return shared ? (JSON.parse(shared) as Distance) : null;
  }
  async function remember(key: string, value: Distance) {
    memory.set(key, { value, expires: Date.now() + CACHE_SECONDS * 1000 });
    if (memory.size > 5000) memory.delete(memory.keys().next().value!);
    if (redis) await redis.set(key, JSON.stringify(value), 'EX', CACHE_SECONDS).catch(() => {});
  }
  async function drivingDistance(from: Point, to: Point): Promise<Distance> {
    if (!c.mapboxToken) return estimate(from, to);
    const key = `ahia:route:${round(from.latitude)},${round(from.longitude)}:${round(to.latitude)},${round(to.longitude)}`;
    const hit = await cached(key);
    if (hit) return hit;
    try {
      const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=false&access_token=${encodeURIComponent(c.mapboxToken)}`;
      const res = await send(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`);
      const meters = ((await res.json()) as any)?.routes?.[0]?.distance;
      if (typeof meters !== 'number') throw new Error('No route');
      const value: Distance = { km: Math.round(meters / 100) / 10, method: 'road' };
      await remember(key, value);
      return value;
    } catch (err) {
      logger.warn('road distance unavailable; using estimate', { error: (err as Error).message });
      return estimate(from, to);
    }
  }
  return { drivingDistance, estimate };
}
