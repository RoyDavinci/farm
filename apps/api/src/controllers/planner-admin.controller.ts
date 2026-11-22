import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createPlannerAdminService } from '../services/planner-admin.service.js';
import type { AppDeps } from '../types/deps.js';

export function createPlannerAdminController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createPlannerAdminService(deps);
  const getContent: RequestHandler = async (req, res) => {
    res.json(await service.getContent(res.locals.user, requestInput(req)));
  };
  const saveContent: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.saveContent(q, user, requestInput(req)));
  const resetContent: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.resetContent(q, user, requestInput(req)));
  const myAllergenReports: RequestHandler = async (req, res) => {
    res.json(await service.myAllergenReports(res.locals.user, requestInput(req)));
  };
  const listAllergenReports: RequestHandler = async (req, res) => {
    res.json(await service.listAllergenReports(res.locals.user, requestInput(req)));
  };
  const plannerUsage: RequestHandler = async (req, res) => {
    res.json(await service.plannerUsage(res.locals.user, requestInput(req)));
  };
  const reportAllergen: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.reportAllergen(q, user, requestInput(req)));
  const reviewAllergenReport: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.reviewAllergenReport(q, user, requestInput(req)));
  return {
    getContent,
    saveContent,
    resetContent,
    myAllergenReports,
    listAllergenReports,
    plannerUsage,
    reportAllergen,
    reviewAllergenReport,
  };
}
