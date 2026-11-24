import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createRewardsService } from '../services/rewards.service.js';
import type { AppDeps } from '../types/deps.js';

/** Ahia IDs, wallet transfers, referral links and promo codes. */
export function createRewardsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createRewardsService(deps);
  const read =
    (fn: (user: any, input: any) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      res.json(await fn(res.locals.user, requestInput(req)));
    };
  const write =
    (fn: (q: any, user: any, input: any) => Promise<unknown>): RequestHandler =>
    (req, res) =>
      mutate(req, res, (q, user) => fn(q, user, requestInput(req)));
  return {
    findRecipient: read(service.findRecipient),
    sendTransfer: write(service.sendTransfer),
    listTransfers: read(service.listTransfers),
    myReferrals: read(service.myReferrals),
    referrer: read(service.referrer),
    redeemPromo: write(service.redeemPromo),
    myPromos: read(service.myPromos),
    adminPromos: read(service.adminPromos),
    createPromo: write(service.createPromo),
    setPromoActive: write(service.setPromoActive),
    adminReferrals: read(service.adminReferrals),
    saveReferralSettings: write(service.saveReferralSettings),
  };
}
