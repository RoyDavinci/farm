import { Router } from 'express';
import { createPlannerAdminController } from '../controllers/planner-admin.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Allergen reports (buyers send, staff review) and aggregate planner usage for staff. */
export function plannerAdminRoutes(deps: AppDeps) {
  const r = Router();
  const c = createPlannerAdminController(deps);
  r.get('/planner/allergen-reports', c.myAllergenReports);
  r.post('/planner/allergen-reports', c.reportAllergen);
  r.get('/admin/planner/usage', c.plannerUsage);
  r.get('/admin/allergen-reports', c.listAllergenReports);
  r.post('/admin/allergen-reports/:id/review', c.reviewAllergenReport);
  return r;
}
