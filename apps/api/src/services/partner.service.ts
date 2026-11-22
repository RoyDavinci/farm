import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { integrationStatus } from '../integrations/index.js';
import { audit } from './audit.service.js';
import { sellerFeatures } from './growth.service.js';

export const partnerEvents = ['order.created', 'order.status_changed'] as const;
export const apiKeyInput = z.object({
  name: z.string().trim().min(2).max(60),
  scopes: z
    .array(z.enum(['listings:read', 'listings:write', 'orders:read']))
    .min(1)
    .default(['listings:read', 'orders:read']),
});
export const webhookInput = z.object({
  url: z
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'Webhooks must use https.'),
  events: z
    .array(z.enum(partnerEvents))
    .min(1)
    .default([...partnerEvents]),
});
export const partnerListingInput = z.object({
  stock: z.number().int().min(0).max(1_000_000).optional(),
  price_kobo: z.number().int().min(1).max(100_000_000).optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
});
const hash = (key: string) => createHash('sha256').update(key).digest('hex');

/** Queues a webhook event for a seller's active webhooks (sent by the worker, signed). */
export async function queuePartnerEvent(
  q: Query,
  sellerId: string,
  event: (typeof partnerEvents)[number],
  payload: object,
) {
  const hooks = await q.query(
    'SELECT id FROM partner_webhooks WHERE seller_id=$1 AND active AND $2=ANY(events)',
    [sellerId, event],
  );
  for (const h of hooks)
    await q.query(
      'INSERT INTO partner_webhook_deliveries(id,webhook_id,event,payload) VALUES($1,$2,$3,$4)',
      [
        randomUUID(),
        h.id,
        event,
        JSON.stringify({ event, created_at: new Date().toISOString(), data: payload }),
      ],
    );
}

