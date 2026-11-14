import type { RequestHandler } from 'express';
import multer from 'multer';
import { requestInput } from '../lib/http.js';
import { createMediaService, createPublicMediaService } from '../services/media.service.js';
import type { AppDeps } from '../types/deps.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

export function createMediaController(deps: AppDeps) {
  const service = createMediaService(deps);
  const uploadPhoto: RequestHandler[] = [
    upload.single('image'),
    async (req, res) => {
      res.status(201).json(await service.uploadPhoto(res.locals.user, requestInput(req)));
    },
  ];
  return { uploadPhoto };
}

export function createPublicMediaController(deps: AppDeps) {
  const service = createPublicMediaService(deps);
  const servePhoto: RequestHandler = async (req, res) => {
    const photo = await service.findPhoto(String(req.params.file));
    res.setHeader('Cache-Control', 'public,max-age=300');
    res.type('image/webp');
    if ('path' in photo && photo.path) return res.sendFile(photo.path);
    if ('url' in photo && photo.url) return res.redirect(photo.url);
    res.send((photo as { buffer: Buffer }).buffer);
  };
  return { servePhoto };
}
