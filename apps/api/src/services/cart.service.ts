import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { createBookingsService } from './booking.service.js';
import { unitPrice } from './catalog.service.js';

export const cartAddInput = z.object({
  listing_id: z.uuid(),
  variant_id: z.uuid().optional(),
  quantity: z.number().int().min(1).max(100000).default(1),
  /** The Smart Planner item this purchase is for (optional). */
  plan_item_id: z.string().max(64).optional(),
});
export const cartUpdateInput = z.object({ quantity: z.number().int().min(1).max(100000) });
export const cartCheckoutInput = z.object({
  /** Lines to order; all lines when omitted. */
  line_ids: z.array(z.string().max(64)).max(100).optional(),
});

/** Checks that a plan item belongs to this user (cart lines and bookings may point at it). */
export async function ownPlanItem(q: Query, userId: string, planItemId?: string | null) {
  if (!planItemId) return null;
  const [row] = await q.query(
    'SELECT i.id FROM plan_items i JOIN plans p ON p.id=i.plan_id WHERE i.id=$1 AND p.user_id=$2',
    [planItemId, userId],
  );
  ensure(row, 404, 'PLAN_ITEM_NOT_FOUND', 'That plan item was not found.');
  return row.id as string;
}

/**
 * Multi-seller cart. Lines are grouped by seller; checkout sends each line to its seller as an
 * ordinary booking request (same stock, limits and payment flow as booking one item).
 */
