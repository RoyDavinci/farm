import { Router } from 'express';
import { createStaffController } from '../controllers/staff.controller.js';
import type { AppDeps } from '../types/deps.js';

export function staffRoutes(deps: AppDeps) {
  const r = Router();
  const c = createStaffController(deps);
  r.get('/staff', c.listStaff);
  r.post('/staff', c.setStaffRole);
  return r;
}
