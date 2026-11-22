import { Router } from 'express';
import { createGrowthController } from '../controllers/growth.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Growth modules: subscriptions and membership, assistant, insights, research, B2B quotes, teams, bulk upload. */
export function growthRoutes(deps: AppDeps) {
  const r = Router();
  const c = createGrowthController(deps);
  r.get('/subscription-plans', c.listPlans);
  r.get('/me/subscriptions', c.mySubscriptions);
  r.post('/me/subscriptions', c.subscribe);
  r.post('/me/subscriptions/:id/cancel', c.cancelSubscription);
  r.get('/admin/subscription-plans', c.adminPlans);
  r.post('/admin/subscription-plans', c.createPlan);
  r.put('/admin/subscription-plans/:id', c.updatePlan);
  r.get('/admin/subscriptions', c.adminSubscriptions);
  r.post('/admin/subscriptions/:id/activate', c.activateSubscription);
  r.post('/sellers/me/ai/listing-assist', c.listingAssist);
  r.get('/sellers/me/business-report', c.businessReport);
  r.get('/sellers/me/market-insights', c.marketInsights);
  r.get('/admin/market-reports', c.researchReport);
  r.post('/rfqs', c.createRfq);
  r.get('/rfqs/mine', c.myRfqs);
  r.get('/rfqs/open', c.openRfqs);
  r.get('/rfqs/:id', c.getRfq);
  r.post('/rfqs/:id/quotes', c.submitQuote);
  r.post('/rfqs/:id/quotes/:quoteId/accept', c.acceptQuote);
  r.post('/rfqs/:id/close', c.closeRfq);
  r.get('/me/teams', c.myTeams);
  r.get('/sellers/me/team', c.listTeam);
  r.post('/sellers/me/team', c.addTeamMember);
  r.delete('/sellers/me/team/:userId', c.removeTeamMember);
  r.post('/sellers/me/listings/import', c.importListings);
  return r;
}
