import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createAuthService } from '../services/auth.service.js';
import type { AppDeps } from '../types/deps.js';

export function createAuthController(deps: AppDeps) {
  const service = createAuthService(deps);
  const register: RequestHandler = async (req, res) => {
    // 202 with a challenge (a code was sent); 201 with a session (phone-only, minimal check).
    const result = await service.register(requestInput(req));
    res.status('token' in result ? 201 : 202).json(result);
  };
  const login: RequestHandler = async (req, res) => {
    // 202 with a challenge (a code was emailed); 200 with a session from a trusted device.
    const result = await service.login(requestInput(req));
    res.status('token' in result ? 200 : 202).json(result);
  };
  const forgotPassword: RequestHandler = async (req, res) => {
    res.status(202).json(await service.forgotPassword(requestInput(req)));
  };
  const resendCode: RequestHandler = async (req, res) => {
    res.json(await service.resendCode(res.locals.user, requestInput(req)));
  };
  const verifyCode: RequestHandler = async (req, res) => {
    const result = await service.verifyCode(requestInput(req));
    if ('error' in result && result.error)
      res.status(result.error.status).json({ error: result.error });
    else res.json(result);
  };
  const refreshSession: RequestHandler = async (req, res) => {
    const result = await service.refreshSession(requestInput(req));
    if ('error' in result && result.error) res.status(401).json({ error: result.error });
    else res.json(result);
  };
  const biometricSignIn: RequestHandler = async (req, res) => {
    res.json(await service.biometricSignIn(requestInput(req)));
  };
  const clientReport: RequestHandler = async (req, res) => {
    res.json(await service.clientReport(requestInput(req)));
  };
  return {
    clientReport,
    register,
    login,
    forgotPassword,
    resendCode,
    verifyCode,
    refreshSession,
    biometricSignIn,
  };
}
