import type { RequestHandler } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { AppError, ensure } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import { createMediaService, createPublicMediaService } from '../services/media.service.js';
import type { AppDeps } from '../types/deps.js';

export function createMediaController(deps: AppDeps) {
  const { db, config: c } = deps;
  const service = createMediaService(deps);
  const folder = resolve(c.uploadDir);
  const store = storage(c);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, cb) {
      cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
    },
  });
  const uploadPhoto: RequestHandler[] = [
    upload.single('image'),
    async (req, res) => {
      const uid = res.locals.user.id;
      const [seller] = await db.query(
        "SELECT user_id FROM sellers WHERE user_id=$1 AND status='APPROVED'",
        [uid],
      );
      ensure(seller, 403, 'SELLER_NOT_APPROVED', 'Approved sellers can upload produce photos.');
      ensure(req.file, 400, 'IMAGE_REQUIRED', 'Choose a JPEG, PNG or WebP image under 5 MB.');
      const [count] = await db.query('SELECT COUNT(*)::int AS n FROM media WHERE owner_id=$1', [
        uid,
      ]);
      ensure(
        count.n < 500,
        400,
        'MEDIA_LIMIT',
        'Photo storage limit reached. Please contact support.',
      );
      const metadata = await sharp(req.file.buffer, { limitInputPixels: 40000000 })
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

      const full = await sharp(req.file.buffer, { limitInputPixels: 40000000 })
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
      try {
        await db.query(
          'INSERT INTO media(id,owner_id,url,thumbnail_url,storage_provider,storage_key,thumbnail_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            key,
            uid,
            `${root}/media/${filename}`,
            `${root}/media/${thumbnail}`,
            store.provider(),
            storageKey,
            thumbnailKey,
          ],
        );
      } catch (e) {
        await Promise.allSettled([store.remove(storageKey), store.remove(thumbnailKey)]);
        throw e;
      }
      res.status(201).json({
        id: key,
        url: `${root}/media/${filename}`,
        thumbnail_url: `${root}/media/${thumbnail}`,
      });
    },
  ];
  return { uploadPhoto };
}

export function createPublicMediaController(deps: AppDeps) {
  const { db, config: c } = deps;
  const service = createPublicMediaService(deps);
  const store = storage(c);
  const servePhoto: RequestHandler = async (req, res) => {
    const file = String(req.params.file);
    const match = /^([a-f0-9-]{36})(-thumb)?\.webp$/.exec(file);
    ensure(match, 404, 'NOT_FOUND', 'Photo not found.');
    const [media] = await db.query('SELECT * FROM media WHERE id=$1', [match[1]]);
    ensure(media, 404, 'NOT_FOUND', 'Photo not found.');
    const key = match[2] ? media.thumbnail_key : media.storage_key;
    res.setHeader('Cache-Control', 'public,max-age=300');
    res.type('image/webp');
    if (!key) return res.sendFile(resolve(c.uploadDir, file));
    const data = await store.read(key, media.storage_provider);
    if (data.url) return res.redirect(data.url);
    res.send(data.buffer);
  };
  return { servePhoto };
}
