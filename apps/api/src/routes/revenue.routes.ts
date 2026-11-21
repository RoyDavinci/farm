import { Router } from 'express';
import { createRevenueController } from '../controllers/revenue.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Revenue: switches, packages, featured shops, local advertising, delivery partners and income report. */
export function revenueRoutes(deps: AppDeps) {
  const r = Router();
  const c = createRevenueController(deps);
  r.get('/promotion-packages', c.listPackages);
  r.get('/featured-sellers', c.featuredSellers);
  r.get('/sellers/me/featured', c.myFeatured);
  r.post('/sellers/me/featured', c.featureMyShop);
  r.get('/ads', c.serveAds);
  r.post('/ads/:id/click', c.clickAd);
  r.get('/admin/revenue/switches', c.getSwitches);
  r.put('/admin/revenue/switches', c.saveSwitches);
  r.get('/admin/revenue/report', c.revenueReport);
  r.get('/admin/promotion-packages', c.adminPackages);
  r.post('/admin/promotion-packages', c.savePackage);
  r.put('/admin/promotion-packages/:id', c.updatePackage);
  r.get('/admin/featured-sellers', c.adminFeatured);
  r.post('/admin/featured-sellers/:id/cancel', c.cancelFeatured);
  r.get('/admin/ads', c.adminAds);
  r.post('/admin/ads', c.saveAd);
  r.put('/admin/ads/:id', c.updateAd);
  r.post('/admin/ads/:id/status', c.setAdStatus);
  r.post('/admin/ads/:id/payments', c.recordAdPayment);
  r.get('/admin/delivery-partners', c.adminPartners);
  r.post('/admin/delivery-partners', c.savePartner);
  r.put('/admin/delivery-partners/:id', c.updatePartner);
  r.post('/admin/delivery-partners/:id/drivers', c.assignPartnerDriver);
  return r;
}
