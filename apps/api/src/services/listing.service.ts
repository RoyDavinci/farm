import { validateCategory } from './catalogue-policy.service.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { listingSchema, sellerSchema } from '../validators/marketplace.validators.js';
import { sharePhoto } from './catalogue-products.service.js';
import { audit } from './audit.service.js';
import { alertRequestsForListing } from './deals.service.js';
import { attachVariants, saveVariants } from './catalog.service.js';
import { setLocation } from './geography.service.js';
import {
  announceNewListing,
  bookableSql,
  listingAvailable,
  notifyIfRestocked,
} from './retention.service.js';

/** Opening a pre-order window needs the pre-orders feature; closing one is always allowed. */
function requirePreorders(
  deps: AppDeps,
  d: { available_from?: string | null; preorder_capacity?: number },
) {
  ensure(
    deps.config.features.preorders || (!d.available_from && !d.preorder_capacity),
    404,
    'FEATURE_DISABLED',
    'Pre-orders are not available yet.',
  );
}

/** Saves the pre-order window (harvest date and capacity) when the request includes it. */
export async function savePreorder(
  q: Query,
  listingId: string,
  d: z.infer<typeof listingSchema> | Partial<z.infer<typeof listingSchema>>,
) {
  if (d.available_from === undefined && d.preorder_capacity === undefined) return;
  if (d.available_from)
    ensure(
      new Date(d.available_from).getTime() > Date.now(),
      400,
      'INVALID_HARVEST_DATE',
      'The pre-order date must be in the future.',
    );
  await q.query(
    'UPDATE listings SET available_from=CASE WHEN $1 THEN $2::timestamptz ELSE available_from END,preorder_capacity=COALESCE($3,preorder_capacity) WHERE id=$4',
    [
      d.available_from !== undefined,
      d.available_from ?? null,
      d.preorder_capacity ?? null,
      listingId,
    ],
  );
}

/** Listing photos must be the seller's own uploads (or external HTTPS images). */
export async function validateImages(q: Query, uid: string, images: string[]) {
  for (const url of images) {
    if (url.startsWith('https://') && !url.includes('/media/')) continue;
    const [own] = await q.query('SELECT id FROM media WHERE owner_id=$1 AND url=$2', [uid, url]);
    ensure(
      own,
      400,
      'INVALID_MEDIA',
      'Choose photos uploaded by your seller account or an HTTPS image URL.',
    );
  }
}

