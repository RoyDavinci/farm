import { Router } from 'express';
import { createRewardsController } from '../controllers/rewards.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Wallet transfers by Ahia ID, referral links and promo codes. */
export function rewardsRoutes(deps: AppDeps) {
  const r = Router();
  const c = createRewardsController(deps);
  r.get('/wallet/transfers/recipient', c.findRecipient);
  r.get('/wallet/transfers', c.listTransfers);
  r.post('/wallet/transfers', c.sendTransfer);
  r.get('/referrals/me', c.myReferrals);
  r.get('/promo-codes/mine', c.myPromos);
  r.post('/promo-codes/redeem', c.redeemPromo);
  return r;
}

/** Sign-up screen: who sent this invite link (no account yet). */
export function publicRewardsRoutes(deps: AppDeps) {
  const r = Router();
  const c = createRewardsController(deps);
  r.get('/referrer', c.referrer);
  return r;
}

/** Staff: promo codes and referral rewards. */
export function adminRewardsRoutes(deps: AppDeps) {
  const r = Router();
  const c = createRewardsController(deps);
  r.get('/promo-codes', c.adminPromos);
  r.post('/promo-codes', c.createPromo);
  r.post('/promo-codes/:id/active', c.setPromoActive);
  r.get('/referrals', c.adminReferrals);
  r.put('/referrals', c.saveReferralSettings);
  return r;
}
