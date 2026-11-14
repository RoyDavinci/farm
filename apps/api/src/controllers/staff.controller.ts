import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createStaffService } from '../services/staff.service.js';
import type { AppDeps } from '../types/deps.js';

export function createStaffController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createStaffService(deps);
  const listStaff: RequestHandler = async (req, res) => {
    res.json(await service.listStaff(res.locals.user, requestInput(req)));
  };
  const setStaffRole: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.setStaffRole(q, user, requestInput(req)));
  return { listStaff, setStaffRole };
}
