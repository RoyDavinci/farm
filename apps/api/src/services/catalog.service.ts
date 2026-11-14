import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
export const variantSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    unit: z.enum(['kg', 'crate', 'bag', 'basket', 'piece', 'carton']),
    price_kobo: z.number().int().min(100).max(100000000),
    stock: z.number().int().min(0).max(100000),
    min_quantity: z.number().int().min(1).max(100000).default(1),
    active: z.boolean().default(true),
    wholesale_tiers: z
      .array(
        z.object({
          min_quantity: z.number().int().min(2).max(100000),
          price_kobo: z.number().int().min(100).max(100000000),
        }),
      )
      .max(10)
      .default([]),
  })
  .superRefine((v, ctx) => {
    const tiers = [...v.wholesale_tiers].sort((a, b) => a.min_quantity - b.min_quantity);
    let lastQty = v.min_quantity,
      lastPrice = v.price_kobo;
    for (const t of tiers) {
      if (t.min_quantity <= lastQty || t.price_kobo > lastPrice)
        ctx.addIssue({
          code: 'custom',
          message: 'Wholesale thresholds must increase and prices must stay the same or decrease.',
        });
      lastQty = t.min_quantity;
      lastPrice = t.price_kobo;
    }
  });
export type VariantInput = z.infer<typeof variantSchema>;
export function unitPrice(v: { price_kobo: number; wholesale_tiers: any[] }, quantity: number) {
  let price = v.price_kobo;
  for (const t of [...v.wholesale_tiers].sort((a, b) => a.min_quantity - b.min_quantity)) {
    if (quantity >= t.min_quantity) price = t.price_kobo;
  }
  return price;
}
export async function syncPrimary(q: Query, listingId: string) {
  await q.query(
    'UPDATE listings l SET unit=v.unit,price_kobo=v.price_kobo,stock=v.stock FROM listing_variants v WHERE v.listing_id=l.id AND v.is_primary AND l.id=$1',
    [listingId],
  );
}
export async function saveVariants(q: Query, listing: any, inputs?: VariantInput[]) {
  const current = await q.query(
    'SELECT * FROM listing_variants WHERE listing_id=$1 ORDER BY is_primary DESC,created_at,id FOR UPDATE',
    [listing.id],
  );
  const variants = inputs || [
    {
      id: current[0]?.id,
      name: current[0]?.name || 'Standard',
      unit: listing.unit,
      price_kobo: listing.price_kobo,
      stock: listing.stock,
      min_quantity: current[0]?.min_quantity || 1,
      active: true,
      wholesale_tiers: current[0]?.wholesale_tiers || [],
    },
  ];
  ensure(
    variants.length > 0 && variants.some((v) => v.active),
    400,
    'VARIANTS_REQUIRED',
    'Keep at least one active product variant.',
  );
  const seen = new Set<string>();
  for (const v of variants) {
    if (v.id) {
      ensure(
        current.some((c) => c.id === v.id),
        400,
        'INVALID_VARIANT',
        'A variant does not belong to this listing.',
      );
      ensure(!seen.has(v.id), 400, 'DUPLICATE_VARIANT', 'Each variant must appear once.');
      seen.add(v.id);
    }
  }
  await q.query('UPDATE listing_variants SET is_primary=FALSE,active=FALSE WHERE listing_id=$1', [
    listing.id,
  ]);
  let primaryAssigned = false;
  for (const v of variants) {
    const primary = v.active && !primaryAssigned;
    if (primary) primaryAssigned = true;
    await q.query(
      'INSERT INTO listing_variants(id,listing_id,name,unit,price_kobo,stock,min_quantity,wholesale_tiers,active,is_primary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=$3,unit=$4,price_kobo=$5,stock=$6,min_quantity=$7,wholesale_tiers=$8,active=$9,is_primary=$10',
      [
        v.id || randomUUID(),
        listing.id,
        v.name,
        v.unit,
        v.price_kobo,
        v.stock,
        v.min_quantity,
        JSON.stringify(v.wholesale_tiers),
        v.active,
        primary,
      ],
    );
  }
  await syncPrimary(q, listing.id);
  return q.query(
    'SELECT * FROM listing_variants WHERE listing_id=$1 ORDER BY is_primary DESC,created_at,id',
    [listing.id],
  );
}
export async function attachVariants(q: Query, rows: any[], mine = false) {
  if (!rows.length) return rows;
  const variants = await q.query(
    `SELECT * FROM listing_variants WHERE listing_id=ANY($1::text[]) ${mine ? '' : 'AND active'} ORDER BY is_primary DESC,created_at,id`,
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => ({ ...r, variants: variants.filter((v) => v.listing_id === r.id) }));
}
