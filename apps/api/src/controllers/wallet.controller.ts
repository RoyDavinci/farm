import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createCheckoutService } from '../services/checkout.service.js';
import { createWalletService } from '../services/wallet.service.js';
import type { AppDeps } from '../types/deps.js';

/** Wallet balance, top-ups through payment providers, and provider webhooks. */
export function createWalletController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createWalletService(deps);
  const checkout = createCheckoutService(deps);
  /** Plain HTML page the provider redirects the buyer's browser to after checkout. */
  const paymentReturnPage: RequestHandler = async (req, res) => {
    const { verified, message } = await service.confirmPaymentReturn(requestInput(req));
    res
      .status(verified ? 200 : 202)
      .type('html')
      .send(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ahia payment</title><body><main><h1>Ahia</h1><p>${message}</p><p>You can close this page and return to the app.</p></main></body></html>`,
      );
  };
  const getWallet: RequestHandler = async (req, res) => {
    res.json(await service.getWallet(res.locals.user, requestInput(req)));
  };
  const addDemoFunds: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addDemoFunds(q, user, requestInput(req)));
  const startFunding: RequestHandler = async (req, res) => {
    res.json(await service.startFunding(res.locals.user, requestInput(req)));
  };
  /** Pays one booking or delivery fare directly at the provider (no wallet top-up). */
  const startCheckout: RequestHandler = async (req, res) => {
    res.json(await checkout.startCheckout(res.locals.user, requestInput(req)));
  };
  const verifyFundingRequest: RequestHandler = async (req, res) => {
    res.json(await service.verifyFundingRequest(res.locals.user, requestInput(req)));
  };
  const providerWebhook: RequestHandler = async (req, res) => {
    res.json(await service.providerWebhook(res.locals.user, requestInput(req)));
  };
  return {
    paymentReturnPage,
    getWallet,
    addDemoFunds,
    startFunding,
    startCheckout,
    verifyFundingRequest,
    providerWebhook,
  };
}
