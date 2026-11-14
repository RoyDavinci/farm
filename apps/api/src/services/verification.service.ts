import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { storage } from '../lib/storage.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
export const kinds = [
  'government_id',
  'business_registration',
  'proof_of_address',
  'drivers_licence',
  'vehicle_registration',
  'other',
] as const;
export const subjects = ['seller', 'driver'] as const;

/** Validates an upload as a real PDF or image; images are re-encoded to strip metadata. */
export async function normalizeDocument(file: Express.Multer.File) {
  if (file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-')
    return { bytes: file.buffer, mime: 'application/pdf', ext: 'pdf' };
  const metadata = await sharp(file.buffer, { limitInputPixels: 30000000 })
    .metadata()
    .catch(() => null);
  ensure(
    metadata && ['jpeg', 'png', 'webp'].includes(metadata.format || ''),
    400,
    'INVALID_DOCUMENT',
    'Attach a JPEG, PNG, WebP or PDF file.',
  );
  const bytes = await sharp(file.buffer)
    .rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return { bytes, mime: 'image/webp', ext: 'webp' };
}

export function signedLink(c: Config, id: string) {
  const expires = Date.now() + 60000;
  const sig = createHmac('sha256', c.otpSecret).update(`doc:${id}:${expires}`).digest('hex');
  return `${c.publicApiUrl.replace(/\/$/, '')}/files/seller-documents/${id}?expires=${expires}&sig=${sig}`;
}

/** Short-lived signed download links for locally stored documents (admins only obtain them). */

/** Business logic for verification requests. HTTP-free: callers pass plain input. */
export function createVerificationService(deps: AppDeps) {
  const { db, config: c } = deps;
  const store = storage(c);
  const fields = (doc: any) => {
    const { storage_key, storage_provider, ...rest } = doc;
    return rest;
  };
  async function link(doc: any) {
    if (doc.storage_provider === 's3')
      return (await store.read(doc.storage_key, 's3', true)).url as string;
    return signedLink(c, doc.id);
  }
  async function listMyDocuments(user: any, input: RequestInput) {
    const subject = z.enum(subjects).default('seller').parse(input.query.subject);
    const docs = await db.query(
      'SELECT * FROM seller_documents WHERE seller_id=$1 AND subject=$2 ORDER BY created_at DESC',
      [user.id, subject],
    );
    return docs.map(fields);
  }
  async function listDocuments(user: any, input: RequestInput) {
    const { seller_id, subject } = z
      .object({ seller_id: z.string().min(1).max(64), subject: z.enum(subjects).default('seller') })
      .parse(input.query);
    const docs = await db.query(
      'SELECT d.*,u.name AS reviewer_name FROM seller_documents d LEFT JOIN users u ON u.id=d.reviewed_by WHERE d.seller_id=$1 AND d.subject=$2 ORDER BY d.created_at DESC',
      [seller_id, subject],
    );
    return docs.map(fields);
  }
  async function getDocumentLink(user: any, input: RequestInput) {
    const [doc] = await db.query('SELECT * FROM seller_documents WHERE id=$1', [input.params.id]);
    ensure(doc, 404, 'NOT_FOUND', 'Document not found.');
    await audit(db, user.id, 'seller_document.view', doc.id);
    return { url: await link(doc) };
  }
  async function reviewDocument(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        status: z.enum(['ACCEPTED', 'REJECTED']),
        note: z.string().trim().min(3).max(500),
      })
      .parse(input.body);
    const [doc] = await q.query(
      'UPDATE seller_documents SET status=$1,review_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING *',
      [d.status, d.note, u.id, input.params.id],
    );
    ensure(doc, 404, 'NOT_FOUND', 'Document not found.');
    await audit(q, u.id, 'seller_document.review', doc.id, d);
    if (d.status === 'REJECTED')
      await notify(
        q,
        doc.seller_id,
        'verification',
        'Verification document needs attention',
        `${d.note} Please upload a clearer or updated document.`,
      );
    return fields(doc);
  }
  /** Validates and privately stores a seller or driver verification document. */
  async function uploadDocument(user: any, input: RequestInput) {
    const kind = z.enum(kinds).parse(input.body?.kind);
    const subject = z
      .enum(subjects)
      .default('seller')
      .parse(input.body?.subject || undefined);
    const [profile] = await db.query(
      `SELECT status FROM ${subject === 'driver' ? 'drivers' : 'sellers'} WHERE user_id=$1`,
      [user.id],
    );
    ensure(
      profile,
      403,
      subject === 'driver' ? 'DRIVER_REQUIRED' : 'SELLER_REQUIRED',
      `Submit your ${subject} application first.`,
    );
    ensure(input.file, 400, 'FILE_REQUIRED', 'Attach a photo or PDF under 8 MB.');
    const u = user;
    const [count] = await db.query(
      "SELECT COUNT(*)::int AS n FROM seller_documents WHERE seller_id=$1 AND subject=$2 AND status<>'REJECTED'",
      [u.id, subject],
    );
    ensure(count.n < 10, 400, 'DOCUMENT_LIMIT', 'Remove a rejected document before adding more.');
    const { bytes, mime, ext } = await normalizeDocument(input.file);
    const id = randomUUID(),
      key = `seller-documents/${u.id}/${id}.${ext}`;
    await store.put(key, bytes, mime, true);
    try {
      await db.transaction(async (q) => {
        await q.query(
          'INSERT INTO seller_documents(id,seller_id,kind,filename,mime_type,storage_provider,storage_key,subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            u.id,
            kind,
            `${kind}-${id.slice(0, 8)}.${ext}`,
            mime,
            store.provider(true),
            key,
            subject,
          ],
        );
        await audit(q, u.id, 'seller_document.upload', id, { kind, subject });
      });
    } catch (e) {
      await store.remove(key, true).catch(() => {});
      throw e;
    }
    return { id, kind, subject, status: 'PENDING' as const };
  }
  return { listMyDocuments, listDocuments, getDocumentLink, reviewDocument, uploadDocument };
}

/** Business logic for publicdocument requests. HTTP-free: callers pass plain input. */
export function createPublicDocumentService(deps: AppDeps) {
  const { db, config: c } = deps;
  const store = storage(c);
  /** Verifies a short-lived signed link and returns the locally stored document. */
  async function readSignedDocument(input: RequestInput) {
    const d = z
      .object({ expires: z.coerce.number().int(), sig: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(input.query);
    ensure(
      d.expires > Date.now() && d.expires <= Date.now() + 60000,
      403,
      'LINK_EXPIRED',
      'This link has expired. Open the document again from the console.',
    );
    const expected = Buffer.from(
        createHmac('sha256', c.otpSecret)
          .update(`doc:${input.params.id}:${d.expires}`)
          .digest('hex'),
      ),
      actual = Buffer.from(d.sig);
    ensure(
      expected.length === actual.length && timingSafeEqual(expected, actual),
      403,
      'INVALID_LINK',
      'Invalid document link.',
    );
    const [doc] = await db.query('SELECT * FROM seller_documents WHERE id=$1', [input.params.id]);
    ensure(doc && doc.storage_provider === 'local', 404, 'NOT_FOUND', 'Document not found.');
    const data = await store.read(doc.storage_key, 'local', true);
    return {
      filename: doc.filename as string,
      mimeType: doc.mime_type as string,
      buffer: data.buffer!,
    };
  }
  return { readSignedDocument };
}
