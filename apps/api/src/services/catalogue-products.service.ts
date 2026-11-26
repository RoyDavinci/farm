import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { productConditions, productUnits } from '../config/marketplace.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { createMarketplaceService, validateImages } from './listing.service.js';

/**
 * Shared catalogue and easy stock:
 * - sellers pick standard products ("iPhone 15 Pro", "Peak Milk 400g") and just set prices, many at
 *   once, with no photos needed;
 * - shared photos (from sellers who allow it, or staff) are spread across listings: each listing
 *   gets the least-used photo, so one photo isn't on more than ~10 listings while others exist;
 * - "always in stock" listings never run down (the seller confirms each order), "out today" hides
 *   an item until midnight, and quick price updates keep a big list current.
 */

/** A shared photo is preferred on fewer than this many listings before others are rotated in. */
export const PHOTO_SHARE_LIMIT = 10;

const productInput = z.object({
  name: z.string().trim().min(3).max(120),
  brand: z.string().trim().max(60).default(''),
  category: z.string().trim().min(2).max(50),
  unit: z.enum(productUnits),
});
const keywords = (name: string, brand: string) =>
  [...new Set(`${name} ${brand}`.toLowerCase().match(/[a-z0-9]+/g) || [])].sort().join(' ');

/** The least-used active shared photo of a product, or null when it has none. */
export async function pickPhoto(q: Query, productId: string) {
  const [p] = await q.query(
    `SELECT p.id,p.url,p.thumbnail_url,
       (SELECT COUNT(*)::int FROM listings l WHERE l.catalogue_photo_id=p.id AND l.archived_at IS NULL) AS uses
     FROM catalogue_photos p WHERE p.product_id=$1 AND p.active
     ORDER BY (SELECT COUNT(*) FROM listings l WHERE l.catalogue_photo_id=p.id AND l.archived_at IS NULL)>=$2,
       (SELECT COUNT(*) FROM listings l WHERE l.catalogue_photo_id=p.id AND l.archived_at IS NULL),p.created_at
     LIMIT 1`,
    [productId, PHOTO_SHARE_LIMIT],
  );
  return p ?? null;
}

/** Adds a seller's own photo to the product's shared pool (they agreed to share it). */
export async function sharePhoto(q: Query, productId: string, url: string, sellerId: string) {
  const [m] = await q.query('SELECT thumbnail_url FROM media WHERE url=$1', [url]);
  await q.query(
    "INSERT INTO catalogue_photos(id,product_id,url,thumbnail_url,contributor_id,source) VALUES($1,$2,$3,$4,$5,'SELLER') ON CONFLICT(product_id,url) DO NOTHING",
    [randomUUID(), productId, url, m?.thumbnail_url ?? null, sellerId],
  );
}

/** End of today in Lagos, when "out today" items come back. */
const endOfToday =
  "(date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos'";

/** Hourly: how reliably each seller fulfils orders over the last 90 days. */
export async function refreshFulfilment(db: Database) {
  await db.query(
    `WITH decided AS (
       SELECT b.seller_id,
         COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM events e WHERE e.booking_id=b.id AND e.to_status='ACCEPTED')) AS kept,
         COUNT(*) AS total
       FROM bookings b
       WHERE b.created_at>now()-interval '90 days'
         AND (EXISTS(SELECT 1 FROM events e WHERE e.booking_id=b.id AND e.to_status='ACCEPTED')
              OR (b.status='DECLINED' AND b.decline_reason='OUT_OF_STOCK')
              OR (b.status='EXPIRED' AND NOT EXISTS(SELECT 1 FROM events e WHERE e.booking_id=b.id AND e.to_status='ACCEPTED')))
       GROUP BY b.seller_id)
     UPDATE sellers s SET fulfilment_orders=COALESCE(d.total,0),
       fulfilment_pct=CASE WHEN COALESCE(d.total,0)>=5 THEN ROUND(100.0*d.kept/d.total)::int END
     FROM sellers s2 LEFT JOIN decided d ON d.seller_id=s2.user_id WHERE s.user_id=s2.user_id`,
  );
}

