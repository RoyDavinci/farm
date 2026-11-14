import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { audit } from '../services/audit.service.js';
import { attachVariants, saveVariants } from '../services/catalog.service.js';
import { setLocation } from '../services/geography.service.js';
import { savePreorder, validateImages } from '../services/listing.service.js';
import {
  announceNewListing,
  bookableSql,
  listingAvailable,
  notifyIfRestocked,
} from '../services/retention.service.js';
import type { AppDeps } from '../types/deps.js';
import { listingSchema, sellerSchema } from '../validators/marketplace.validators.js';

/** Seller applications and listings (create, update, browse). */
export function createMarketplaceController(deps: AppDeps) {
  const { db, mutate } = deps;
  const id = () => randomUUID();
  const applyAsSeller: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = sellerSchema.parse(req.body);
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
      await setLocation(q, u.id, d);
      await audit(q, u.id, 'seller.register', u.id);
      return s;
    });
  const listListings: RequestHandler = async (req, res) => {
    const query = z
      .object({
        q: z.string().max(100).default(''),
        city: z.string().max(100).default(''),
        category: z.string().max(100).default(''),
        mine: z.enum(['true', 'false']).default('false'),
      })
      .parse(req.query);
    const mine = query.mine === 'true';
    const args: any[] = mine
      ? [res.locals.user.id]
      : [`%${query.q}%`, `%${query.city}%`, query.category];
    const rows = await db.query(
      `SELECT l.*,(SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,s.business_name,s.city,s.area,s.business_type FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE ${mine ? 'l.seller_id=$1' : `s.status='APPROVED' AND EXISTS(SELECT 1 FROM users su WHERE su.id=s.user_id AND su.status='ACTIVE') AND l.status='ACTIVE' AND ${bookableSql('l')} AND (l.title ILIKE $1 OR l.category ILIKE $1 OR s.business_name ILIKE $1) AND s.city ILIKE $2 AND ($3='' OR l.category=$3)`} ORDER BY l.created_at DESC LIMIT 100`,
      args,
    );
    res.json(await attachVariants(db, rows, mine));
  };
  const createListing: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = listingSchema.parse(req.body);
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
        'INSERT INTO listings(id,seller_id,title,description,category,unit,price_kobo,stock,status,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
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
        ],
      );
      await q.query('UPDATE listings SET image_url=$1,image_urls=$2 WHERE id=$3', [
        images[0] || null,
        JSON.stringify(images),
        l.id,
      ]);
      l.image_url = images[0] || null;
      l.image_urls = images;
      l.variants = await saveVariants(q, l, d.variants);
      await savePreorder(q, l.id, d);
      await announceNewListing(q, l);
      await audit(q, u.id, 'listing.create', l.id);
      return l;
    });
  const updateListing: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = listingSchema.partial().parse(req.body);
      const [s] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [u.id]);
      ensure(
        s?.status === 'APPROVED',
        403,
        'SELLER_NOT_APPROVED',
        'Approved seller access required.',
      );
      const [l] = await q.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [req.params.id]);
      ensure(l && l.seller_id === u.id, 404, 'NOT_FOUND', 'Listing not found.');
      const wasAvailable = await listingAvailable(q, l.id);
      const merged = { ...l, ...d };
      const images =
        d.image_urls ||
        (d.image_url !== undefined ? (d.image_url ? [d.image_url] : []) : l.image_urls || []);
      await validateImages(q, u.id, images);
      // stock represents AVAILABLE stock; existing reservations are separate and preserved.
      const [updated] = await q.query(
        'UPDATE listings SET title=$1,description=$2,category=$3,unit=$4,price_kobo=$5,stock=$6,status=$7,image_url=$8,confirmed_at=now() WHERE id=$9 RETURNING *',
        [
          merged.title,
          merged.description,
          merged.category,
          merged.unit,
          merged.price_kobo,
          merged.stock,
          merged.status,
          merged.image_url,
          l.id,
        ],
      );
      await q.query('UPDATE listings SET image_url=$1,image_urls=$2 WHERE id=$3', [
        images[0] || null,
        JSON.stringify(images),
        l.id,
      ]);
      updated.image_url = images[0] || null;
      updated.image_urls = images;
      if (d.variants) updated.variants = await saveVariants(q, updated, d.variants);
      else if (d.stock !== undefined || d.price_kobo !== undefined || d.unit !== undefined) {
        await q.query(
          'UPDATE listing_variants SET stock=$1,price_kobo=$2,unit=$3 WHERE listing_id=$4 AND is_primary',
          [merged.stock, merged.price_kobo, merged.unit, l.id],
        );
      }
      await savePreorder(q, l.id, d);
      await notifyIfRestocked(q, l.id, wasAvailable);
      await audit(q, u.id, 'listing.update', l.id, d);
      return updated;
    });
  return { applyAsSeller, listListings, createListing, updateListing };
}
