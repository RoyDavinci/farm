import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { storage } from '../lib/storage.js';
import type { AppDeps } from '../types/deps.js';
import type { ResolveDisputeInput } from '../validators/support.validators.js';
import { audit } from './audit.service.js';
import type { AuthenticatedUser } from './auth.service.js';
import { release } from './booking.service.js';
import { notify } from './communications.service.js';
import { ledger, lockedBalance } from './ledger.service.js';
export async function getDisputeForUser(q: Query, disputeId: string, u: AuthenticatedUser) {
  const [d] = await q.query(
    'SELECT d.*,b.buyer_id,b.seller_id,b.title FROM disputes d JOIN bookings b ON b.id=d.booking_id WHERE d.id=$1',
    [disputeId],
  );
  ensure(
    d && (u.admin || d.buyer_id === u.id || d.seller_id === u.id),
    404,
    'NOT_FOUND',
    'Support case not found.',
  );
  return d;
}

export async function resolveSupportCase(
  q: Query,
  u: AuthenticatedUser,
  disputeId: string,
  data: ResolveDisputeInput,
) {
  const lookup = await getDisputeForUser(q, disputeId, u);
  const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [lookup.booking_id]);
  const [d] = await q.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [lookup.id]);
  ensure(d.status === 'OPEN', 409, 'CASE_CLOSED', 'This case is already resolved.');
  const [returnInProgress] = await q.query(
    "SELECT id FROM return_journeys WHERE dispute_id=$1 AND status IN ('ASSIGNED','ACCEPTED','PICKED_UP')",
    [d.id],
  );
  ensure(
    !returnInProgress,
    409,
    'RETURN_TRANSPORT_ACTIVE',
    'Complete or cancel the arranged return journey before closing this case.',
  );
  ensure(
    data.refund_kobo <= b.total_kobo && (!data.refund_kobo || b.paid),
    400,
    'INVALID_REFUND',
    'Refund exceeds the paid order amount.',
  );
  ensure(
    d.return_status !== 'REQUIRED',
    409,
    'RETURN_REQUIRED',
    'The seller must confirm receipt of the return first.',
  );
  ensure(
    !data.restock ||
      (b.status === 'COMPLETED' &&
        d.return_status === 'RECEIVED' &&
        data.refund_kobo === b.total_kobo),
    400,
    'RESTOCK_NOT_ALLOWED',
    'Only fully refunded, confirmed returned goods can be restocked.',
  );
  if (data.refund_kobo) {
    if (b.status === 'COMPLETED') {
      const fee = Math.round((data.refund_kobo * b.commission_kobo) / b.total_kobo),
        sellerDebit = data.refund_kobo - fee;
      ensure(
        (await lockedBalance(q, b.seller_id, 'seller_payable')) >= sellerDebit,
        409,
        'SELLER_FUNDS_REQUIRED',
        'Seller payable balance is insufficient. Escalate this case before refunding.',
      );
      await ledger(q, d.id, [
        { account: 'seller_payable', owner: b.seller_id, amount: -sellerDebit },
        { account: 'platform_revenue', amount: -fee },
        { account: 'wallet', owner: b.buyer_id, amount: data.refund_kobo },
      ]);
      if (data.restock && d.return_status === 'RECEIVED' && data.refund_kobo === b.total_kobo) {
        await q.query('SELECT id FROM listings WHERE id=$1 FOR UPDATE', [b.listing_id]);
        await q.query('UPDATE listing_variants SET stock=stock+$1 WHERE id=$2', [
          b.quantity,
          b.variant_id,
        ]);
        await q.query(
          'UPDATE listings SET stock=v.stock FROM listing_variants v WHERE v.listing_id=listings.id AND v.is_primary AND listings.id=$1',
          [b.listing_id],
        );
      }
    } else {
      ensure(
        data.refund_kobo === b.total_kobo,
        400,
        'FULL_REFUND_REQUIRED',
        'An uncollected order can only be fully refunded or left unchanged.',
      );
      await release(q, b, 'CANCELLED', u.id, 'Support approved a full refund.');
    }
  }
  if (!data.refund_kobo && ['ACCEPTED', 'READY_FOR_PICKUP'].includes(b.status))
    await q.query('UPDATE bookings SET reserved_until=$1 WHERE id=$2', [
      new Date(Date.now() + Number(d.reservation_remaining_ms || 168 * 3600000)),
      b.id,
    ]);
  await q.query(
    "UPDATE disputes SET status='RESOLVED',resolution=$1,refund_kobo=$2,resolved_at=now() WHERE id=$3",
    [data.resolution, data.refund_kobo, d.id],
  );
  await audit(q, u.id, 'dispute.resolve', d.id, data);
  for (const uid of [b.buyer_id, b.seller_id])
    await notify(q, uid, 'dispute', 'Support case resolved', data.resolution, b.id);
  return { ok: true };
}