export function createCartService(deps: AppDeps) {
  const { db } = deps;
  const bookings = createBookingsService(deps);

  async function lines(userId: string) {
    return db.query(
      `SELECT c.id,c.quantity,c.plan_item_id,c.listing_id,c.variant_id,l.title,l.image_url,l.category,
         l.pickup_available,l.delivery_available,l.status AS listing_status,
         (SELECT m.thumbnail_url FROM media m WHERE m.url=l.image_url) AS thumbnail_url,
         v.name AS variant_name,v.unit,v.price_kobo,v.stock,v.min_quantity,v.active,
         v.wholesale_tiers,s.user_id AS seller_id,s.business_name,s.area,s.city,s.status AS seller_status
       FROM cart_items c JOIN listings l ON l.id=c.listing_id JOIN listing_variants v ON v.id=c.variant_id
       JOIN sellers s ON s.user_id=l.seller_id WHERE c.user_id=$1 ORDER BY c.created_at,c.id`,
      [userId],
    );
  }

  async function getCart(user: any, _input?: RequestInput) {
    const rows = await lines(user.id);
    const sellers = new Map<string, any>();
    let total = 0,
      count = 0;
    for (const r of rows) {
      const price = unitPrice(r as any, r.quantity);
      const problem =
        r.listing_status !== 'ACTIVE' || r.seller_status !== 'APPROVED' || !r.active
          ? 'No longer available'
          : r.quantity < r.min_quantity
            ? `Minimum order is ${r.min_quantity} ${r.unit}`
            : r.stock < r.quantity
              ? r.stock > 0
                ? `Only ${r.stock} ${r.unit} left`
                : 'Out of stock'
              : null;
      const line = {
        id: r.id,
        listing_id: r.listing_id,
        variant_id: r.variant_id,
        plan_item_id: r.plan_item_id,
        title: r.title,
        variant_name: r.variant_name,
        unit: r.unit,
        image_url: r.image_url,
        thumbnail_url: r.thumbnail_url,
        quantity: r.quantity,
        unit_price_kobo: price,
        total_kobo: price * r.quantity,
        available: !problem,
        problem,
      };
      if (!sellers.has(r.seller_id))
        sellers.set(r.seller_id, {
          seller_id: r.seller_id,
          business_name: r.business_name,
          area: r.area,
          city: r.city,
          pickup_available: false,
          delivery_available: false,
          subtotal_kobo: 0,
          lines: [],
        });
      const group = sellers.get(r.seller_id);
      group.lines.push(line);
      group.pickup_available ||= r.pickup_available;
      group.delivery_available ||= r.delivery_available;
      if (line.available) {
        group.subtotal_kobo += line.total_kobo;
        total += line.total_kobo;
      }
      count += 1;
    }
    return {
      sellers: [...sellers.values()],
      line_count: count,
      total_kobo: total,
      notice:
        'Each seller confirms their part of your order. Pay each seller after they accept; delivery is arranged per seller.',
    };
  }

  async function addToCart(q: Query, user: any, input: RequestInput) {
    const d = cartAddInput.parse(input.body);
    const [l] = await q.query(
      "SELECT l.id,l.seller_id FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1 AND l.status='ACTIVE' AND s.status='APPROVED'",
      [d.listing_id],
    );
    ensure(l, 404, 'NOT_FOUND', 'This product is no longer available.');
    ensure(l.seller_id !== user.id, 400, 'OWN_LISTING', 'You cannot buy your own listing.');
    const [variant] = await q.query(
      `SELECT id FROM listing_variants WHERE listing_id=$1 AND active AND ${d.variant_id ? 'id=$2' : 'is_primary'}`,
      d.variant_id ? [l.id, d.variant_id] : [l.id],
    );
    ensure(variant, 400, 'VARIANT_REQUIRED', 'Choose an available option.');
    const planItem = await ownPlanItem(q, user.id, d.plan_item_id);
    const [count] = await q.query('SELECT COUNT(*)::int AS n FROM cart_items WHERE user_id=$1', [
      user.id,
    ]);
    ensure(count.n < 100, 400, 'CART_FULL', 'Your cart holds up to 100 items.');
    const [line] = await q.query(
      `INSERT INTO cart_items(id,user_id,listing_id,variant_id,quantity,plan_item_id) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(user_id,variant_id) DO UPDATE SET quantity=LEAST(100000,cart_items.quantity+EXCLUDED.quantity),
         plan_item_id=COALESCE(EXCLUDED.plan_item_id,cart_items.plan_item_id),updated_at=now()
       RETURNING id,quantity`,
      [randomUUID(), user.id, l.id, variant.id, d.quantity, planItem],
    );
    if (planItem)
      await q.query(
        "UPDATE plan_items SET listing_id=$1,variant_id=$2,status=CASE WHEN status IN ('PLANNED','UNAVAILABLE') THEN 'SAVED' ELSE status END,updated_at=now() WHERE id=$3",
        [l.id, variant.id, planItem],
      );
    return { id: line.id as string, quantity: line.quantity as number };
  }

  async function updateLine(q: Query, user: any, input: RequestInput) {
    const d = cartUpdateInput.parse(input.body);
    const [line] = await q.query(
      'UPDATE cart_items SET quantity=$1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING id,quantity',
      [d.quantity, input.params.id, user.id],
    );
    ensure(line, 404, 'NOT_FOUND', 'That item is not in your cart.');
    return { id: line.id as string, quantity: line.quantity as number };
  }

  async function removeLine(q: Query, user: any, input: RequestInput) {
    const [line] = await q.query('DELETE FROM cart_items WHERE id=$1 AND user_id=$2 RETURNING id', [
      input.params.id,
      user.id,
    ]);
    ensure(line, 404, 'NOT_FOUND', 'That item is not in your cart.');
    return { ok: true };
  }

  /** Sends every chosen line to its seller as a booking request, all or nothing. */
  async function checkout(q: Query, user: any, input: RequestInput) {
    const d = cartCheckoutInput.parse(input.body ?? {});
    const rows = await q.query(
      `SELECT c.*,l.title FROM cart_items c JOIN listings l ON l.id=c.listing_id
       WHERE c.user_id=$1 AND ($2::text[] IS NULL OR c.id=ANY($2)) ORDER BY c.created_at,c.id FOR UPDATE OF c`,
      [user.id, d.line_ids ?? null],
    );
    ensure(rows.length, 400, 'CART_EMPTY', 'Your cart is empty.');
    const created: any[] = [];
    for (const row of rows) {
      let booking: any;
      try {
        booking = await bookings.createBooking(q, user, {
          body: { listing_id: row.listing_id, variant_id: row.variant_id, quantity: row.quantity },
          params: {},
          query: {},
        } as unknown as RequestInput);
      } catch (e) {
        // One failing line cancels the whole checkout, so say which product it was.
        if (e instanceof AppError)
          throw new AppError(e.status, e.code, `${row.title}: ${e.message}`);
        throw e;
      }
      if (row.plan_item_id) {
        await q.query('UPDATE bookings SET plan_item_id=$1 WHERE id=$2', [
          row.plan_item_id,
          booking.id,
        ]);
        booking.plan_item_id = row.plan_item_id;
      }
      created.push(booking);
    }
    await q.query('DELETE FROM cart_items WHERE user_id=$1 AND id=ANY($2)', [
      user.id,
      rows.map((r: any) => r.id),
    ]);
    const sellers = new Set(created.map((b) => b.seller_id)).size;
    return {
      bookings: created,
      sellers,
      message: `Sent ${created.length} request${created.length === 1 ? '' : 's'} to ${sellers} seller${sellers === 1 ? '' : 's'}. Pay each one after the seller accepts.`,
    };
  }

  return { getCart, addToCart, updateLine, removeLine, checkout };
}
