import multer from 'multer';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { createShoppingMediaService } from '../services/shopping-media.service.js';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { requestInput } from '../lib/http.js';
import { createShoppingService } from '../services/shopping.service.js';
import { createRidersService } from '../services/riders.service.js';
import { createPayoutsService } from '../services/payouts.service.js';

export function createShoppingController(deps: AppDeps) {
  const service = createShoppingService(deps),
    riders = createRidersService(deps),
    payouts = createPayoutsService(deps);
  const media = createShoppingMediaService(deps);
  const uploadReceipt: RequestHandler[] = [
    async (req, res, next) => {
      await media.authorize(res.locals.user, req.params.id as string, true);
      next();
    },
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }).single('file'),
    async (req, res) => {
      res.status(201).json(await media.upload(res.locals.user, requestInput(req)));
    },
  ];
  const location: RequestHandler = (req, res) =>
    deps.mutate(req, res, async (q, u) => {
      const d = z
        .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
        .parse(req.body);
      const rows = await q.query(
        "UPDATE shopping_requests SET rider_latitude=$1,rider_longitude=$2,rider_location_at=now() WHERE id=$3 AND rider_id=$4 AND status IN ('SHOPPING','PURCHASED') AND NOT review_open AND EXISTS(SELECT 1 FROM drivers WHERE user_id=$4 AND status='APPROVED') RETURNING rider_location_at",
        [d.latitude, d.longitude, req.params.id, u.id],
      );
      ensure(
        rows.length,
        409,
        'TRACKING_UNAVAILABLE',
        'Only the assigned approved rider can share location on an active request.',
      );
      return { updated_at: rows[0].rider_location_at };
    });
  const nearbyRiders: RequestHandler = async (req, res) => {
    res.json(await riders.nearbyRiders(res.locals.user, requestInput(req)));
  };
  const quote: RequestHandler = async (req, res) => {
    res.json(await service.quote(res.locals.user, requestInput(req)));
  };
  const create: RequestHandler = async (req, res) => {
    const input = requestInput(req);
    const estimate = await service.quote(res.locals.user, input);
    return deps.mutate(req, res, (q, u) => service.create(q, u, input, estimate));
  };
  const mine: RequestHandler = async (req, res) => {
    res.json(await service.mine(res.locals.user, requestInput(req)));
  };
  const detail: RequestHandler = async (req, res) => {
    res.json(await service.detail(res.locals.user, requestInput(req)));
  };
  const message: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.message(q, u, requestInput(req)));
  const act: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.act(q, u, requestInput(req)));
  const advancePayout: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) =>
      payouts.requestPayout(q, u, {
        ...requestInput(req),
        body: { ...req.body, shopping_request_id: req.params.id },
      }),
    );
  return {
    uploadReceipt,
    location,
    nearbyRiders,
    quote,
    create,
    mine,
    detail,
    message,
    act,
    advancePayout,
  };
}
export function createAdminShoppingController(deps: AppDeps) {
  const service = createShoppingService(deps);
  const adminList: RequestHandler = async (req, res) => {
    res.json(await service.adminList(res.locals.user, requestInput(req)));
  };
  const review: RequestHandler = (req, res) =>
    deps.mutate(req, res, (q, u) => service.review(q, u, requestInput(req)));
  return { adminList, review };
}

export function createPublicShoppingController(deps: AppDeps) {
  const service = createShoppingMediaService(deps);
  const receipt: RequestHandler = async (req, res) => {
    const file = await service.readSigned(requestInput(req));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (file.url) return res.redirect(file.url);
    res.type('image/webp').send(file.buffer);
  };
  return { receipt };
}