/** Business logic for marketplace requests. HTTP-free: callers pass plain input. */
export function createMarketplaceService(deps: AppDeps) {
  const { db } = deps;
  const id = () => randomUUID();
  async function applyAsSeller(q: Query, u: any, input: RequestInput) {
    const d = sellerSchema.parse(input.body);
    const [old] = await q.query('SELECT * FROM sellers WHERE user_id=$1', [u.id]);
    ensure(
      !old || old.status === 'REJECTED',
      409,
      'SELLER_EXISTS',
      'A seller profile already exists.',
    );
    const [s] = await q.query(
      "INSERT INTO sellers(user_id,business_name,business_type,city,area,address) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET business_name=$2,business_type=$3,city=$4,area=$5,address=$6,status='PENDING',reason=NULL RETURNING *",
      [u.id, d.business_name, d.business_type, d.city, d.area, d.address],
    );
    await q.query('UPDATE sellers SET state=$1,lga=$2 WHERE user_id=$3', [d.state, d.lga, u.id]);
    await setLocation(q, u.id, d);
    await audit(q, u.id, 'seller.register', u.id);
    return s;
  }
  async function listListings(user: any, input: RequestInput) {
    const query = z
      .object({
        q: z.string().max(100).default(''),
        city: z.string().max(100).default(''),
        category: z.string().max(100).default(''),
        mine: z.enum(['true', 'false']).default('false'),
      })
      .parse(input.query);
    const mine = query.mine === 'true';
    const args: any[] = mine ? [user.id] : [`%${query.q}%`, `%${query.city}%`, query.category];
    const rows = await db.query(
      `SELECT l.*,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,s.business_name,s.city,s.area,s.business_type FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE ${mine ? 'l.seller_id=$1' : `s.status='APPROVED' AND EXISTS(SELECT 1 FROM users su WHERE su.id=s.user_id AND su.status='ACTIVE') AND l.status='ACTIVE' AND ${bookableSql('l')} AND (l.title ILIKE $1 OR l.category ILIKE $1 OR s.business_name ILIKE $1) AND s.city ILIKE $2 AND ($3='' OR l.category=$3)`} ORDER BY l.created_at DESC LIMIT 100`,
      args,
    );
    return await attachVariants(db, rows, mine);
  }
  /** `quiet`: don't announce to followers (adding many catalogue products at once). */
  async function createListing(
    q: Query,
    u: any,
    input: RequestInput,
    opts: { quiet?: boolean } = {},
  ) {
    const d = listingSchema.parse(input.body);
    ensure(
      (d.pickup_available ?? true) || (d.delivery_available ?? true),
      400,
      'FULFILMENT_REQUIRED',
      'Offer collection or delivery.',
    );
    await validateCategory(q, d.category, d.title, d.description);
    const images = d.image_urls || (d.image_url ? [d.image_url] : []);
    await validateImages(q, u.id, images);
    const [s] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [u.id]);
    ensure(
      s?.status === 'APPROVED',
      403,
      'SELLER_NOT_APPROVED',
      'Your seller account must be approved before publishing.',
    );
    const [l] = await q.query(
      'INSERT INTO listings(id,seller_id,title,description,category,unit,price_kobo,stock,status,image_url,condition) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [
        id(),
        u.id,
        d.title,
        d.description,
        d.category,
        d.unit,
        d.price_kobo,
        d.stock,
        d.status,
        d.image_url || null,
        d.condition,
      ],
    );
    await q.query('UPDATE listings SET image_url=$1,image_urls=$2 WHERE id=$3', [
      images[0] || null,
      JSON.stringify(images),
      l.id,
    ]);
    await q.query('UPDATE listings SET pickup_available=$1,delivery_available=$2 WHERE id=$3', [
      d.pickup_available ?? true,
      d.delivery_available ?? true,
      l.id,
    ]);
    l.pickup_available = d.pickup_available ?? true;
    l.delivery_available = d.delivery_available ?? true;
    l.image_url = images[0] || null;
    l.image_urls = images;
    l.variants = await saveVariants(q, l, d.variants);
    requirePreorders(deps, d);
    await savePreorder(q, l.id, d);
    if (!opts.quiet) await announceNewListing(q, l);
    // Someone may already be asking for this: they and the seller are told.
    await alertRequestsForListing(q, l);
    await audit(q, u.id, 'listing.create', l.id);
    return l;
  }
  async function updateListing(q: Query, u: any, input: RequestInput) {
    const d = listingSchema.partial().parse(input.body);
    const [s] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [u.id]);
    ensure(
      s?.status === 'APPROVED',
      403,
      'SELLER_NOT_APPROVED',
      'Approved seller access required.',
    );
    const [l] = await q.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(l && l.seller_id === u.id, 404, 'NOT_FOUND', 'Listing not found.');
    const wasAvailable = await listingAvailable(q, l.id);
    const merged = { ...l, ...d };
    ensure(
      merged.pickup_available || merged.delivery_available,
      400,
      'FULFILMENT_REQUIRED',
      'Offer collection or delivery.',
    );
    await validateCategory(q, merged.category!, merged.title!, merged.description!);
    ensure(!l.archived_at, 409, 'LISTING_ARCHIVED', 'Restore this listing before editing it.');
    const images =
      d.image_urls ||
      (d.image_url !== undefined ? (d.image_url ? [d.image_url] : []) : l.image_urls || []);
    // A shared catalogue photo isn't the seller's own upload; only their own photos are checked.
    const [shared] = l.catalogue_photo_id
      ? await q.query('SELECT url FROM catalogue_photos WHERE id=$1', [l.catalogue_photo_id])
      : [];
    await validateImages(
      q,
      u.id,
      images.filter((x: string) => x !== shared?.url),
    );
    // stock represents AVAILABLE stock; existing reservations are separate and preserved.
    const [updated] = await q.query(
      'UPDATE listings SET title=$1,description=$2,category=$3,unit=$4,price_kobo=$5,stock=$6,status=$7,image_url=$8,condition=$9,confirmed_at=now() WHERE id=$10 RETURNING *',
      [
        merged.title,
        merged.description,
        merged.category,
        merged.unit,
        merged.price_kobo,
        merged.stock,
        merged.status,
        merged.image_url,
        merged.condition,
        l.id,
      ],
    );
    await q.query('UPDATE listings SET image_url=$1,image_urls=$2 WHERE id=$3', [
      images[0] || null,
      JSON.stringify(images),
      l.id,
    ]);
    // The seller's own photo replaces the shared one (freeing it for others), and is shared for
    // the same catalogue product unless they said no.
    if (shared && images[0] !== shared.url)
      await q.query('UPDATE listings SET catalogue_photo_id=NULL WHERE id=$1', [l.id]);
    if (
      l.catalogue_product_id &&
      images[0] &&
      images[0] !== shared?.url &&
      input.body?.share_photo !== false
    )
      await sharePhoto(q, l.catalogue_product_id, images[0], u.id);
    await q.query('UPDATE listings SET pickup_available=$1,delivery_available=$2 WHERE id=$3', [
      merged.pickup_available,
      merged.delivery_available,
      l.id,
    ]);
    updated.pickup_available = merged.pickup_available;
    updated.delivery_available = merged.delivery_available;
    updated.image_url = images[0] || null;
    updated.image_urls = images;
    if (d.variants) updated.variants = await saveVariants(q, updated, d.variants);
    else if (d.stock !== undefined || d.price_kobo !== undefined || d.unit !== undefined) {
      await q.query(
        'UPDATE listing_variants SET stock=$1,price_kobo=$2,unit=$3 WHERE listing_id=$4 AND is_primary',
        [merged.stock, merged.price_kobo, merged.unit, l.id],
      );
    }
    requirePreorders(deps, d);
    await savePreorder(q, l.id, d);
    await notifyIfRestocked(q, l.id, wasAvailable);
    await audit(q, u.id, 'listing.update', l.id, d);
    return updated;
  }
  return { applyAsSeller, listListings, createListing, updateListing };
}