/** Words that say nothing about what the product is. */
const NAME_NOISE = new Set([
  'fresh',
  'the',
  'and',
  'with',
  'for',
  'pack',
  'piece',
  'bag',
  'per',
  'new',
  'big',
  'small',
  'large',
  'medium',
  'standard',
  'quality',
  'original',
]);

export function createCatalogueProductsService(deps: AppDeps) {
  const { db } = deps;
  const marketplace = createMarketplaceService(deps);
  const approved = async (q: Query, uid: string) => {
    const [s] = await q.query('SELECT status FROM sellers WHERE user_id=$1', [uid]);
    ensure(s?.status === 'APPROVED', 403, 'SELLER_NOT_APPROVED', 'Approved sellers only.');
  };

  /** Search the shared catalogue; shows how many sellers stock each product and their prices. */
  async function searchCatalogue(user: any, input: RequestInput) {
    const d = z
      .object({
        q: z.string().trim().max(100).default(''),
        category: z.string().max(50).default(''),
      })
      .parse(input.query);
    const words = d.q.toLowerCase().match(/[a-z0-9]+/g) || [];
    const rows = await db.query(
      `SELECT p.id,p.name,p.brand,p.category,p.unit,
         (SELECT COUNT(*)::int FROM catalogue_photos f WHERE f.product_id=p.id AND f.active) AS photos,
         (SELECT COALESCE(f.thumbnail_url,f.url) FROM catalogue_photos f WHERE f.product_id=p.id AND f.active ORDER BY f.created_at LIMIT 1) AS photo,
         (SELECT COUNT(DISTINCT l.seller_id)::int FROM listings l WHERE l.catalogue_product_id=p.id AND l.status='ACTIVE' AND l.archived_at IS NULL) AS sellers,
         (SELECT MIN(l.price_kobo) FROM listings l WHERE l.catalogue_product_id=p.id AND l.status='ACTIVE' AND l.archived_at IS NULL) AS min_price_kobo,
         (SELECT MAX(l.price_kobo) FROM listings l WHERE l.catalogue_product_id=p.id AND l.status='ACTIVE' AND l.archived_at IS NULL) AS max_price_kobo,
         EXISTS(SELECT 1 FROM listings l WHERE l.catalogue_product_id=p.id AND l.seller_id=$1 AND l.archived_at IS NULL) AS listed
       FROM catalogue_products p
       WHERE p.active AND ($2='' OR p.category=$2) AND (cardinality($3::text[])=0 OR (SELECT bool_and(p.keywords LIKE '%'||w||'%') FROM unnest($3::text[]) w))
       ORDER BY p.category,p.name LIMIT 300`,
      [user.id, d.category, words],
    );
    return rows.map((r: any) => ({
      ...r,
      min_price_kobo: r.min_price_kobo == null ? null : Number(r.min_price_kobo),
      max_price_kobo: r.max_price_kobo == null ? null : Number(r.max_price_kobo),
    }));
  }

  /** A seller adds a product the catalogue doesn't have yet (staff can tidy or switch it off). */
  async function addProduct(q: Query, user: any, input: RequestInput) {
    const d = productInput.parse(input.body);
    if (!user.admin) await approved(q, user.id);
    const [cat] = await q.query('SELECT 1 FROM catalogue_categories WHERE name=$1 AND active', [
      d.category,
    ]);
    ensure(cat, 400, 'INVALID_CATEGORY', 'Choose one of the listed categories.');
    const [existing] = await q.query(
      'SELECT * FROM catalogue_products WHERE lower(name)=lower($1) AND unit=$2',
      [d.name, d.unit],
    );
    if (existing) return existing;
    const [p] = await q.query(
      'INSERT INTO catalogue_products(id,name,brand,category,unit,keywords,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [randomUUID(), d.name, d.brand, d.category, d.unit, keywords(d.name, d.brand), user.id],
    );
    await audit(q, user.id, 'catalogue_product.create', p.id, d);
    return p;
  }

  /**
   * Adds many catalogue products to a shop at once: just prices (and optionally a stock count or
   * own photo). Items already in the shop are skipped. Listings without a photo get a shared one.
   */
  async function addFromCatalogue(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        items: z
          .array(
            z.object({
              product_id: z.string().max(60),
              price_kobo: z.number().int().min(100).max(100000000),
              stock_mode: z.enum(['ALWAYS', 'COUNTED']).default('ALWAYS'),
              stock: z.number().int().min(0).max(100000).optional(),
              condition: z.enum(productConditions).default('NEW'),
              photo_url: z.url().max(2000).optional(),
              /** Let other sellers use this photo for the same product. */
              share_photo: z.boolean().default(true),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(input.body);
    await approved(q, user.id);
    const created: string[] = [];
    const skipped: string[] = [];
    for (const item of d.items) {
      const [p] = await q.query('SELECT * FROM catalogue_products WHERE id=$1 AND active', [
        item.product_id,
      ]);
      ensure(p, 404, 'PRODUCT_NOT_FOUND', 'That product is no longer in the catalogue.');
      const [already] = await q.query(
        'SELECT 1 FROM listings WHERE seller_id=$1 AND catalogue_product_id=$2 AND archived_at IS NULL',
        [user.id, p.id],
      );
      if (already) {
        skipped.push(p.name);
        continue;
      }
      if (item.photo_url) await validateImages(q, user.id, [item.photo_url]);
      const listing: any = await marketplace.createListing(
        q,
        user,
        {
          body: {
            title: p.name,
            description: `${p.name}${p.brand ? ` by ${p.brand}` : ''}. Ask the seller about colours, sizes or versions.`,
            category: p.category,
            unit: p.unit,
            price_kobo: item.price_kobo,
            condition: item.condition,
            stock: item.stock_mode === 'ALWAYS' ? 100000 : (item.stock ?? 1),
            status: 'ACTIVE',
            ...(item.photo_url ? { image_url: item.photo_url } : {}),
          },
          params: {},
          query: {},
        } as unknown as RequestInput,
        { quiet: true },
      );
      await q.query('UPDATE listings SET catalogue_product_id=$1,stock_mode=$2 WHERE id=$3', [
        p.id,
        item.stock_mode,
        listing.id,
      ]);
      if (item.stock_mode === 'ALWAYS')
        await q.query('UPDATE listing_variants SET stock=stock WHERE listing_id=$1', [listing.id]);
      if (item.photo_url) {
        if (item.share_photo) await sharePhoto(q, p.id, item.photo_url, user.id);
      } else {
        const photo = await pickPhoto(q, p.id);
        if (photo)
          await q.query(
            'UPDATE listings SET image_url=$1,image_urls=$2,catalogue_photo_id=$3 WHERE id=$4',
            [photo.url, JSON.stringify([photo.url]), photo.id, listing.id],
          );
      }
      created.push(listing.id);
    }
    await audit(q, user.id, 'listing.catalogue_add', user.id, {
      created: created.length,
      skipped: skipped.length,
    });
    return { created: created.length, ids: created, skipped };
  }

  /** Update many prices at once: exact prices, or everything (or one category) up/down by %. */
  async function updatePrices(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        items: z
          .array(
            z.object({
              listing_id: z.string().max(60),
              price_kobo: z.number().int().min(100).max(100000000),
            }),
          )
          .max(500)
          .default([]),
        percent: z.number().min(-90).max(500).optional(),
        category: z.string().max(50).optional(),
      })
      .parse(input.body);
    await approved(q, user.id);
    ensure(
      d.items.length || d.percent !== undefined,
      400,
      'NOTHING_TO_UPDATE',
      'Change at least one price.',
    );
    let updated = 0;
    for (const i of d.items) {
      const rows = await q.query(
        'UPDATE listings SET price_kobo=$1,confirmed_at=now() WHERE id=$2 AND seller_id=$3 RETURNING id',
        [i.price_kobo, i.listing_id, user.id],
      );
      if (rows.length) {
        await q.query(
          'UPDATE listing_variants SET price_kobo=$1 WHERE listing_id=$2 AND is_primary',
          [i.price_kobo, i.listing_id],
        );
        updated++;
      }
    }
    if (d.percent !== undefined) {
      // Rounded to the nearest ₦10 so prices stay readable.
      const rows = await q.query(
        `UPDATE listings SET price_kobo=GREATEST(100,ROUND(price_kobo*(1+$1/100.0)/1000)*1000),confirmed_at=now()
         WHERE seller_id=$2 AND archived_at IS NULL AND ($3::text IS NULL OR category=$3) RETURNING id,price_kobo`,
        [d.percent, user.id, d.category ?? null],
      );
      for (const r of rows)
        await q.query(
          'UPDATE listing_variants SET price_kobo=$1 WHERE listing_id=$2 AND is_primary',
          [r.price_kobo, r.id],
        );
      updated += rows.length;
    }
    await audit(q, user.id, 'listing.prices_update', user.id, {
      updated,
      percent: d.percent ?? null,
    });
    return { updated };
  }

  /** "Out today": hides an item until midnight; it comes back by itself. */
  async function setOutToday(q: Query, user: any, input: RequestInput) {
    const d = z.object({ out: z.boolean() }).parse(input.body);
    const [l] = await q.query(
      `UPDATE listings SET out_until=${d.out ? endOfToday : 'NULL'},confirmed_at=now() WHERE id=$1 AND seller_id=$2 RETURNING id,out_until`,
      [input.params.id, user.id],
    );
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    return { id: l.id, out_until: l.out_until };
  }

  /** Switch between "always in stock" and keeping a count. */
  async function setStockMode(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        mode: z.enum(['ALWAYS', 'COUNTED']),
        stock: z.number().int().min(0).max(100000).optional(),
      })
      .parse(input.body);
    const [l] = await q.query(
      'UPDATE listings SET stock_mode=$1,confirmed_at=now() WHERE id=$2 AND seller_id=$3 RETURNING id',
      [d.mode, input.params.id, user.id],
    );
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    const stock = d.mode === 'ALWAYS' ? 100000 : (d.stock ?? 1);
    await q.query('UPDATE listing_variants SET stock=$1 WHERE listing_id=$2', [stock, l.id]);
    await q.query('UPDATE listings SET stock=$1 WHERE id=$2', [stock, l.id]);
    return { id: l.id, stock_mode: d.mode, stock };
  }

  // ---------- staff ----------
  async function adminCatalogue(_user: any, input: RequestInput) {
    const d = z
      .object({
        q: z.string().trim().max(100).default(''),
        needs_photos: z.enum(['true', 'false']).default('false'),
      })
      .parse(input.query);
    const rows = await db.query(
      `SELECT p.*,
         (SELECT COUNT(*)::int FROM listings l WHERE l.catalogue_product_id=p.id AND l.archived_at IS NULL) AS listings,
         (SELECT json_agg(json_build_object('id',f.id,'url',COALESCE(f.thumbnail_url,f.url),'source',f.source,
             'uses',(SELECT COUNT(*) FROM listings l WHERE l.catalogue_photo_id=f.id AND l.archived_at IS NULL)) ORDER BY f.created_at)
          FROM catalogue_photos f WHERE f.product_id=p.id AND f.active) AS photos
       FROM catalogue_products p
       WHERE ($1='' OR p.keywords LIKE '%'||lower($1)||'%' OR lower(p.name) LIKE '%'||lower($1)||'%')
       ORDER BY p.category,p.name LIMIT 500`,
      [d.q],
    );
    const shaped = rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      brand: r.brand,
      category: r.category,
      unit: r.unit,
      active: r.active,
      listings: r.listings,
      photos: (r.photos || []).map((p: any) => ({ ...p, uses: Number(p.uses) })),
    }));
    // "Needs photos": listed by sellers but with no photo, or every photo already widely used.
    return d.needs_photos === 'true'
      ? shaped.filter(
          (p: any) =>
            p.listings > 0 &&
            (!p.photos.length || p.photos.every((f: any) => f.uses >= PHOTO_SHARE_LIMIT)),
        )
      : shaped;
  }
  async function addStaffPhoto(q: Query, user: any, input: RequestInput) {
    const d = z.object({ url: z.url().max(2000) }).parse(input.body);
    const [p] = await q.query('SELECT id FROM catalogue_products WHERE id=$1', [input.params.id]);
    ensure(p, 404, 'NOT_FOUND', 'Product not found.');
    const [m] = await q.query('SELECT thumbnail_url FROM media WHERE url=$1 AND owner_id=$2', [
      d.url,
      user.id,
    ]);
    ensure(m, 400, 'INVALID_MEDIA', 'Upload the photo first.');
    const [photo] = await q.query(
      "INSERT INTO catalogue_photos(id,product_id,url,thumbnail_url,contributor_id,source) VALUES($1,$2,$3,$4,$5,'STAFF') ON CONFLICT(product_id,url) DO UPDATE SET active=TRUE RETURNING id",
      [randomUUID(), p.id, d.url, m.thumbnail_url, user.id],
    );
    // Listings of this product still without a photo get one now.
    const bare = await q.query(
      'SELECT id FROM listings WHERE catalogue_product_id=$1 AND image_url IS NULL AND archived_at IS NULL',
      [p.id],
    );
    for (const l of bare) {
      const pick = await pickPhoto(q, p.id);
      if (!pick) break;
      await q.query(
        'UPDATE listings SET image_url=$1,image_urls=$2,catalogue_photo_id=$3 WHERE id=$4',
        [pick.url, JSON.stringify([pick.url]), pick.id, l.id],
      );
    }
    await audit(q, user.id, 'catalogue_photo.add', photo.id);
    return { id: photo.id, filled: bare.length };
  }
  /** Words of a product name worth matching on ("Fresh tomatoes (1 kg)" → fresh, tomatoes). */
  const BARE = `l.status='ACTIVE' AND l.archived_at IS NULL AND l.image_url IS NULL
    AND COALESCE(jsonb_array_length(l.image_urls::jsonb),0)=0`;
  async function suggestionsFor(q: Query, title: string) {
    const words = [
      ...new Set((title.toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !NAME_NOISE.has(w))),
    ].slice(0, 6);
    if (!words.length) return [];
    return q.query(
      `SELECT f.id,COALESCE(f.thumbnail_url,f.url) AS thumbnail_url,f.url,p.name AS product,
         (SELECT COUNT(*)::int FROM unnest($1::text[]) w WHERE (lower(p.name)||' '||p.keywords) ~ ('\\m'||w)) AS hits
       FROM catalogue_photos f JOIN catalogue_products p ON p.id=f.product_id
       WHERE f.active AND p.active
         AND EXISTS(SELECT 1 FROM unnest($1::text[]) w WHERE (lower(p.name)||' '||p.keywords) ~ ('\\m'||w))
       ORDER BY hits DESC, f.created_at LIMIT 6`,
      [words],
    );
  }
  /** Staff: active listings with no photo, each with matching photos from the library. */
  async function bareListings(_user: any, input: RequestInput) {
    const d = z.object({ q: z.string().trim().max(100).default('') }).parse(input.query);
    const rows = await db.query(
      `SELECT l.id,l.title,l.category,l.unit,l.created_at,s.business_name,s.area
       FROM listings l JOIN sellers s ON s.user_id=l.seller_id
       WHERE ${BARE} AND ($1='' OR l.title ILIKE '%'||$1||'%' OR s.business_name ILIKE '%'||$1||'%')
       ORDER BY l.created_at DESC LIMIT 200`,
      [d.q],
    );
    const out = [];
    for (const r of rows) out.push({ ...r, suggestions: await suggestionsFor(db as any, r.title) });
    return out;
  }
  /** Puts a library photo (or a new staff upload, saved to the library) on a listing. */
  async function attachPhoto(q: Query, user: any, l: any, photo: any, productId: string) {
    await q.query(
      `UPDATE listings SET image_url=$1,image_urls=$2,catalogue_photo_id=$3,
         catalogue_product_id=COALESCE(catalogue_product_id,$4) WHERE id=$5`,
      [photo.url, JSON.stringify([photo.url]), photo.id, productId, l.id],
    );
    await notify(
      q,
      l.seller_id,
      'listing',
      'We added a photo to your product',
      `“${l.title}” had no photo, so we added a representative one. Replace it with your own photo any time.`,
      { link: 'sell' },
    );
    await audit(q, user.id, 'listing.library_photo', l.id, { photo_id: photo.id });
  }
  async function setListingPhoto(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({ photo_id: z.string().max(60).optional(), url: z.url().max(2000).optional() })
      .refine((x) => x.photo_id || x.url, 'Choose a photo.')
      .parse(input.body);
    const [l] = await q.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(l && !l.archived_at, 404, 'NOT_FOUND', 'Listing not found.');
    if (d.photo_id) {
      const [f] = await q.query('SELECT * FROM catalogue_photos WHERE id=$1 AND active', [
        d.photo_id,
      ]);
      ensure(f, 404, 'NOT_FOUND', 'Photo not found.');
      await attachPhoto(q, user, l, f, f.product_id);
      return { ok: true as const };
    }
    // A new photo: it joins the library under this product name, so the next seller gets it too.
    const [m] = await q.query('SELECT thumbnail_url FROM media WHERE url=$1 AND owner_id=$2', [
      d.url,
      user.id,
    ]);
    ensure(m, 400, 'INVALID_MEDIA', 'Upload the photo first.');
    let productId = l.catalogue_product_id;
    if (!productId) {
      const [p] = await q.query(
        'SELECT id FROM catalogue_products WHERE lower(name)=lower($1) AND unit=$2',
        [l.title, l.unit],
      );
      productId =
        p?.id ??
        (
          await q.query(
            'INSERT INTO catalogue_products(id,name,brand,category,unit,keywords,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [randomUUID(), l.title, '', l.category, l.unit, l.title.toLowerCase(), user.id],
          )
        )[0].id;
    }
    const [f] = await q.query(
      "INSERT INTO catalogue_photos(id,product_id,url,thumbnail_url,contributor_id,source) VALUES($1,$2,$3,$4,$5,'STAFF') ON CONFLICT(product_id,url) DO UPDATE SET active=TRUE RETURNING *",
      [randomUUID(), productId, d.url, m.thumbnail_url, user.id],
    );
    await attachPhoto(q, user, l, f, productId);
    return { ok: true as const };
  }
  /** Gives every photo-less listing its best library match (those with no match are left). */
  async function fillBareListings(q: Query, user: any, _input: RequestInput) {
    const rows = await q.query(
      `SELECT l.* FROM listings l WHERE ${BARE} ORDER BY l.created_at DESC LIMIT 500 FOR UPDATE`,
    );
    let filled = 0;
    for (const l of rows) {
      const [best] = await suggestionsFor(q, l.title);
      if (!best) continue;
      const [f] = await q.query('SELECT * FROM catalogue_photos WHERE id=$1', [best.id]);
      await attachPhoto(q, user, l, f, f.product_id);
      filled++;
    }
    return { filled, left: rows.length - filled };
  }
  /** Takes a shared photo out of use (wrong product, poor quality, a complaint). */
  async function removePhoto(q: Query, user: any, input: RequestInput) {
    const [f] = await q.query(
      'UPDATE catalogue_photos SET active=FALSE WHERE id=$1 RETURNING id,product_id',
      [input.params.id],
    );
    ensure(f, 404, 'NOT_FOUND', 'Photo not found.');
    // Listings showing it move to another shared photo, or none.
    const using = await q.query('SELECT id FROM listings WHERE catalogue_photo_id=$1', [f.id]);
    for (const l of using) {
      const pick = await pickPhoto(q, f.product_id);
      await q.query(
        'UPDATE listings SET image_url=$1,image_urls=$2,catalogue_photo_id=$3 WHERE id=$4',
        [pick?.url ?? null, JSON.stringify(pick ? [pick.url] : []), pick?.id ?? null, l.id],
      );
    }
    await audit(q, user.id, 'catalogue_photo.remove', f.id);
    return { ok: true as const };
  }
  async function setProductActive(q: Query, user: any, input: RequestInput) {
    const d = z.object({ active: z.boolean() }).parse(input.body);
    const [p] = await q.query('UPDATE catalogue_products SET active=$1 WHERE id=$2 RETURNING id', [
      d.active,
      input.params.id,
    ]);
    ensure(p, 404, 'NOT_FOUND', 'Product not found.');
    await audit(q, user.id, 'catalogue_product.active', p.id, d);
    return { ok: true as const };
  }
  return {
    searchCatalogue,
    addProduct,
    addFromCatalogue,
    updatePrices,
    setOutToday,
    setStockMode,
    adminCatalogue,
    addStaffPhoto,
    removePhoto,
    setProductActive,
    bareListings,
    setListingPhoto,
    fillBareListings,
  };
}
