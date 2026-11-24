import { Router } from 'express';
import { createDealsController } from '../controllers/deals.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Sales, price watches ("tell me when it's cheaper") and buyer requests. */
export function dealsRoutes(deps: AppDeps) {
  const r = Router();
  const c = createDealsController(deps);
  r.get('/offers', c.offers);
  r.post('/listings/:id/sale', c.setSale);
  r.get('/group-buys', c.listGroups);
  r.get('/group-buys/search', c.searchGroupProducts);
  r.post('/group-buys', c.startGroup);
  r.get('/group-buys/:id', c.getGroup);
  r.post('/group-buys/:id/join', c.joinGroup);
  r.post('/group-buys/:id/leave', c.leaveGroup);
  r.post('/group-buys/:id/invite', c.inviteToGroup);
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
