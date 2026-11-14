import type { RequestHandler } from 'express';
import multer from 'multer';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import { audit } from '../services/audit.service.js';
import { getDisputeForUser, resolveSupportCase } from '../services/support.service.js';
import { resolveDisputeInput } from '../validators/support.validators.js';
import { notify } from '../services/communications.service.js';
import type { AppDeps } from '../types/deps.js';

export function createSupportController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;

  const store = storage(c);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  const listDisputes: RequestHandler = async (_req, res) =>
    res.json(
      await db.query(
        'SELECT d.*,b.title,b.buyer_id,b.seller_id FROM disputes d JOIN bookings b ON b.id=d.booking_id WHERE b.buyer_id=$1 OR b.seller_id=$1 ORDER BY d.created_at DESC LIMIT 100',
        [res.locals.user.id],
      ),
    );
  const getBookingDispute: RequestHandler = async (req, res) => {
    const [b] = await db.query('SELECT id,buyer_id,seller_id FROM bookings WHERE id=$1', [
      req.params.id,
    ]);
    const u = res.locals.user;
    ensure(
      b && (u.admin || b.buyer_id === u.id || b.seller_id === u.id),
      404,
      'NOT_FOUND',
      'Booking not found.',
    );
    const [d] = await db.query('SELECT id,status FROM disputes WHERE booking_id=$1', [b.id]);
    res.json(d || null);
  };
  const openDispute: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
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
        .parse(req.body);
      const [b] = await q.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [req.params.id]);
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
    });
  const getDispute: RequestHandler = async (req, res) => {
    const d = await getDisputeForUser(db, req.params.id as string, res.locals.user);
    const evidence = await db.query(
      'SELECT id,filename,mime_type,owner_id,created_at FROM dispute_evidence WHERE dispute_id=$1 ORDER BY created_at',
      [d.id],
    );
    res.json({ ...d, evidence });
  };
  const uploadEvidence: RequestHandler[] = [
    async (req, res, next) => {
      const d = await getDisputeForUser(db, req.params.id as string, res.locals.user);
      ensure(
        d.status === 'OPEN',
        409,
        'CASE_CLOSED',
        'Evidence can only be added to an open case.',
      );
      res.locals.dispute = d;
      next();
    },
    upload.single('file'),
    async (req, res) => {
      const d = res.locals.dispute;
      ensure(req.file, 400, 'FILE_REQUIRED', 'Attach a photo or PDF under 5 MB.');
      const [count] = await db.query(
        'SELECT COUNT(*)::int AS n FROM dispute_evidence WHERE dispute_id=$1',
        [d.id],
      );
      ensure(count.n < 10, 400, 'EVIDENCE_LIMIT', 'This case already has ten attachments.');
      let bytes = req.file.buffer,
        mime = 'application/pdf',
        ext = 'pdf';
      if (!(
        req.file.mimetype === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-'
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
          const current = await getDisputeForUser(q, d.id, res.locals.user);
          ensure(current.status === 'OPEN', 409, 'CASE_CLOSED', 'This case was just closed.');
          await q.query(
            'INSERT INTO dispute_evidence(id,dispute_id,owner_id,filename,mime_type,storage_provider,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              eid,
              d.id,
              res.locals.user.id,
              `evidence-${eid.slice(0, 8)}.${ext}`,
              mime,
              store.provider(true),
              key,
            ],
          );
          await audit(q, res.locals.user.id, 'dispute.evidence', d.id);
        });
      } catch (e) {
        await store.remove(key, true).catch(() => {});
        throw e;
      }
      res.status(201).json({ id: eid });
    },
  ];
  const getEvidenceLink: RequestHandler = async (req, res) => {
    const [file] = await db.query('SELECT * FROM dispute_evidence WHERE id=$1', [req.params.id]);
    ensure(file, 404, 'NOT_FOUND', 'Attachment not found.');
    await getDisputeForUser(db, file.dispute_id, res.locals.user);
    if (file.storage_provider === 's3') {
      const data = await store.read(file.storage_key, 's3', true);
      return res.json({ url: data.url });
    }
    const expires = Date.now() + 60000,
      sig = createHmac('sha256', c.otpSecret).update(`${file.id}:${expires}`).digest('hex');
    res.json({
      url: `${c.publicApiUrl.replace(/\/$/, '')}/files/evidence/${file.id}?expires=${expires}&sig=${sig}`,
    });
  };
  const downloadEvidence: RequestHandler = async (req, res) => {
    const [file] = await db.query('SELECT * FROM dispute_evidence WHERE id=$1', [req.params.id]);
    ensure(file, 404, 'NOT_FOUND', 'Attachment not found.');
    await getDisputeForUser(db, file.dispute_id, res.locals.user);
    const data = await store.read(file.storage_key, file.storage_provider, true);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.type(file.mime_type);
    if (data.url) return res.redirect(data.url);
    res.send(data.buffer);
  };
  const updateReturn: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = await getDisputeForUser(q, req.params.id as string, u);
      const { action } = z.object({ action: z.enum(['request', 'received']) }).parse(req.body);
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
    });
  const listAllDisputes: RequestHandler = async (_req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    res.json(
      await db.query(
        'SELECT d.*,b.title,b.total_kobo,b.status AS booking_status FROM disputes d JOIN bookings b ON b.id=d.booking_id ORDER BY d.created_at DESC LIMIT 100',
      ),
    );
  };
  const resolveDispute: RequestHandler = async (req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    const data = resolveDisputeInput.parse(req.body);
    return mutate(req, res, (q, u) => resolveSupportCase(q, u, req.params.id as string, data));
  };
  const getReceipt: RequestHandler = async (req, res) => {
    const [b] = await db.query(
      'SELECT b.*,s.business_name FROM bookings b JOIN sellers s ON s.user_id=b.seller_id WHERE b.id=$1',
      [req.params.id],
    );
    const u = res.locals.user;
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
    res.json({
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
    });
  };
  return {
    listDisputes,
    getBookingDispute,
    openDispute,
    getDispute,
    uploadEvidence,
    getEvidenceLink,
    downloadEvidence,
    updateReturn,
    listAllDisputes,
    resolveDispute,
    getReceipt,
  };
}

export function createPublicEvidenceController(deps: AppDeps) {
  const { db, config: c } = deps;

  const store = storage(c);
  const downloadEvidence: RequestHandler = async (req, res) => {
    const d = z
      .object({ expires: z.coerce.number().int(), sig: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.query);
    ensure(
      d.expires > Date.now() && d.expires <= Date.now() + 60000,
      403,
      'LINK_EXPIRED',
      'This attachment link has expired. Open a new link from the app.',
    );
    const expected = Buffer.from(
        createHmac('sha256', c.otpSecret).update(`${req.params.id}:${d.expires}`).digest('hex'),
      ),
      actual = Buffer.from(d.sig);
    ensure(
      expected.length === actual.length && timingSafeEqual(expected, actual),
      403,
      'INVALID_LINK',
      'Invalid attachment link.',
    );
    const [file] = await db.query('SELECT * FROM dispute_evidence WHERE id=$1', [req.params.id]);
    ensure(file && file.storage_provider === 'local', 404, 'NOT_FOUND', 'Attachment not found.');
    const data = await store.read(file.storage_key, file.storage_provider, true);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.type(file.mime_type).send(data.buffer);
  };
  return { downloadEvidence };
}
