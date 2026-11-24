import { Router } from 'express';
import { createCatalogueController } from '../controllers/catalogue.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Sellers: pick products from the shared catalogue, update prices in bulk, mark items out. */
export function catalogueRoutes(deps: AppDeps) {
  const r = Router();
  const c = createCatalogueController(deps);
  r.get('/catalogue/products', c.searchCatalogue);
  r.post('/catalogue/products', c.addProduct);
  r.post('/sellers/me/listings/from-catalogue', c.addFromCatalogue);
  r.post('/sellers/me/listings/prices', c.updatePrices);
  r.post('/listings/:id/out-today', c.setOutToday);
  r.put('/listings/:id/stock-mode', c.setStockMode);
  return r;
}

/** Staff: the catalogue's products and shared photos. */
export function adminCatalogueRoutes(deps: AppDeps) {
  const r = Router();
  const c = createCatalogueController(deps);
  r.get('/catalogue-products', c.adminCatalogue);
  r.get('/catalogue-products/bare-listings', c.bareListings);
  r.post('/catalogue-products/bare-listings/fill', c.fillBareListings);
  r.post('/catalogue-products/bare-listings/:id/photo', c.setListingPhoto);
  r.post('/catalogue-products', c.adminAddProduct);
  r.post('/catalogue-products/:id/photos', c.addStaffPhoto);
  r.post('/catalogue-products/:id/active', c.setProductActive);
  r.post('/catalogue-photos/:id/remove', c.removePhoto);
  return r;
}
