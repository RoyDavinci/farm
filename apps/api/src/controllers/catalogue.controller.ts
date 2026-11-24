import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createCatalogueProductsService } from '../services/catalogue-products.service.js';
import type { AppDeps } from '../types/deps.js';

/** Shared product catalogue, quick price and stock updates, and staff photo management. */
export function createCatalogueController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createCatalogueProductsService(deps);
  const read =
    (fn: (user: any, input: any) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      res.json(await fn(res.locals.user, requestInput(req)));
    };
  const write =
    (fn: (q: any, user: any, input: any) => Promise<unknown>): RequestHandler =>
    (req, res) =>
      mutate(req, res, (q, user) => fn(q, user, requestInput(req)));
  return {
    searchCatalogue: read(service.searchCatalogue),
    addProduct: write(service.addProduct),
    addFromCatalogue: write(service.addFromCatalogue),
    updatePrices: write(service.updatePrices),
    setOutToday: write(service.setOutToday),
    setStockMode: write(service.setStockMode),
    adminCatalogue: read(service.adminCatalogue),
    adminAddProduct: write(service.addProduct),
    addStaffPhoto: write(service.addStaffPhoto),
    removePhoto: write(service.removePhoto),
    setProductActive: write(service.setProductActive),
    bareListings: read(service.bareListings),
    setListingPhoto: write(service.setListingPhoto),
    fillBareListings: write(service.fillBareListings),
  };
}
