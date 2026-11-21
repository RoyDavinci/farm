import { Router } from 'express';
import { createWalletController } from '../controllers/wallet.controller.js';
import type { AppDeps } from '../types/deps.js';

export function walletRoutes(deps: AppDeps) {
  const r = Router();
  const c = createWalletController(deps);
  r.get('/payments/return', c.paymentReturnPage);
  r.get('/wallet', c.getWallet);
  r.post('/wallet/demo-fund', c.addDemoFunds);
  r.post('/wallet/fund', c.startFunding);
  r.post('/payments/checkout', c.startCheckout);
  r.post('/wallet/funding/:id/verify', c.verifyFundingRequest);
  r.post('/webhooks/:provider', c.providerWebhook);
  return r;
}
