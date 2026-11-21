import { createStatusVideoService } from '../services/status-video.service.js';
import { AppError, ensure } from '../lib/errors.js';
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

let processingVideos = 0;
export function createMediaController(deps: AppDeps) {
  const service = createMediaService(deps);
  const uploadPhoto: RequestHandler[] = [
    upload.single('image'),
    async (req, res) => {
      res.status(201).json(await service.uploadPhoto(res.locals.user, requestInput(req)));
    },
  ];
  const video = createStatusVideoService(deps);
  const uploadVideo: RequestHandler[] = [
    async (req, res, next) => {
      const [seller] = await deps.db.query(
        "SELECT user_id FROM sellers WHERE user_id=$1 AND status='APPROVED'",
        [res.locals.user.id],
      );
      ensure(seller, 403, 'SELLER_NOT_APPROVED', 'Approved sellers only.');
      ensure(
        processingVideos < 2,
        429,
        'VIDEO_BUSY',
        'Two videos are processing. Please try again shortly.',
      );
      processingVideos++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          processingVideos--;
        }
      };
      res.locals.releaseVideo = release;
      res.once('finish', release);
      res.once('close', () => {
        if (!res.locals.videoProcessing) release();
      });
      next();
    },
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }).single('video'),
    async (req, res) => {
      res.locals.videoProcessing = true;
      try {
        res.status(201).json(await video.uploadVideo(res.locals.user, requestInput(req)));
      } finally {
        res.locals.releaseVideo();
      }
    },
  ];
  return { uploadPhoto, uploadVideo };
}

export function createPublicMediaController(deps: AppDeps) {
  const service = createPublicMediaService(deps);
  const servePhoto: RequestHandler = async (req, res, next) => {
    const photo = await service.findPhoto(String(req.params.file));
    res.setHeader('Cache-Control', 'public,max-age=300');
    res.type(photo.mimeType);
    // Storage paths are resolved from validated IDs and database keys. The local
    // upload root may live under .data, which sendFile otherwise refuses.
    if ('path' in photo && photo.path)
      return res.sendFile(photo.path, { dotfiles: 'allow' }, (err: any) => {
        if (!err) return;
        if (!res.headersSent) {
          res.setHeader('Cache-Control', 'no-store');
          res.removeHeader('Content-Type');
        }
        next(
          err.status === 404
            ? new AppError(404, 'NOT_FOUND', 'Media file not found.')
            : err.status === 416
              ? new AppError(416, 'INVALID_RANGE', 'Requested media range is unavailable.')
              : err,
        );
      });
    if ('url' in photo && photo.url) return res.redirect(photo.url);
    res.send((photo as { buffer: Buffer }).buffer);
  };
  return { servePhoto };
}
