import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import type { AppDeps } from '../types/deps.js';

export function authRoutes(deps: AppDeps) {
  const r = Router();
  const c = createAuthController(deps);
  r.post('/register', c.register);
  r.post('/login', c.login);
  r.post('/password/forgot', c.forgotPassword);
  r.post('/otp/resend', c.resendCode);
  r.post('/otp/verify', c.verifyCode);
  r.post('/refresh', c.refreshSession);
  return r;
}