/** Worker job: sends due webhook deliveries with an HMAC signature; retries with back-off, 6 tries. */
export async function deliverPartnerWebhooks(db: Database, fetcher: typeof fetch = fetch) {
  const due = await db.query(
    `SELECT d.id,d.payload,d.attempts,w.url,w.secret FROM partner_webhook_deliveries d JOIN partner_webhooks w ON w.id=d.webhook_id
     WHERE d.status='PENDING' AND d.next_attempt_at<=now() AND w.active ORDER BY d.created_at LIMIT 20`,
  );
  for (const d of due) {
    const body = JSON.stringify(d.payload);
    let error: string | null = null;
    try {
      const r = await fetcher(d.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ahia-signature': createHmac('sha256', d.secret).update(body).digest('hex'),
          'x-ahia-delivery': d.id,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) error = `HTTP ${r.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    if (!error)
      await db.query(
        "UPDATE partner_webhook_deliveries SET status='SENT',sent_at=now(),attempts=attempts+1 WHERE id=$1",
        [d.id],
      );
    else
      await db.query(
        `UPDATE partner_webhook_deliveries SET attempts=attempts+1,last_error=$2,
           status=CASE WHEN attempts+1>=6 THEN 'FAILED' ELSE 'PENDING' END,
           next_attempt_at=now()+(power(2,attempts+1)||' minutes')::interval WHERE id=$1`,
        [d.id, error],
      );
  }
  return due.length;
}

/**
 * Partner integrations: Business-plan sellers create API keys and webhooks so their inventory,
 * ordering or accounting systems can read listings and orders and update stock and prices.
 */
export function createPartnerService(deps: AppDeps) {
  const { db } = deps;
  async function requireApiAccess(q: Query, userId: string) {
    const f = await sellerFeatures(q, userId);
    ensure(f.api_access, 402, 'UPGRADE_REQUIRED', 'API access is part of the Business plan.');
  }

  // ---------- seller: keys and webhooks ----------
  async function listKeys(user: any, _input?: RequestInput) {
    const keys = await db.query(
      'SELECT id,name,key_prefix,scopes,created_at,last_used_at,revoked_at FROM partner_api_keys WHERE seller_id=$1 ORDER BY created_at DESC',
      [user.id],
    );
    const hooks = await db.query(
      `SELECT w.id,w.url,w.events,w.active,w.created_at,
         (SELECT COUNT(*)::int FROM partner_webhook_deliveries d WHERE d.webhook_id=w.id AND d.status='FAILED') AS failed
       FROM partner_webhooks w WHERE w.seller_id=$1 ORDER BY w.created_at DESC`,
      [user.id],
    );
    return {
      keys,
      webhooks: hooks,
      docs: 'Send X-Api-Key with each request to /v1/partner/…; verify webhooks with the X-Ahia-Signature HMAC-SHA256 of the body.',
    };
  }
  async function createKey(q: Query, user: any, input: RequestInput) {
    const d = apiKeyInput.parse(input.body);
    await requireApiAccess(q, user.id);
    const [count] = await q.query(
      'SELECT COUNT(*)::int AS n FROM partner_api_keys WHERE seller_id=$1 AND revoked_at IS NULL',
      [user.id],
    );
    ensure(count.n < 10, 400, 'KEY_LIMIT', 'You can have up to 10 active keys.');
    const key = `ahia_${randomBytes(24).toString('base64url')}`;
    const id = randomUUID();
    await q.query(
      'INSERT INTO partner_api_keys(id,seller_id,name,key_prefix,key_hash,scopes,created_by) VALUES($1,$2,$3,$4,$5,$6,$2)',
      [id, user.id, d.name, key.slice(0, 10), hash(key), d.scopes],
    );
    await audit(q, user.id, 'partner_key.create', id, { name: d.name, scopes: d.scopes });
    return { id, key, message: 'Copy this key now: it won’t be shown again.' };
  }
  async function revokeKey(q: Query, user: any, input: RequestInput) {
    const [k] = await q.query(
      'UPDATE partner_api_keys SET revoked_at=now() WHERE id=$1 AND seller_id=$2 AND revoked_at IS NULL RETURNING id',
      [input.params.id, user.id],
    );
    ensure(k, 404, 'NOT_FOUND', 'Active key not found.');
    await audit(q, user.id, 'partner_key.revoke', k.id);
    return { ok: true };
  }
  async function createWebhook(q: Query, user: any, input: RequestInput) {
    const d = webhookInput.parse(input.body);
    await requireApiAccess(q, user.id);
    const id = randomUUID();
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await q.query(
      'INSERT INTO partner_webhooks(id,seller_id,url,secret,events) VALUES($1,$2,$3,$4,$5)',
      [id, user.id, d.url, secret, d.events],
    );
    await audit(q, user.id, 'partner_webhook.create', id, { url: d.url });
    return {
      id,
      secret,
      message: 'Use this secret to verify the X-Ahia-Signature header. It won’t be shown again.',
    };
  }
  async function deleteWebhook(q: Query, user: any, input: RequestInput) {
    const [w] = await q.query(
      'DELETE FROM partner_webhooks WHERE id=$1 AND seller_id=$2 RETURNING id',
      [input.params.id, user.id],
    );
    ensure(w, 404, 'NOT_FOUND', 'Webhook not found.');
    return { ok: true };
  }
  async function integrations(_user: any, _input?: RequestInput) {
    const [keys] = await db.query(
      'SELECT COUNT(*)::int AS n FROM partner_api_keys WHERE revoked_at IS NULL',
    );
    const [hooks] = await db.query(
      "SELECT COUNT(*)::int AS active,(SELECT COUNT(*)::int FROM partner_webhook_deliveries WHERE status='FAILED') AS failed FROM partner_webhooks WHERE active",
    );
    return {
      providers: integrationStatus(),
      partner_api: { active_keys: keys.n, webhooks: hooks.active, failed_deliveries: hooks.failed },
    };
  }

  // ---------- partner API (API key, no user session) ----------
  /** Express middleware: checks X-Api-Key and loads the key's seller and scopes. */
  async function authenticateKey(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = String(req.headers['x-api-key'] || '');
      if (!raw.startsWith('ahia_'))
        throw new AppError(401, 'API_KEY_REQUIRED', 'Send a valid X-Api-Key header.');
      const [k] = await db.query(
        `UPDATE partner_api_keys SET last_used_at=now() WHERE key_hash=$1 AND revoked_at IS NULL RETURNING id,seller_id,scopes`,
        [hash(raw)],
      );
      if (!k) throw new AppError(401, 'API_KEY_INVALID', 'This API key is invalid or revoked.');
      const f = await sellerFeatures(db, k.seller_id);
      if (!f.api_access)
        throw new AppError(402, 'UPGRADE_REQUIRED', 'API access needs an active Business plan.');
      res.locals.partner = k;
      next();
    } catch (e) {
      next(e);
    }
  }
  const scope = (res: Response, s: string) =>
    ensure(
      res.locals.partner.scopes.includes(s),
      403,
      'SCOPE_REQUIRED',
      `This key needs the ${s} scope.`,
    );

  async function partnerListings(partner: any) {
    return (
      await db.query(
        `SELECT l.id,l.title,l.category,l.status,l.image_url,l.created_at,
           (SELECT json_agg(json_build_object('id',v.id,'name',v.name,'unit',v.unit,'price_kobo',v.price_kobo,'stock',v.stock,'primary',v.is_primary) ORDER BY v.is_primary DESC)
              FROM listing_variants v WHERE v.listing_id=l.id AND v.active) AS variants
         FROM listings l WHERE l.seller_id=$1 AND l.archived_at IS NULL ORDER BY l.created_at DESC LIMIT 500`,
        [partner.seller_id],
      )
    ).map((l: any) => ({
      ...l,
      variants: (l.variants || []).map((v: any) => ({ ...v, price_kobo: Number(v.price_kobo) })),
    }));
  }
  async function partnerUpdateListing(q: Query, partner: any, id: string, body: unknown) {
    const d = partnerListingInput.parse(body);
    const [l] = await q.query('SELECT id FROM listings WHERE id=$1 AND seller_id=$2 FOR UPDATE', [
      id,
      partner.seller_id,
    ]);
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    if (d.stock !== undefined || d.price_kobo !== undefined)
      await q.query(
        'UPDATE listing_variants SET stock=COALESCE($1,stock),price_kobo=COALESCE($2,price_kobo) WHERE listing_id=$3 AND is_primary',
        [d.stock ?? null, d.price_kobo ?? null, l.id],
      );
    await q.query(
      `UPDATE listings SET stock=v.stock,price_kobo=v.price_kobo,status=COALESCE($2,listings.status),confirmed_at=now()
       FROM listing_variants v WHERE v.listing_id=listings.id AND v.is_primary AND listings.id=$1`,
      [l.id, d.status ?? null],
    );
    await audit(q, partner.seller_id, 'partner_api.listing_update', l.id, {
      ...d,
      key: partner.id,
    });
    return { ok: true };
  }
  async function partnerOrders(partner: any) {
    return (
      await db.query(
        `SELECT id,listing_id,title,variant_name,unit,quantity,price_kobo,total_kobo,commission_kobo,status,paid,created_at
         FROM bookings WHERE seller_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [partner.seller_id],
      )
    ).map((b: any) => ({ ...b, total_kobo: Number(b.total_kobo) }));
  }

  return {
    listKeys,
    createKey,
    revokeKey,
    createWebhook,
    deleteWebhook,
    integrations,
    authenticateKey,
    scope,
    partnerListings,
    partnerUpdateListing,
    partnerOrders,
  };
}
