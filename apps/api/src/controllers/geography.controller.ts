import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { audit } from '../services/audit.service.js';
import { searchInput } from '../validators/geography.validators.js';
import { coordinates, setLocation, searchListings } from '../services/geography.service.js';
import type { AppDeps } from '../types/deps.js';

export function createGeographyController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;

  const getMapConfig: RequestHandler = (_req, res) =>
    res.json({
      public_token: c.mapboxToken.startsWith('pk.') ? c.mapboxToken : null,
      permanent_geocoding: c.permanentGeocoding,
      public_pin_precision: 'approximate_2km_grid',
    });
  const geocode: RequestHandler = async (req, res) => {
    const { q } = z.object({ q: z.string().trim().min(3).max(200) }).parse(req.query);
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
    res.json(
      data.features.map((f: any) => ({
        id: f.id,
        label: f.properties.full_address || f.properties.name,
        longitude: f.geometry.coordinates[0],
        latitude: f.geometry.coordinates[1],
      })),
    );
  };
  const listMarkets: RequestHandler = async (req, res) => {
    const { city } = z.object({ city: z.string().max(100).default('') }).parse(req.query);
    res.json(
      await db.prisma.market.findMany({
        where: { status: 'ACTIVE', city: { contains: city, mode: 'insensitive' } },
        orderBy: [{ city: 'asc' }, { name: 'asc' }],
        take: 200,
      }),
    );
  };
  const createMarket: RequestHandler = async (req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return mutate(req, res, async (q, u) => {
      const d = coordinates
        .partial()
        .extend({
          name: z.string().trim().min(2).max(120),
          city: z.string().trim().min(2).max(100),
          area: z.string().trim().min(2).max(100),
        })
        .parse(req.body);
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
    });
  };
  const updateSellerLocation: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = coordinates
        .extend({
          address: z.string().trim().min(8).max(500),
          city: z.string().trim().min(2).max(100),
          area: z.string().trim().min(2).max(100),
          market_id: z.uuid().nullable().optional(),
          reason: z.string().trim().min(5).max(500),
        })
        .parse(req.body);
      const [seller] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [u.id]);
      ensure(seller, 404, 'NOT_FOUND', 'Seller profile not found.');
      await q.query(
        "UPDATE sellers SET address=$1,city=$2,area=$3,status='PENDING',reason=NULL WHERE user_id=$4",
        [d.address, d.city, d.area, u.id],
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
            latitude: seller.latitude,
            longitude: seller.longitude,
          }),
          JSON.stringify(d),
          d.reason,
        ],
      );
      await audit(q, u.id, 'seller.location_update', u.id, { reason: d.reason });
      return { ok: true, status: 'PENDING' };
    });
  const search: RequestHandler = async (req, res) =>
    res.json(await searchListings(db, searchInput.parse(req.query)));
  return { getMapConfig, geocode, listMarkets, createMarket, updateSellerLocation, search };
}
