import { z } from 'zod';
import type { Query } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
export const regionInput = z.object({
  code: z.string().regex(/^[A-Z]{2}$/),
  country: z.string().trim().min(2).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  enabled: z.boolean(),
  cities: z.array(z.string().trim().min(2).max(100)).max(200),
  notes: z.string().trim().max(2000),
});
export function createRegionsService({ db }: AppDeps) {
  async function listRegions() {
    return db.query('SELECT * FROM market_regions ORDER BY country');
  }
  async function activeRegions() {
    return db.query(
      'SELECT code,country,currency,locale,cities FROM market_regions WHERE enabled ORDER BY country',
    );
  }
  async function saveRegion(q: Query, u: any, i: RequestInput) {
    const d = regionInput.parse(i.body);
    ensure(
      !d.enabled ||
        (d.code === 'NG' &&
          d.currency === 'NGN' &&
          d.country === 'Nigeria' &&
          d.locale === 'en-NG'),
      409,
      'REGION_APPROVAL_REQUIRED',
      'Additional countries/currencies can be drafted; activating them needs provider, localisation and operating approval.',
    );
    ensure(
      d.code !== 'NG' || d.enabled,
      409,
      'PRIMARY_REGION_REQUIRED',
      'Keep the current Nigeria marketplace available.',
    );
    await q.query(
      'INSERT INTO market_regions(code,country,currency,locale,enabled,cities,notes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(code) DO UPDATE SET country=$2,currency=$3,locale=$4,enabled=$5,cities=$6,notes=$7,updated_at=now()',
      [d.code, d.country, d.currency, d.locale, d.enabled, JSON.stringify(d.cities), d.notes],
    );
    await audit(q, u.id, 'region.save', d.code, d);
    return { ok: true };
  }
  return { listRegions, activeRegions, saveRegion };
}
