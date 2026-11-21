import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { getDisputeForUser } from './support.service.js';

export const caseMessageInput = z.object({ body: z.string().trim().min(2).max(4000) });
export const caseAssignInput = z.object({
  staff_id: z.string().max(64).nullable(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
});
export const caseNoteInput = z.object({
  body: z.string().trim().min(2).max(4000),
  /** Internal notes are for staff only; otherwise both parties see the update and are notified. */
  internal: z.boolean().default(true),
});

/** Records a timeline entry on a support case and bumps its activity time. */
export async function caseNote(
  q: Query,
  disputeId: string,
  author: string | null,
  kind: string,
  body: string,
) {
  await q.query(
    'INSERT INTO case_notes(id,dispute_id,author_id,kind,body) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), disputeId, author, kind, body],
  );
  await q.query('UPDATE disputes SET updated_at=now() WHERE id=$1', [disputeId]);
}

/** What was bought, from whom and how it was paid, frozen when the case opens. */
export async function caseSnapshot(q: Query, bookingId: string) {
  const [s] = await q.query(
    `SELECT b.id AS booking_id,b.title,b.variant_name,b.unit,b.quantity,b.price_kobo,b.total_kobo,b.status AS booking_status,
       b.paid,b.created_at AS ordered_at,b.listing_id,l.category,l.condition,s.user_id AS seller_id,s.business_name,s.business_type,
       s.city,s.area,s.verification_status,s.verification_details->>'legal_name' AS legal_name,
       (SELECT json_agg(f.provider_id) FROM funding f WHERE f.purpose='booking' AND f.target_id=b.id AND f.status='SUCCESSFUL') AS payment_references
     FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN sellers s ON s.user_id=b.seller_id WHERE b.id=$1`,
    [bookingId],
  );
  return s ?? {};
}

const PRIORITY: Record<string, string> = {
  PAYMENT_ISSUE: 'HIGH',
  DAMAGED: 'HIGH',
  WRONG_ITEM: 'NORMAL',
};
export const priorityFor = (reason: string) => PRIORITY[reason] || 'NORMAL';

/**
 * Complaint case management on support cases: a timeline the buyer and seller share, internal
 * staff notes, assignment and priority, and a snapshot of the order taken when the case opened.
 */
export function createCasesService(deps: AppDeps) {
  const { db } = deps;

  async function caseTimeline(user: any, input: RequestInput) {
    const d = await getDisputeForUser(db, input.params.id, user);
    const staff = !!user.admin;
    const notes = await db.query(
      `SELECT n.id,n.kind,n.body,n.created_at,n.author_id,u.name AS author_name,
         CASE WHEN n.author_id IS NULL THEN 'system' WHEN n.author_id=$2 THEN 'buyer' WHEN n.author_id=$3 THEN 'seller' ELSE 'staff' END AS author_role
       FROM case_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.dispute_id=$1 AND ($4 OR n.kind<>'INTERNAL') ORDER BY n.created_at`,
      [d.id, d.buyer_id, d.seller_id, staff],
    );
    const [assignee] = d.assigned_to
      ? await db.query('SELECT name FROM users WHERE id=$1', [d.assigned_to])
      : [];
    return {
      id: d.id,
      status: d.status,
      priority: d.priority,
      assigned_to: d.assigned_to,
      assigned_name: assignee?.name ?? null,
      snapshot: d.snapshot || {},
      // Staff names are shown to buyers and sellers as "Ahia support".
      notes: notes.map((x: any) => ({
        ...x,
        author_name: staff || x.author_role !== 'staff' ? x.author_name : 'Ahia support',
      })),
    };
  }

  async function sendCaseMessage(q: Query, user: any, input: RequestInput) {
    const d = caseMessageInput.parse(input.body);
    const c = await getDisputeForUser(q, input.params.id, user);
    ensure(
      c.buyer_id === user.id || c.seller_id === user.id,
      403,
      'FORBIDDEN',
      'Only the buyer and seller can reply here.',
    );
    ensure(
      c.status === 'OPEN',
      409,
      'CASE_CLOSED',
      'This case is closed. Open an appeal if you disagree with the outcome.',
    );
    await caseNote(q, c.id, user.id, 'MESSAGE', d.body);
    await notify(
      q,
      c.buyer_id === user.id ? c.seller_id : c.buyer_id,
      'dispute',
      'New reply on a support case',
      `${c.title}: ${d.body.slice(0, 140)}`,
      c.booking_id,
    );
    if (c.assigned_to)
      await notify(
        q,
        c.assigned_to,
        'dispute',
        'Reply on an assigned case',
        `${c.title}: ${d.body.slice(0, 140)}`,
      );
    return { ok: true };
  }

  async function caseQueue(user: any, input: RequestInput) {
    const d = z
      .object({ view: z.enum(['OPEN', 'MINE', 'UNASSIGNED', 'ALL']).default('OPEN') })
      .parse(input.query);
    return (
      await db.query(
        `SELECT d.id,d.booking_id,d.reason_code,d.description,d.status,d.priority,d.assigned_to,d.created_at,d.updated_at,d.resolution,
           d.refund_kobo,d.snapshot,b.title,b.total_kobo,b.status AS booking_status,ub.name AS buyer_name,s.business_name,
           a.name AS assigned_name,(SELECT COUNT(*)::int FROM case_notes n WHERE n.dispute_id=d.id) AS note_count,
           EXTRACT(EPOCH FROM now()-d.created_at)::int/3600 AS age_hours
         FROM disputes d JOIN bookings b ON b.id=d.booking_id JOIN users ub ON ub.id=b.buyer_id JOIN sellers s ON s.user_id=b.seller_id
         LEFT JOIN users a ON a.id=d.assigned_to
         WHERE ($1='ALL') OR (d.status='OPEN' AND ($1='OPEN' OR ($1='MINE' AND d.assigned_to=$2) OR ($1='UNASSIGNED' AND d.assigned_to IS NULL)))
         ORDER BY (d.status='OPEN') DESC,array_position(ARRAY['URGENT','HIGH','NORMAL','LOW'],d.priority),d.created_at LIMIT 200`,
        [d.view, user.id],
      )
    ).map((r: any) => ({ ...r, total_kobo: Number(r.total_kobo) }));
  }

  async function caseAssignees(_user: any, _input?: RequestInput) {
    return db.query(
      "SELECT id,name,staff_role FROM users WHERE admin AND staff_role IN ('owner','support','finance') AND status='ACTIVE' ORDER BY name",
    );
  }

  async function assignCase(q: Query, user: any, input: RequestInput) {
    const d = caseAssignInput.parse(input.body);
    const [c] = await q.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(c, 404, 'NOT_FOUND', 'Support case not found.');
    let name = 'nobody';
    if (d.staff_id) {
      const [s] = await q.query(
        "SELECT name FROM users WHERE id=$1 AND admin AND staff_role IN ('owner','support','finance')",
        [d.staff_id],
      );
      ensure(s, 400, 'NOT_STAFF', 'Choose a support, finance or owner staff member.');
      name = s.name;
    }
    await q.query('UPDATE disputes SET assigned_to=$1,priority=$2 WHERE id=$3', [
      d.staff_id,
      d.priority ?? c.priority,
      c.id,
    ]);
    await caseNote(
      q,
      c.id,
      user.id,
      'INTERNAL',
      `Assigned to ${name}${d.priority && d.priority !== c.priority ? `; priority ${d.priority.toLowerCase()}` : ''}.`,
    );
    await audit(q, user.id, 'dispute.assign', c.id, d);
    if (d.staff_id && d.staff_id !== user.id)
      await notify(
        q,
        d.staff_id,
        'dispute',
        'Case assigned to you',
        `A support case was assigned to you.`,
      );
    return { ok: true };
  }

  async function addCaseNote(q: Query, user: any, input: RequestInput) {
    const d = caseNoteInput.parse(input.body);
    const [c] = await q.query(
      'SELECT d.*,b.buyer_id,b.seller_id,b.title FROM disputes d JOIN bookings b ON b.id=d.booking_id WHERE d.id=$1',
      [input.params.id],
    );
    ensure(c, 404, 'NOT_FOUND', 'Support case not found.');
    await caseNote(q, c.id, user.id, d.internal ? 'INTERNAL' : 'UPDATE', d.body);
    if (!d.internal)
      for (const party of [c.buyer_id, c.seller_id])
        await notify(
          q,
          party,
          'dispute',
          'Update on your support case',
          `${c.title}: ${d.body.slice(0, 160)}`,
          c.booking_id,
        );
    await audit(q, user.id, d.internal ? 'dispute.note' : 'dispute.update', c.id);
    return { ok: true };
  }

  return { caseTimeline, sendCaseMessage, caseQueue, caseAssignees, assignCase, addCaseNote };
}