/** Business logic for support requests. HTTP-free: callers pass plain input. */
export function createSupportService(deps: AppDeps) {
  const { db, config: c } = deps;
  const store = storage(c);
  async function listDisputes(user: any, input: RequestInput) {
    return await db.query(
      'SELECT d.*,b.title,b.buyer_id,b.seller_id FROM disputes d JOIN bookings b ON b.id=d.booking_id WHERE b.buyer_id=$1 OR b.seller_id=$1 ORDER BY d.created_at DESC LIMIT 100',
      [user.id],
    );
  }
  async function getBookingDispute(user: any, input: RequestInput) {
    const [b] = await db.query('SELECT id,buyer_id,seller_id FROM bookings WHERE id=$1', [
      input.params.id,
    ]);
    const u = user;
    ensure(
      b && (u.admin || b.buyer_id === u.id || b.seller_id === u.id),
      404,
      'NOT_FOUND',
      'Booking not found.',
    );
    const [d] = await db.query('SELECT id,status FROM disputes WHERE booking_id=$1', [b.id]);
    return d || null;
  }
  async function openDispute(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        reason_code: z.enum([
          'WRONG_ITEM',
          'DAMAGED',
          'MISSING',
          'POOR_QUALITY',
          'NOT_AVAILABLE',
          'NO_SHOW',
          'PAYMENT_ISSUE',
          'OTHER',
        ]),
        description: z.string().trim().min(10).max(4000),
      })
      .parse(input.body);
    const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [input.params.id]);
    ensure(
      b && (b.buyer_id === u.id || b.seller_id === u.id),
      404,
      'NOT_FOUND',
      'Booking not found.',
    );
    ensure(
      ['ACCEPTED', 'READY_FOR_PICKUP', 'COMPLETED'].includes(b.status),
      409,
      'DISPUTE_NOT_AVAILABLE',
      'You can open a case for an accepted or completed booking.',
    );
    const [existing] = await q.query('SELECT id FROM disputes WHERE booking_id=$1', [b.id]);
    ensure(!existing, 409, 'CASE_EXISTS', 'A support case already exists for this booking.');
    const remaining =
      b.status === 'COMPLETED'
        ? null
        : Math.max(0, new Date(b.reserved_until).getTime() - Date.now());
    ensure(
      remaining === null || remaining > 0,
      409,
      'RESERVATION_EXPIRED',
      'This reservation has expired.',
    );
    const [record] = await q.query(
      'INSERT INTO disputes(id,booking_id,opened_by,reason_code,description) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [randomUUID(), b.id, u.id, d.reason_code, d.description],
    );
    await q.query('UPDATE disputes SET reservation_remaining_ms=$1 WHERE id=$2', [
      remaining,
      record.id,
    ]);
    await audit(q, u.id, 'dispute.open', record.id);
    await notify(
      q,
      b.buyer_id === u.id ? b.seller_id : b.buyer_id,
      'dispute',
      'Support case opened',
      `A support case was opened for ${b.title}.`,
      b.id,
    );
    return record;
  }
  async function getDispute(user: any, input: RequestInput) {
    const d = await getDisputeForUser(db, input.params.id as string, user);
    const evidence = await db.query(
      'SELECT id,filename,mime_type,owner_id,created_at FROM dispute_evidence WHERE dispute_id=$1 ORDER BY created_at',
      [d.id],
    );
    return { ...d, evidence };
  }
  async function getEvidenceLink(user: any, input: RequestInput) {
    const [file] = await db.query('SELECT * FROM dispute_evidence WHERE id=$1', [input.params.id]);
    ensure(file, 404, 'NOT_FOUND', 'Attachment not found.');
    await getDisputeForUser(db, file.dispute_id, user);
    if (file.storage_provider === 's3') {
      const data = await store.read(file.storage_key, 's3', true);
      return { url: data.url };
    }
    const expires = Date.now() + 60000,
      sig = createHmac('sha256', c.otpSecret).update(`${file.id}:${expires}`).digest('hex');
    return {
      url: `${c.publicApiUrl.replace(/\/$/, '')}/files/evidence/${file.id}?expires=${expires}&sig=${sig}`,
    };
  }
  async function updateReturn(q: Query, u: any, input: RequestInput) {
    const d = await getDisputeForUser(q, input.params.id as string, u);
    const { action } = z.object({ action: z.enum(['request', 'received']) }).parse(input.body);
    const [locked] = await q.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [d.id]);
    Object.assign(d, locked);
    if (action === 'received') {
      const [moving] = await q.query(
        "SELECT id FROM return_journeys WHERE dispute_id=$1 AND status IN ('ASSIGNED','ACCEPTED','PICKED_UP')",
        [d.id],
      );
      ensure(
        !moving,
        409,
        'RETURN_TRANSPORT_ACTIVE',
        'Use the arranged return PIN confirmation, or cancel the uncollected journey first.',
      );
    }
    ensure(d.status === 'OPEN', 409, 'CASE_CLOSED', 'Case is closed.');
    if (action === 'request') ensure(u.admin, 403, 'FORBIDDEN', 'Support must approve a return.');
    else
      ensure(
        u.admin || u.id === d.seller_id,
        403,
        'FORBIDDEN',
        'Only the seller or support can acknowledge a return.',
      );
    ensure(
      action === 'request' ? d.return_status === 'NONE' : d.return_status === 'REQUIRED',
      409,
      'INVALID_RETURN',
      'Return status cannot be changed this way.',
    );
    await q.query('UPDATE disputes SET return_status=$1 WHERE id=$2', [
      action === 'request' ? 'REQUIRED' : 'RECEIVED',
      d.id,
    ]);
    await audit(q, u.id, `return.${action}`, d.id);
    return { ok: true };
  }
  async function listAllDisputes(user: any, input: RequestInput) {
    ensure(user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return await db.query(
      'SELECT d.*,b.title,b.total_kobo,b.status AS booking_status FROM disputes d JOIN bookings b ON b.id=d.booking_id ORDER BY d.created_at DESC LIMIT 100',
    );
  }
  async function getReceipt(user: any, input: RequestInput) {
    const [b] = await db.query(
      'SELECT b.*,s.business_name FROM bookings b JOIN sellers s ON s.user_id=b.seller_id WHERE b.id=$1',
      [input.params.id],
    );
    const u = user;
    ensure(
      b && (u.admin || u.id === b.buyer_id || u.id === b.seller_id),
      404,
      'NOT_FOUND',
      'Receipt not found.',
    );
    ensure(
      b.paid ||
        b.status === 'COMPLETED' ||
        (
          await db.query(
            "SELECT 1 FROM ledger WHERE account='escrow' AND owner_id=$1 AND amount_kobo>0 LIMIT 1",
            [b.id],
          )
        ).length > 0,
      409,
      'PAYMENT_REQUIRED',
      'A receipt is available after payment.',
    );
    const [d] = await db.query('SELECT refund_kobo FROM disputes WHERE booking_id=$1', [b.id]);
    const [automatic] = await db.query(
      "SELECT COALESCE(SUM(amount_kobo),0) AS total FROM ledger WHERE reference=$1 AND account='wallet' AND amount_kobo>0",
      [b.id],
    );
    return {
      receipt_number: `FM-${b.id}`,
      booking_id: b.id,
      seller: b.business_name,
      title: b.title,
      variant: b.variant_name,
      quantity: b.quantity,
      unit: b.unit,
      unit_price_kobo: b.price_kobo,
      total_kobo: b.total_kobo,
      currency: 'NGN',
      commission_kobo: b.commission_kobo,
      payment_method: 'wallet',
      status: b.status,
      refunded_kobo: Math.max(d?.refund_kobo || 0, Number(automatic.total)),
      created_at: b.created_at,
      simulated: c.demo,
    };
  }
  /** Confirms the case is open and visible to this user before any upload is read. */
  async function openCaseForEvidence(user: any, input: RequestInput) {
    const d = await getDisputeForUser(db, input.params.id as string, user);
    ensure(d.status === 'OPEN', 409, 'CASE_CLOSED', 'Evidence can only be added to an open case.');
    return d;
  }
  /** Validates, normalises and privately stores one evidence file. */
  async function addEvidence(user: any, input: RequestInput, d: { id: string }) {
    ensure(input.file, 400, 'FILE_REQUIRED', 'Attach a photo or PDF under 5 MB.');
    const [count] = await db.query(
      'SELECT COUNT(*)::int AS n FROM dispute_evidence WHERE dispute_id=$1',
      [d.id],
    );
    ensure(count.n < 10, 400, 'EVIDENCE_LIMIT', 'This case already has ten attachments.');
    let bytes = input.file.buffer,
      mime = 'application/pdf',
      ext = 'pdf';
    if (!(
      input.file.mimetype === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-'
    )) {
      const metadata = await sharp(bytes, { limitInputPixels: 30000000 })
        .metadata()
        .catch(() => null);
      ensure(
        metadata && ['jpeg', 'png', 'webp'].includes(metadata.format || ''),
        400,
        'INVALID_EVIDENCE',
        'Attach a JPEG, PNG, WebP or PDF file.',
      );
      bytes = await sharp(bytes)
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      mime = 'image/webp';
      ext = 'webp';
    }
    const eid = randomUUID(),
      key = `evidence/${d.id}/${eid}.${ext}`;
    await store.put(key, bytes, mime, true);
    try {
      await db.transaction(async (q) => {
        await q.query('SELECT id FROM disputes WHERE id=$1 FOR UPDATE', [d.id]);
        const [count] = await q.query(
          'SELECT COUNT(*)::int AS n FROM dispute_evidence WHERE dispute_id=$1',
          [d.id],
        );
        ensure(count.n < 10, 400, 'EVIDENCE_LIMIT', 'This case already has ten attachments.');
        const current = await getDisputeForUser(q, d.id, user);
        ensure(current.status === 'OPEN', 409, 'CASE_CLOSED', 'This case was just closed.');
        await q.query(
          'INSERT INTO dispute_evidence(id,dispute_id,owner_id,filename,mime_type,storage_provider,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            eid,
            d.id,
            user.id,
            `evidence-${eid.slice(0, 8)}.${ext}`,
            mime,
            store.provider(true),
            key,
          ],
        );
        await audit(q, user.id, 'dispute.evidence', d.id);
      });
    } catch (e) {
      await store.remove(key, true).catch(() => {});
      throw e;
    }
    return { id: eid };
  }
  /** Returns an evidence file (bytes, or a signed URL for S3) if the user may see the case. */
  async function readEvidence(user: any, input: RequestInput) {
    const [file] = await db.query('SELECT * FROM dispute_evidence WHERE id=$1', [input.params.id]);
    ensure(file, 404, 'NOT_FOUND', 'Attachment not found.');
    await getDisputeForUser(db, file.dispute_id, user);
    const data = await store.read(file.storage_key, file.storage_provider, true);
    return { filename: file.filename as string, mimeType: file.mime_type as string, ...data };
  }
  return {
    listDisputes,
    getBookingDispute,
    openDispute,
    getDispute,
    getEvidenceLink,
    updateReturn,
    listAllDisputes,
    getReceipt,
    openCaseForEvidence,
    addEvidence,
    readEvidence,
  };
}

