import multer from 'multer';
import { resolve } from 'node:path';
import { storage } from '../lib/storage.js';
import type { AppDeps } from '../types/deps.js';

/** Business logic for media requests. HTTP-free: callers pass plain input. */
export function createMediaService(deps: AppDeps) {
  const { config: c } = deps;
  const folder = resolve(c.uploadDir);
  const store = storage(c);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, cb) {
      cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
    },
  });
  return {};
}

/** Business logic for publicmedia requests. HTTP-free: callers pass plain input. */
export function createPublicMediaService(deps: AppDeps) {
  const { config: c } = deps;
  const store = storage(c);
  return {};
}
