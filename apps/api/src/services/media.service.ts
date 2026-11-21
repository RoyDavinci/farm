import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { storage } from '../lib/storage.js';
import type { AppDeps } from '../types/deps.js';

/** Listing photos: validated, re-encoded to WebP (metadata stripped) with a thumbnail. */
export function createMediaService(deps: AppDeps) {
  const { db, config: c } = deps;
  const store = storage(c);
  async function uploadPhoto(user: any, input: RequestInput) {
    const uid = user.id;
    const [seller] = await db.query(
      "SELECT user_id FROM sellers WHERE user_id=$1 AND status='APPROVED'",
      [uid],
    );
    ensure(seller, 403, 'SELLER_NOT_APPROVED', 'Approved sellers can upload product photos.');
    ensure(input.file, 400, 'IMAGE_REQUIRED', 'Choose a JPEG, PNG or WebP image under 5 MB.');
    const [count] = await db.query('SELECT COUNT(*)::int AS n FROM media WHERE owner_id=$1', [uid]);
    ensure(
      count.n < 500,
      400,
      'MEDIA_LIMIT',
      'Photo storage limit reached. Please contact support.',
    );
    const metadata = await sharp(input.file.buffer, { limitInputPixels: 40000000 })
      .metadata()
      .catch(() => {
        throw new AppError(
          400,
          'INVALID_IMAGE',
          'This photo could not be decoded. Choose another JPEG, PNG or WebP image.',
        );
      });
    ensure(
      ['jpeg', 'png', 'webp'].includes(metadata.format || ''),
      400,
      'INVALID_IMAGE',
      'This file is not a supported photo.',
    );
    const key = randomUUID();
    const full = await sharp(input.file.buffer, { limitInputPixels: 40000000 })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const thumb = await sharp(full)
      .resize(400, 400, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    const filename = `${key}.webp`,
      thumbnail = `${key}-thumb.webp`;
    const storageKey = `listings/${uid}/${filename}`,
      thumbnailKey = `listings/${uid}/${thumbnail}`;
    await store.put(storageKey, full, 'image/webp');
    try {
      await store.put(thumbnailKey, thumb, 'image/webp');
    } catch (e) {
      await store.remove(storageKey).catch(() => {});
      throw e;
    }
    const root = c.publicApiUrl.replace(/\/$/, '');
    const url = `${root}/media/${filename}`,
      thumbnail_url = `${root}/media/${thumbnail}`;
    try {
      await db.query(
        'INSERT INTO media(id,owner_id,url,thumbnail_url,storage_provider,storage_key,thumbnail_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [key, uid, url, thumbnail_url, store.provider(), storageKey, thumbnailKey],
      );
    } catch (e) {
      await Promise.allSettled([store.remove(storageKey), store.remove(thumbnailKey)]);
      throw e;
    }
    return { id: key, url, thumbnail_url };
  }
  return { uploadPhoto };
}

/** Serves public listing photos by file name (`<id>.webp` or `<id>-thumb.webp`). */
export function createPublicMediaService(deps: AppDeps) {
  const { db, config: c } = deps;
  const store = storage(c);
  /** Returns a local file path, a signed URL (S3) or bytes for the requested photo. */
  async function findPhoto(file: string) {
    const match = /^([a-f0-9-]{36})(-thumb)?\.(webp|mp4)$/.exec(file);
    ensure(match, 404, 'NOT_FOUND', 'Photo not found.');
    const media = await db.prisma.media.findUnique({ where: { id: match[1] } });
    ensure(media, 404, 'NOT_FOUND', 'Photo not found.');
    ensure(
      match[2] ? match[3] === 'webp' : match[3] === (media.media_type === 'VIDEO' ? 'mp4' : 'webp'),
      404,
      'NOT_FOUND',
      'Media not found.',
    );
    const mimeType = !match[2] && media.media_type === 'VIDEO' ? 'video/mp4' : 'image/webp';
    const key = match[2] ? media.thumbnail_key : media.storage_key;
    // Photos uploaded before storage keys existed live directly in the upload folder.
    if (!key) return { path: resolve(c.uploadDir, file), mimeType };
    if (media.storage_provider === 'local')
      return { path: resolve(c.uploadDir, 'public', key), mimeType };
    return { ...(await store.read(key, media.storage_provider)), mimeType };
  }
  return { findPhoto };
}