/** Business logic for publicevidence requests. HTTP-free: callers pass plain input. */
export function createPublicEvidenceService(deps: AppDeps) {
  const { db, config: c } = deps;
  const store = storage(c);
  /** Verifies a short-lived signed link and returns the locally stored evidence file. */
  async function readSignedEvidence(input: RequestInput) {
    const d = z
      .object({ expires: z.coerce.number().int(), sig: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(input.query);
    ensure(
      d.expires > Date.now() && d.expires <= Date.now() + 60000,
      403,
      'LINK_EXPIRED',
      'This attachment link has expired. Open a new link from the app.',
    );
    const expected = Buffer.from(
        createHmac('sha256', c.otpSecret).update(`${input.params.id}:${d.expires}`).digest('hex'),
      ),
      actual = Buffer.from(d.sig);
    ensure(
      expected.length === actual.length && timingSafeEqual(expected, actual),
      403,
      'INVALID_LINK',
      'Invalid attachment link.',
    );
    const [file] = await db.query('SELECT * FROM dispute_evidence WHERE id=$1', [input.params.id]);
    ensure(file && file.storage_provider === 'local', 404, 'NOT_FOUND', 'Attachment not found.');
    const data = await store.read(file.storage_key, file.storage_provider, true);
    return {
      filename: file.filename as string,
      mimeType: file.mime_type as string,
      buffer: data.buffer!,
    };
  }
  return { readSignedEvidence };
}
