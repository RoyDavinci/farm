import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createCasesService } from '../services/cases.service.js';
import type { AppDeps } from '../types/deps.js';

export function createCasesController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createCasesService(deps);
  const caseTimeline: RequestHandler = async (req, res) => {
    res.json(await service.caseTimeline(res.locals.user, requestInput(req)));
  };
  const sendCaseMessage: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.sendCaseMessage(q, user, requestInput(req)));
  const caseQueue: RequestHandler = async (req, res) => {
    res.json(await service.caseQueue(res.locals.user, requestInput(req)));
  };
  const caseAssignees: RequestHandler = async (req, res) => {
    res.json(await service.caseAssignees(res.locals.user, requestInput(req)));
  };
  const assignCase: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.assignCase(q, user, requestInput(req)));
  const addCaseNote: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addCaseNote(q, user, requestInput(req)));
  return { caseTimeline, sendCaseMessage, caseQueue, caseAssignees, assignCase, addCaseNote };
}
