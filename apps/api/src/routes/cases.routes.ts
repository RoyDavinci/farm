import { Router } from 'express';
import { createCasesController } from '../controllers/cases.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Complaint case management: shared timeline, staff assignment, priority and notes. */
export function casesRoutes(deps: AppDeps) {
  const r = Router();
  const c = createCasesController(deps);
  r.get('/disputes/:id/timeline', c.caseTimeline);
  r.post('/disputes/:id/messages', c.sendCaseMessage);
  r.get('/admin/disputes/queue', c.caseQueue);
  r.get('/admin/disputes/assignees', c.caseAssignees);
  r.post('/admin/disputes/:id/assign', c.assignCase);
  r.post('/admin/disputes/:id/notes', c.addCaseNote);
  return r;
}
