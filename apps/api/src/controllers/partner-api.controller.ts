import type { RequestHandler } from 'express';
import { createPartnerService } from '../services/partner.service.js';
import type { AppDeps } from '../types/deps.js';

/** Partner API handlers; res.locals.partner is set by the API-key check. */
export function createPartnerApiController(deps: AppDeps) {
  const service = createPartnerService(deps);
  const authenticateKey: RequestHandler = (req, res, next) =>
    void service.authenticateKey(req, res, next);
  const listings: RequestHandler = async (_req, res) => {
    service.scope(res, 'listings:read');
    res.json(await service.partnerListings(res.locals.partner));
  };
  const updateListing: RequestHandler = async (req, res) => {
    service.scope(res, 'listings:write');
    res.json(
      await deps.db.transaction((q) =>
        service.partnerUpdateListing(q, res.locals.partner, String(req.params.id), req.body),
      ),
    );
  };
  const orders: RequestHandler = async (_req, res) => {
    service.scope(res, 'orders:read');
    res.json(await service.partnerOrders(res.locals.partner));
  };
  return { authenticateKey, listings, updateListing, orders };
}
