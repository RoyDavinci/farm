import { Router } from 'express';
import { createAccountController } from '../controllers/account.controller.js';
import type { AppDeps } from '../types/deps.js';

export function accountRoutes(deps: AppDeps) {
  const r = Router();
  const c = createAccountController(deps);
  r.get('/me', c.getMe);
  r.patch('/me', c.updateMe);
  r.get('/me/transaction-pin', c.getTransactionPin);
  r.put('/me/transaction-pin', c.setTransactionPin);
  r.get('/me/biometrics', c.listBiometrics);
  r.post('/me/login-keys', c.addLoginKey);
  r.delete('/me/login-keys/:id', c.removeLoginKey);
  r.post('/me/biometrics', c.addBiometric);
  r.delete('/me/biometrics/:id', c.removeBiometric);
  r.get('/me/sessions', c.listSessions);
  r.delete('/me/sessions/:id', c.revokeSession);
  r.post('/auth/logout', c.logout);
  r.get('/settings', c.getSettings);
  return r;
}
