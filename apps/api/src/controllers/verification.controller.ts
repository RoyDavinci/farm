import type { RequestHandler } from 'express';
import multer from 'multer';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { requestInput } from '../lib/http.js';
import { storage } from '../lib/storage.js';
import { audit } from '../services/audit.service.js';
import {
  createPublicDocumentService,
  createVerificationService,
  kinds,
  normalizeDocument,
  signedLink,
  subjects,
} from '../services/verification.service.js';
import type { AppDeps } from '../types/deps.js';

export function createVerificationController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;
  const service = createVerificationService(deps);
  const store = storage(c);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  const fields = (doc: any) => {
    const { storage_key, storage_provider, ...rest } = doc;
    return rest;
  };
  async function link(doc: any) {
    if (doc.storage_provider === 's3')
      return (await store.read(doc.storage_key, 's3', true)).url as string;
    return signedLink(c, doc.id);
  }
  const listMyDocuments: RequestHandler = async (req, res) => {
    res.json(await service.listMyDocuments(res.locals.user, requestInput(req)));
  };
  const uploadDocument: RequestHandler[] = [
    upload.single('file'),
    async (req, res) => {
      const kind = z.enum(kinds).parse(req.body?.kind);
      const subject = z
        .enum(subjects)
        .default('seller')
        .parse(req.body?.subject || undefined);
      const [profile] = await db.query(
        `SELECT status FROM ${subject === 'driver' ? 'drivers' : 'sellers'} WHERE user_id=$1`,
        [res.locals.user.id],
      );
      ensure(
        profile,
        403,
        subject === 'driver' ? 'DRIVER_REQUIRED' : 'SELLER_REQUIRED',
        `Submit your ${subject} application first.`,
      );
      ensure(req.file, 400, 'FILE_REQUIRED', 'Attach a photo or PDF under 8 MB.');
      const u = res.locals.user;
      const [count] = await db.query(
        "SELECT COUNT(*)::int AS n FROM seller_documents WHERE seller_id=$1 AND subject=$2 AND status<>'REJECTED'",
        [u.id, subject],
      );
      ensure(count.n < 10, 400, 'DOCUMENT_LIMIT', 'Remove a rejected document before adding more.');
      const { bytes, mime, ext } = await normalizeDocument(req.file);
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
      res.status(201).json({ id, kind, subject, status: 'PENDING' });
    },
  ];
  const listDocuments: RequestHandler = async (req, res) => {
    res.json(await service.listDocuments(res.locals.user, requestInput(req)));
  };
  const getDocumentLink: RequestHandler = async (req, res) => {
    res.json(await service.getDocumentLink(res.locals.user, requestInput(req)));
  };
  const reviewDocument: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.reviewDocument(q, user, requestInput(req)));
  return { listMyDocuments, uploadDocument, listDocuments, getDocumentLink, reviewDocument };
}

export function createPublicDocumentController(deps: AppDeps) {
  const { db, config: c } = deps;
  const service = createPublicDocumentService(deps);
  const store = storage(c);
  const downloadDocument: RequestHandler = async (req, res) => {
    const d = z
      .object({ expires: z.coerce.number().int(), sig: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.query);
    ensure(
      d.expires > Date.now() && d.expires <= Date.now() + 60000,
      403,
      'LINK_EXPIRED',
      'This link has expired. Open the document again from the console.',
    );
    const expected = Buffer.from(
        createHmac('sha256', c.otpSecret).update(`doc:${req.params.id}:${d.expires}`).digest('hex'),
      ),
      actual = Buffer.from(d.sig);
    ensure(
      expected.length === actual.length && timingSafeEqual(expected, actual),
      403,
      'INVALID_LINK',
      'Invalid document link.',
    );
    const [doc] = await db.query('SELECT * FROM seller_documents WHERE id=$1', [req.params.id]);
    ensure(doc && doc.storage_provider === 'local', 404, 'NOT_FOUND', 'Document not found.');
    const data = await store.read(doc.storage_key, 'local', true);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.type(doc.mime_type).send(data.buffer);
  };
  return { downloadDocument };
}
