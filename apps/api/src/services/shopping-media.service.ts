import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import type { AppDeps } from '../types/deps.js';
import type { RequestInput } from '../lib/http.js';
import { canAccess } from './staff.service.js';
import { audit } from './audit.service.js';

export function createShoppingMediaService({ db, config }: AppDeps) {
  const store = storage(config);
  const signature = (id: string, photo: string, expires: number) =>
    createHmac('sha256', config.otpSecret)
      .update(`shopping-receipt:${id}:${photo}:${expires}`)
      .digest('hex');
  async function authorize(user: any, id: string, writing = false) {
    const [row] = await db.query('SELECT * FROM shopping_requests WHERE id=$1', [id]);
    ensure(
      row &&
        (writing
          ? row.rider_id === user.id
          : [row.buyer_id, row.rider_id].includes(user.id) ||
            (user.admin && canAccess(user.staff_role, 'shopping'))),
      404,
      'NOT_FOUND',
      'Shopping request not found.',
    );
    if (writing)
      ensure(
        ['SHOPPING', 'PURCHASED'].includes(row.status) && !row.review_open,
        409,
        'RECEIPT_CLOSED',
        'Receipt photos can be added while shopping or delivering an unpaused request.',
      );
    return row;
  }
  async function photos(row: any) {
    return Promise.all(
      (row.receipt_photos || []).map(async (p: any) => {
        const expires = Date.now() + 60000;
        const url =
          p.provider === 's3'
            ? (await store.read(p.key, p.provider, true)).url
            : `${config.publicApiUrl.replace(/\/$/, '')}/files/shopping-receipts/${row.id}/${p.id}?expires=${expires}&sig=${signature(row.id, p.id, expires)}`;
        return { id: p.id, url, created_at: p.created_at };
      }),
    );
  }
  async function upload(user: any, input: RequestInput) {
    await authorize(user, input.params.id, true);
    ensure(input.file, 400, 'FILE_REQUIRED', 'Attach a receipt photo under 5 MB.');
    const metadata = await sharp(input.file.buffer, { limitInputPixels: 30000000 })
      .metadata()
      .catch(() => null);
    ensure(
      metadata && ['jpeg', 'png', 'webp'].includes(metadata.format || ''),
      400,
      'INVALID_PHOTO',
      'Choose a JPEG, PNG or WebP receipt photo.',
    );
    const bytes = await sharp(input.file.buffer, { limitInputPixels: 30000000 })
      .rotate()
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const id = randomUUID(),
      key = `shopping-receipts/${input.params.id}/${id}.webp`;
    await store.put(key, bytes, 'image/webp', true);
    try {
      await db.transaction(async (q) => {
        const [row] = await q.query('SELECT * FROM shopping_requests WHERE id=$1 FOR UPDATE', [
          input.params.id,
        ]);
        ensure(
          row &&
            row.rider_id === user.id &&
            ['SHOPPING', 'PURCHASED'].includes(row.status) &&
            !row.review_open,
          409,
          'RECEIPT_CLOSED',
          'This request no longer accepts receipt photos.',
        );
        ensure(
          row.receipt_photos.length < 6,
          409,
          'RECEIPT_LIMIT',
          'A request can have up to six receipt photos.',
        );
        await q.query(
          'UPDATE shopping_requests SET receipt_photos=receipt_photos || $1::jsonb,updated_at=now() WHERE id=$2',
          [
            JSON.stringify([
              { id, key, provider: store.provider(true), created_at: new Date().toISOString() },
            ]),
            row.id,
          ],
        );
        await audit(q, user.id, 'shopping.receipt', row.id, { photo_id: id });
      });
    } catch (e) {
      await store.remove(key, true).catch(() => {});
      throw e;
    }
    return { id };
  }
  async function readSigned(input: RequestInput) {
    const d = z
      .object({ expires: z.coerce.number().int(), sig: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(input.query);
    ensure(
      d.expires > Date.now() &&
        d.expires <= Date.now() + 60000 &&
        timingSafeEqual(
          Buffer.from(d.sig, 'hex'),
          Buffer.from(signature(input.params.id, input.params.photo, d.expires), 'hex'),
        ),
      403,
      'LINK_EXPIRED',
      'Receipt link expired. Reopen the request.',
    );
    const [row] = await db.query('SELECT receipt_photos FROM shopping_requests WHERE id=$1', [
      input.params.id,
    ]);
    const photo = row?.receipt_photos.find((p: any) => p.id === input.params.photo);
    ensure(photo, 404, 'NOT_FOUND', 'Receipt photo not found.');
    return store.read(photo.key, photo.provider, true);
  }
  return { authorize, photos, upload, readSigned };
}
