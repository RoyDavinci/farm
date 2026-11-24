import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createAccountService } from '../services/account.service.js';
import { createTransactionPinService } from '../services/transaction-pin.service.js';
import { createAuthService } from '../services/auth.service.js';
import type { AppDeps } from '../types/deps.js';

/** The signed-in user: profile, device sessions, sign-out and public marketplace settings. */
export function createAccountController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createAccountService(deps);
  const pins = createTransactionPinService(deps);
  const auth = createAuthService(deps);
  const getTransactionPin: RequestHandler = async (req, res) => {
    res.json(await pins.getTransactionPin(res.locals.user, requestInput(req)));
  };
  const setTransactionPin: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => pins.setTransactionPin(q, user, requestInput(req)));
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
  const addBiometric: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => pins.addBiometric(q, user, requestInput(req)));
  const removeBiometric: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => pins.removeBiometric(q, user, requestInput(req)));
  const addLoginKey: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => auth.addLoginKey(q, user, requestInput(req)));
  const removeLoginKey: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => auth.removeLoginKey(q, user, requestInput(req)));
  const listBiometrics: RequestHandler = async (req, res) => {
    res.json(await pins.listBiometrics(res.locals.user, requestInput(req)));
  };
  const getSettings: RequestHandler = async (req, res) => {
    res.json(await service.getSettings(res.locals.user, requestInput(req)));
  };
  return {
    getMe,
    getTransactionPin,
    setTransactionPin,
    addBiometric,
    removeBiometric,
    listBiometrics,
    addLoginKey,
    removeLoginKey,
    updateMe,
    listSessions,
    revokeSession,
    logout,
    getSettings,
  };
}
