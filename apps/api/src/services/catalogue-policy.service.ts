import { z } from 'zod';
import type { Query, Database } from '../database/client.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { ensure } from '../lib/errors.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
export const categoryInput = z.object({
  name: z.string().trim().min(2).max(50),
  active: z.boolean(),
  rules: z.string().trim().max(4000).default(''),
  prohibited_terms: z.array(z.string().trim().min(2).max(80)).max(100).default([]),
  /** Commission for this category in basis points (500 = 5%); null uses the default. */
  commission_bps: z.number().int().min(0).max(3000).nullable().optional(),
});
export const policyInput = z
  .object({
    inspection_minutes: z.number().int().min(1).max(120),
    pod_max_kobo: z.number().int().min(0).max(100000000),
    stock_stale_days: z.number().int().min(0).max(365),
    stock_reminder_days: z.number().int().min(1).max(365),
    appeal_days: z.number().int().min(1).max(90),
    no_show_penalty_kobo: z.literal(0),
    third_party_funding: z.enum(['REVIEW', 'DENY']),
    return_cost_rule: z.literal('STAFF_REVIEW'),
    background_tracking: z.boolean(),
  })
  .superRefine((d, c) => {
    if (d.stock_stale_days && d.stock_reminder_days >= d.stock_stale_days)
      c.addIssue({
        code: 'custom',
        message: 'Stock reminders must precede hiding stale listings.',
      });
  });
export async function validateCategory(
  q: Query,
  category: string,
  title: string,
  description: string,
) {
  const [c] = await q.query('SELECT * FROM catalogue_categories WHERE name=$1', [category]);
  ensure(c?.active, 400, 'CATEGORY_UNAVAILABLE', 'Choose an active product category.');
  ensure(
    !c.prohibited_terms.some((t: string) =>
      `${title} ${description}`.toLowerCase().includes(t.toLowerCase()),
    ),
    400,
    'PROHIBITED_CONTENT',
    'This listing conflicts with the category policy. Review the category rules.',
  );
}
export async function stockFreshnessReminders(db: Database) {
  await db.transaction(async (q) => {
    const [p] = await q.query('SELECT approved FROM marketplace_policies WHERE id=1');
    const days = Number(p.approved.stock_reminder_days || 0);
    if (!days) return;
    const rows = await q.query(
      "SELECT * FROM listings WHERE status='ACTIVE' AND archived_at IS NULL AND stock_mode<>'ALWAYS' AND confirmed_at<now()-$1*interval '1 day' AND (stock_reminded_at IS NULL OR stock_reminded_at<confirmed_at) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",
      [days],
    );
    for (const l of rows) {
      await q.query('UPDATE listings SET stock_reminded_at=now() WHERE id=$1', [l.id]);
      await notify(
        q,
        l.seller_id,
        'stock',
        'Please reconfirm your stock',
        `Review price and stock for ${l.title}. Stale listings may be hidden until reconfirmed.`,
      );
    }
  });
}
export function createCataloguePolicyService({ db }: AppDeps) {
  async function categories() {
    return db.query('SELECT * FROM catalogue_categories ORDER BY name');
  }
  async function saveCategory(q: Query, u: any, i: RequestInput) {
    const d = categoryInput.parse(i.body);
    await q.query(
      'INSERT INTO catalogue_categories(name,active,rules,prohibited_terms,commission_bps) VALUES($1,$2,$3,$4,$5) ON CONFLICT(name) DO UPDATE SET active=$2,rules=$3,prohibited_terms=$4,commission_bps=$5,updated_at=now()',
      [d.name, d.active, d.rules, JSON.stringify(d.prohibited_terms), d.commission_bps ?? null],
    );
    await audit(q, u.id, 'catalogue.category', d.name, d);
    return { ok: true };
  }
  async function policies() {
    return (await db.query('SELECT * FROM marketplace_policies WHERE id=1'))[0];
  }
  async function savePolicies(q: Query, u: any, i: RequestInput) {
    const d = policyInput.parse(i.body);
    await q.query('UPDATE marketplace_policies SET draft=$1,updated_at=now() WHERE id=1', [
      JSON.stringify(d),
    ]);
    await audit(q, u.id, 'policies.draft', '1', d);
    return { ok: true };
  }
  async function approveStockPolicy(q: Query, u: any, i: RequestInput) {
    const d = z.object({ reason: z.string().trim().min(5).max(500) }).parse(i.body);
    const [p] = await q.query('SELECT * FROM marketplace_policies WHERE id=1 FOR UPDATE');
    const v = policyInput.parse(p.draft);
    await q.query(
      'UPDATE marketplace_policies SET approved=approved || $1::jsonb,updated_at=now() WHERE id=1',
      [
        JSON.stringify({
          stock_stale_days: v.stock_stale_days,
          stock_reminder_days: v.stock_reminder_days,
        }),
      ],
    );
    await audit(q, u.id, 'policies.stock_approve', '1', d);
    return { ok: true };
  }
  async function archive(q: Query, u: any, i: RequestInput) {
    const d = z.object({ archived: z.boolean() }).parse(i.body);
    const [l] = await q.query('SELECT * FROM listings WHERE id=$1 AND seller_id=$2 FOR UPDATE', [
      i.params.id,
      u.id,
    ]);
    ensure(l, 404, 'NOT_FOUND', 'Listing not found.');
    await q.query(
      "UPDATE listings SET archived_at=CASE WHEN $1 THEN now() ELSE NULL END,status='PAUSED' WHERE id=$2",
      [d.archived, l.id],
    );
    await audit(q, u.id, 'listing.archive', l.id, d);
    return { ok: true };
  }
  async function confirmStock(q: Query, u: any, i: RequestInput) {
    const [l] = await q.query(
      'UPDATE listings SET confirmed_at=now(),stock_reminded_at=NULL WHERE id=$1 AND seller_id=$2 AND archived_at IS NULL RETURNING id',
      [i.params.id, u.id],
    );
    ensure(l, 404, 'NOT_FOUND', 'Active catalogue entry not found.');
    await audit(q, u.id, 'listing.reconfirm', l.id);
    return { ok: true };
  }
  return {
    categories,
    saveCategory,
    policies,
    savePolicies,
    approveStockPolicy,
    archive,
    confirmStock,
  };
}
