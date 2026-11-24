import { Router } from 'express';
import { createDealsController } from '../controllers/deals.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Sales, price watches ("tell me when it's cheaper") and buyer requests. */
export function dealsRoutes(deps: AppDeps) {
  const r = Router();
  const c = createDealsController(deps);
  r.post('/listings/:id/sale', c.setSale);
  r.get('/price-watches', c.listWatches);
  r.post('/price-watches', c.watchPrice);
  r.delete('/price-watches/:id', c.unwatchPrice);
  r.get('/product-requests/suggest', c.suggest);
  r.get('/product-requests/mine', c.myRequests);
  r.post('/product-requests', c.createRequest);
  r.post('/product-requests/:id/offer', c.offer);
  r.post('/product-requests/:id/close', c.closeRequest);
  r.get('/sellers/me/product-requests', c.sellerRequests);
  return r;
}
