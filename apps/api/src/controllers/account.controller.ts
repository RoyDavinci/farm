import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createAccountService } from '../services/account.service.js';
import type { AppDeps } from '../types/deps.js';

const bearer = (header?: string) => (header || '').replace(/^Bearer /, '');

/** The signed-in user: profile, device sessions, sign-out and public marketplace settings. */
export function createAccountController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAccountService(deps);
  const getMe: RequestHandler = async (req, res) => {
    res.json(await service.getMe(res.locals.user, requestInput(req)));
  };
  const updateMe: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updateMe(q, user, requestInput(req)));
  const listSessions: RequestHandler = async (req, res) => {
    res.json(await service.listSessions(res.locals.user, requestInput(req)));
  };
  const revokeSession: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.revokeSession(q, user, requestInput(req)));
  const logout: RequestHandler = async (req, res) => {
    res.json(await service.logout(res.locals.user, requestInput(req)));
  };
  const getSettings: RequestHandler = async (req, res) => {
    res.json(await service.getSettings(res.locals.user, requestInput(req)));
  };
  return { getMe, updateMe, listSessions, revokeSession, logout, getSettings };
}
