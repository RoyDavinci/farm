import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { readIdempotency } from '../middleware/idempotency.js';
import type { AppDeps } from '../types/deps.js';
import { fundingInput } from '../validators/funding.validators.js';
import {
  startFunding as initializeFunding,
  verifyFunding as verifyFundingWith,
} from './funding.service.js';
import { balance, ledger } from './ledger.service.js';
import { paymentService, type Provider } from './payment-provider.service.js';
import { handleTransferWebhook } from './payouts.service.js';

/** Business logic for wallet requests. HTTP-free: callers pass plain input. */
export function createWalletService(deps: AppDeps) {
  const { db, config: c } = deps;
  const payments = paymentService(c);
  const verifyFunding = (ref: string, provider?: Provider) =>
    verifyFundingWith(db, c, payments, ref, provider);
  const id = () => randomUUID();
  async function getWallet(user: any, input: RequestInput) {
    const uid = user.id;
    return {
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
      refunds: await db.query(
        'SELECT id,amount_kobo,status,provider,created_at FROM card_refunds WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
        [uid],
      ),
    };
  }
  async function addDemoFunds(q: Query, u: any, input: RequestInput) {
    ensure(c.demo, 404, 'NOT_FOUND', 'Not found.');
    const d = z
      .object({ amount_kobo: z.number().int().min(10000).max(10000000) })
      .parse(input.body);
    await ledger(q, `demo-${id()}`, [
      { account: 'wallet', owner: u.id, amount: d.amount_kobo },
      { account: 'demo_clearing', amount: -d.amount_kobo },
    ]);
    return { ok: true, simulated: true };
  }
  /** Provider redirect after checkout: verifies the reference if it looks like one of ours. */
  async function confirmPaymentReturn(input: RequestInput) {
    const value = input.query.reference || input.query.tx_ref;
    if (typeof value !== 'string' || !/^fm-[a-f0-9-]{36}$/.test(value))
      return {
        verified: false,
        message: 'Return to Ahia to check your payment.',
      };
    try {
      await verifyFunding(value);
      return {
        verified: true,
        message: 'Your payment was verified.',
      };
    } catch {
      return {
        verified: false,
        message:
          'Your payment has not been confirmed yet. Return to the app; it is checked again automatically.',
      };
    }
  }
  async function startFunding(user: any, input: RequestInput) {
    const identity = readIdempotency(input);
    const request = fundingInput.parse(input.body);
    return await initializeFunding(db, c, user, identity, request);
  }
  async function verifyFundingRequest(user: any, input: RequestInput) {
    const [f] = await db.query('SELECT * FROM funding WHERE id=$1 AND user_id=$2', [
      input.params.id,
      user.id,
    ]);
    ensure(f, 404, 'NOT_FOUND', 'Funding reference not found.');
    return await verifyFunding(f.id);
  }
  async function providerWebhook(user: any, input: RequestInput) {
    const provider = z.enum(['paystack', 'flutterwave']).parse(input.params.provider);
    const sig =
      input.header(
        provider === 'paystack'
          ? 'x-paystack-signature'
          : c.flutterwaveWebhookMode === 'legacy'
            ? 'verif-hash'
            : 'flutterwave-signature',
      ) || '';
    ensure(
      payments.signature(provider, input.rawBody || Buffer.alloc(0), sig),
      401,
      'INVALID_SIGNATURE',
      'Invalid webhook signature.',
    );
    if (await handleTransferWebhook(db, c, provider, input.body)) return { received: true };
    const reference =
      provider === 'paystack' ? input.body.data?.reference : input.body.data?.tx_ref;
    const eventName = input.body.event || input.body.type;
    if (
      (provider === 'paystack' && eventName !== 'charge.success') ||
      (provider === 'flutterwave' && !['charge.completed', 'charge.successful'].includes(eventName))
    )
      return { received: true };
    ensure(typeof reference === 'string', 400, 'INVALID_WEBHOOK', 'Missing reference.');
    await verifyFunding(reference, provider);
    return { received: true };
  }
  return {
    confirmPaymentReturn,
    getWallet,
    addDemoFunds,
    startFunding,
    verifyFundingRequest,
    providerWebhook,
  };
}
