import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { readIdempotency } from '../middleware/idempotency.js';
import { fundingInput } from '../validators/funding.validators.js';
import {
  startFunding as initializeFunding,
  verifyFunding as verifyFundingWith,
} from '../services/funding.service.js';
import { balance, ledger } from '../services/ledger.service.js';
import { paymentService, type Provider } from '../services/payment-provider.service.js';
import { handleTransferWebhook } from '../services/payouts.service.js';
import type { AppDeps } from '../types/deps.js';

/** Wallet balance, top-ups through payment providers, and provider webhooks. */
export function createWalletController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;
  const payments = paymentService(c);
  const verifyFunding = (ref: string, provider?: Provider) =>
    verifyFundingWith(db, payments, ref, provider);
  const id = () => randomUUID();
  const paymentReturnPage: RequestHandler = async (req, res) => {
    const value = req.query.reference || req.query.tx_ref;
    let message = 'Return to Farmers Market and verify your payment in Wallet.';
    let verified = false;
    if (typeof value === 'string' && /^fm-[a-f0-9-]{36}$/.test(value)) {
      try {
        await verifyFunding(value);
        verified = true;
        message = 'Your payment was verified and your Farmers Market wallet was credited.';
      } catch {
        message =
          'Your payment has not been verified yet. Return to Wallet and choose Verify completed payment.';
      }
    }
    res
      .status(verified ? 200 : 202)
      .type('html')
      .send(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Farmers Market payment</title><body><main><h1>Farmers Market</h1><p>${message}</p><p>You can close this page and return to the app.</p></main></body></html>`,
      );
  };
  const getWallet: RequestHandler = async (_req, res) => {
    const uid = res.locals.user.id;
    res.json({
      balance_kobo: await balance(db, uid),
      seller_payable_kobo: await balance(db, uid, 'seller_payable'),
      entries: await db.query(
        "SELECT id,account,amount_kobo,reference,created_at FROM ledger WHERE owner_id=$1 AND account IN ('wallet','seller_payable') ORDER BY created_at DESC LIMIT 50",
        [uid],
      ),
      funding: await db.query(
        'SELECT * FROM funding WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
        [uid],
      ),
    });
  };
  const addDemoFunds: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      ensure(c.demo, 404, 'NOT_FOUND', 'Not found.');
      const d = z
        .object({ amount_kobo: z.number().int().min(10000).max(10000000) })
        .parse(req.body);
      await ledger(q, `demo-${id()}`, [
        { account: 'wallet', owner: u.id, amount: d.amount_kobo },
        { account: 'demo_clearing', amount: -d.amount_kobo },
      ]);
      return { ok: true, simulated: true };
    });
  const startFunding: RequestHandler = async (req, res) => {
    const identity = readIdempotency(req);
    const input = fundingInput.parse(req.body);
    res.json(await initializeFunding(db, c, res.locals.user, identity, input));
  };
  const verifyFundingRequest: RequestHandler = async (req, res) => {
    const [f] = await db.query('SELECT * FROM funding WHERE id=$1 AND user_id=$2', [
      req.params.id,
      res.locals.user.id,
    ]);
    ensure(f, 404, 'NOT_FOUND', 'Funding reference not found.');
    res.json(await verifyFunding(f.id));
  };
  const providerWebhook: RequestHandler = async (req, res) => {
    const provider = z.enum(['paystack', 'flutterwave']).parse(req.params.provider);
    const sig =
      req.header(
        provider === 'paystack'
          ? 'x-paystack-signature'
          : c.flutterwaveWebhookMode === 'legacy'
            ? 'verif-hash'
            : 'flutterwave-signature',
      ) || '';
    ensure(
      payments.signature(provider, (req as any).rawBody || Buffer.alloc(0), sig),
      401,
      'INVALID_SIGNATURE',
      'Invalid webhook signature.',
    );
    if (await handleTransferWebhook(db, c, provider, req.body)) return res.json({ received: true });
    const reference = provider === 'paystack' ? req.body.data?.reference : req.body.data?.tx_ref;
    const eventName = req.body.event || req.body.type;
    if (
      (provider === 'paystack' && eventName !== 'charge.success') ||
      (provider === 'flutterwave' && !['charge.completed', 'charge.successful'].includes(eventName))
    )
      return res.json({ received: true });
    ensure(typeof reference === 'string', 400, 'INVALID_WEBHOOK', 'Missing reference.');
    await verifyFunding(reference, provider);
    res.json({ received: true });
  };
  return {
    paymentReturnPage,
    getWallet,
    addDemoFunds,
    startFunding,
    verifyFundingRequest,
    providerWebhook,
  };
}
