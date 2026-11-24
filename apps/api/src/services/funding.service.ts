import type { Config } from '../config/index.js';
import type { Database, Query } from '../database/client.js';
import type { RequestInput } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import type { AppDeps } from '../types/deps.js';
import { ensure } from '../lib/errors.js';
import { ledger } from './ledger.service.js';
import { paymentService, type Provider } from './payment-provider.service.js';

/**
 * Credits a wallet top-up only after the provider confirms the exact reference, amount and NGN
 * currency. Safe to call repeatedly (webhook, redirect, manual verify): it credits at most once.
 */
export async function verifyFunding(
  db: Database,
  c: Config,
  payments: ReturnType<typeof paymentService>,
  ref: string,
  provider?: Provider,
) {
  const [f] = await db.query('SELECT * FROM funding WHERE id=$1', [ref]);
  ensure(
    f && (!provider || f.provider === provider),
    404,
    'NOT_FOUND',
    'Funding reference not found.',
  );
  if (f.status === 'SUCCESSFUL') return { ok: true };
  ensure(payments.enabled(f.provider), 503, 'PROVIDER_DISABLED', 'Provider is not configured.');
  const result = await payments.verify(f.provider, ref);
  ensure(
    result.success &&
      result.reference === ref &&
      result.amount === f.amount_kobo &&
      result.currency === 'NGN',
    409,
    'PAYMENT_NOT_VERIFIED',
    'Payment is pending or does not match the funding request.',
  );
  return db.transaction(async (q) => {
    const [locked] = await q.query('SELECT * FROM funding WHERE id=$1 FOR UPDATE', [ref]);
    if (locked.status === 'SUCCESSFUL') return { ok: true };
    await ledger(q, ref, [
      { account: 'provider_clearing', amount: -f.amount_kobo },
      { account: 'wallet', owner: f.user_id, amount: f.amount_kobo },
    ]);
    await q.query(
      "UPDATE funding SET status='SUCCESSFUL',provider_id=$1,credited_at=now() WHERE id=$2",
      [result.id, ref],
    );
    if (locked.purpose === 'booking' && locked.target_id)
      await applyToBooking(q, c, { user_id: locked.user_id, target_id: locked.target_id });
    if (locked.purpose === 'subscription' && locked.target_id)
      await applyToSubscription(q, {
        user_id: locked.user_id,
        target_id: locked.target_id,
        amount_kobo: Number(f.amount_kobo),
        reference: ref,
      });
    return { ok: true };
  });
}

/**
 * A direct booking checkout pays that booking as soon as the money is confirmed, through the
 * normal booking "pay" rules. If the booking can no longer be paid (expired, cancelled, already
 * paid), the money stays as an unapplied balance, which is refunded to the card when the wallet
 * feature is off.
 */
async function applyToBooking(q: Query, c: Config, f: { user_id: string; target_id: string }) {
  const { createBookingsService } = await import('./booking.service.js');
  const bookings = createBookingsService({ db: null, config: c } as unknown as AppDeps);
  await q.query('SAVEPOINT apply_checkout');
  try {
    const result = await bookings.performBookingAction(q, { id: f.user_id }, {
      params: { id: f.target_id, action: 'pay' },
      body: {},
    } as unknown as RequestInput);
    if (result && 'error' in result) throw new Error(result.error?.code ?? 'NOT_APPLIED');
    await q.query('RELEASE SAVEPOINT apply_checkout');
  } catch (error) {
    await q.query('ROLLBACK TO SAVEPOINT apply_checkout');
    logger.warn('checkout not applied to booking; it will be refunded', {
      booking: f.target_id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A card payment for a seller plan or membership starts it straight away and becomes revenue. If
 * the plan was cancelled meanwhile or the amount differs, the money stays as an unapplied balance
 * and is refunded to the card.
 */
async function applyToSubscription(
  q: Query,
  f: { user_id: string; target_id: string; amount_kobo: number; reference: string },
) {
  const [sub] = await q.query(
    `SELECT s.*,p.period_days,p.name FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
     WHERE s.id=$1 AND s.user_id=$2 AND s.status='PENDING_PAYMENT' FOR UPDATE OF s`,
    [f.target_id, f.user_id],
  );
  if (!sub || Number(sub.fee_kobo) !== f.amount_kobo) {
    logger.warn('card payment not applied to subscription; it will be refunded', {
      subscription: f.target_id,
    });
    return;
  }
  await ledger(q, sub.id, [
    { account: 'wallet', owner: f.user_id, amount: -f.amount_kobo },
    { account: 'platform_revenue', amount: f.amount_kobo },
  ]);
  await q.query(
    "UPDATE subscriptions SET status='ACTIVE',payment_reference=$1,starts_at=now(),ends_at=now()+$2::int*interval '1 day' WHERE id=$3",
    [f.reference, sub.period_days, sub.id],
  );
  const { notify } = await import('./communications.service.js');
  await notify(
    q,
    f.user_id,
    'subscription',
    `${sub.name} is active`,
    'Thank you! Your card payment went through.',
  );
}

/** Hosted checkout uses short claim/finalize transactions around external I/O. */
export interface FundingCheckout {
  reference: string;
  checkout_url: string;
  provider: Provider;
  fallback_used: boolean;
}
interface FundingActor {
  id: string;
  email: string | null;
  phone?: string;
  name: string;
}
interface FundingFailure {
  status: number;
  code: string;
  message: string;
}
interface FundingIntentRow {
  actor_id: string;
  key: string;
  request_hash: string;
  requested_provider: Provider;
  current_reference: string;
  status: 'INITIALIZING' | 'READY' | 'FAILED' | 'UNCERTAIN';
  lease_until: Date;
  response: FundingCheckout | null;
  error: FundingFailure | null;
}
type FundingClaim =
  | { kind: 'claimed'; reference: string }
  | { kind: 'ready'; response: FundingCheckout }
  | { kind: 'error'; error: FundingFailure };
const inProgress: FundingFailure = {
  status: 409,
  code: 'FUNDING_IN_PROGRESS',
  message: 'Checkout is being prepared. Retry this request with the same Idempotency-Key shortly.',
};
export const uncertain: FundingFailure = {
  status: 409,
  code: 'FUNDING_UNCERTAIN',
  message:
    'Checkout preparation was interrupted. Check Wallet for a pending payment before starting a new funding request.',
};

export async function startFunding(
  db: Database,
  c: import('../config/index.js').Config,
  actor: FundingActor,
  identity: { key: string; fingerprint: string },
  input: import('../validators/funding.validators.js').FundingInput & {
    purpose?: 'wallet' | 'booking' | 'delivery' | 'subscription';
    target_id?: string;
  },
): Promise<FundingCheckout> {
  const purpose = input.purpose ?? 'wallet',
    target = input.target_id ?? null;
  const payments = paymentService(c);
  const { randomUUID } = await import('node:crypto');
  const { AppError } = await import('../lib/errors.js');
  const fail = (error: FundingFailure): never => {
    throw new AppError(error.status, error.code, error.message);
  };
  // A replay is checked before current provider configuration: old successful responses stay valid.
  const claim = await db.transaction<FundingClaim>(async (q) => {
    await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
    const old = await q.prisma.idempotencyKey.findUnique({
      where: { actor_id_key: { actor_id: actor.id, key: identity.key } },
    });
    if (old) {
      ensure(
        old.request_hash === identity.fingerprint,
        409,
        'IDEMPOTENCY_CONFLICT',
        'This key was already used for a different request.',
      );
      const value = old.response as unknown as Partial<FundingCheckout> & { kind?: string };
      if (
        typeof value?.checkout_url === 'string' &&
        typeof value.reference === 'string' &&
        value.provider
      )
        return { kind: 'ready', response: value as FundingCheckout };
      ensure(
        value?.kind === 'funding-intent',
        500,
        'INVALID_IDEMPOTENCY_RESPONSE',
        'Stored checkout response is invalid.',
      );
    }
    const [intent] = await q.query<FundingIntentRow>(
      'SELECT * FROM funding_intents WHERE actor_id=$1 AND key=$2 FOR UPDATE',
      [actor.id, identity.key],
    );
    if (intent) {
      ensure(
        intent.request_hash === identity.fingerprint,
        409,
        'IDEMPOTENCY_CONFLICT',
        'This key was already used for a different request.',
      );
      if (intent.status === 'READY' && intent.response)
        return { kind: 'ready', response: intent.response };
      if (intent.status === 'FAILED' || intent.status === 'UNCERTAIN')
        return { kind: 'error', error: intent.error || uncertain };
      if (new Date(intent.lease_until).getTime() <= Date.now()) {
        await q.query(
          "UPDATE funding_intents SET status='UNCERTAIN',error=$1,updated_at=now() WHERE actor_id=$2 AND key=$3",
          [JSON.stringify(uncertain), actor.id, identity.key],
        );
        return { kind: 'error', error: uncertain };
      }
      return { kind: 'error', error: inProgress };
    }
    ensure(
      payments.enabled(input.provider),
      503,
      'PROVIDER_DISABLED',
      'This provider is not configured for wallet funding.',
    );
    const reference = `fm-${randomUUID()}`;
    await q.query(
      "INSERT INTO funding(id,user_id,provider,amount_kobo,status,purpose,target_id) VALUES($1,$2,$3,$4,'INITIALIZING',$5,$6)",
      [reference, actor.id, input.provider, input.amount_kobo, purpose, target],
    );
    await q.query(
      'INSERT INTO funding_intents(actor_id,key,request_hash,requested_provider,current_reference,lease_until) VALUES($1,$2,$3,$4,$5,$6)',
      [
        actor.id,
        identity.key,
        identity.fingerprint,
        input.provider,
        reference,
        new Date(Date.now() + 90000),
      ],
    );
    await q.query(
      "INSERT INTO payment_attempts(id,funding_reference,provider,status) VALUES($1,$2,$3,'INITIALIZING')",
      [randomUUID(), reference, input.provider],
    );
    await q.prisma.idempotencyKey.create({
      data: {
        actor_id: actor.id,
        key: identity.key,
        request_hash: identity.fingerprint,
        response: { kind: 'funding-intent', reference },
      },
    });
    return { kind: 'claimed', reference };
  });
  if (claim.kind === 'ready') return claim.response;
  if (claim.kind === 'error') return fail(claim.error);
  let reference = claim.reference,
    provider = input.provider;
  try {
    let url: string;
    try {
      url = await payments.initialize(
        provider,
        reference,
        input.amount_kobo,
        // Card providers need an email; phone-only accounts use a stand-in address.
        actor.email || `${String(actor.phone).replace(/\D/g, '')}@phone.ahiamarketplace.com`,
        actor.name,
        { cardOnly: input.method === 'card' },
      );
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        error.code !== 'PROVIDER_UNAVAILABLE' ||
        provider !== 'paystack' ||
        c.fallbackProvider !== 'flutterwave' ||
        !payments.enabled('flutterwave')
      )
        throw error;
      // Keep the primary reference: even a late signed webhook must find its funding record.
      const fallbackReference = `fm-${randomUUID()}`;
      await db.transaction(async (q) => {
        await q.query(
          "UPDATE payment_attempts SET status='UNAVAILABLE',error_code='PROVIDER_UNAVAILABLE' WHERE funding_reference=$1",
          [reference],
        );
        await q.query(
          "UPDATE funding SET status=CASE WHEN status='INITIALIZING' THEN 'UNCERTAIN' ELSE status END WHERE id=$1",
          [reference],
        );
        await q.query(
          "INSERT INTO funding(id,user_id,provider,amount_kobo,status,purpose,target_id) VALUES($1,$2,'flutterwave',$3,'INITIALIZING',$4,$5)",
          [fallbackReference, actor.id, input.amount_kobo, purpose, target],
        );
        await q.query(
          'UPDATE funding_intents SET current_reference=$1,updated_at=now() WHERE actor_id=$2 AND key=$3 AND current_reference=$4',
          [fallbackReference, actor.id, identity.key, reference],
        );
        await q.query(
          "INSERT INTO payment_attempts(id,funding_reference,provider,status) VALUES($1,$2,'flutterwave','INITIALIZING')",
          [randomUUID(), fallbackReference],
        );
      });
      reference = fallbackReference;
      provider = 'flutterwave';
      url = await payments.initialize(
        provider,
        reference,
        input.amount_kobo,
        // Card providers need an email; phone-only accounts use a stand-in address.
        actor.email || `${String(actor.phone).replace(/\D/g, '')}@phone.ahiamarketplace.com`,
        actor.name,
        { cardOnly: input.method === 'card' },
      );
    }
    const response: FundingCheckout = {
      reference,
      checkout_url: url,
      provider,
      fallback_used: provider !== input.provider,
    };
    await db.transaction(async (q) => {
      await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
      await q.query(
        "UPDATE funding SET checkout_url=$1,status=CASE WHEN status='INITIALIZING' THEN 'PENDING' ELSE status END WHERE id=$2",
        [url, reference],
      );
      await q.query(
        "UPDATE payment_attempts SET status='INITIALIZED',error_code=NULL WHERE funding_reference=$1",
        [reference],
      );
      await q.query(
        "UPDATE funding_intents SET status='READY',response=$1,error=NULL,updated_at=now() WHERE actor_id=$2 AND key=$3",
        [JSON.stringify(response), actor.id, identity.key],
      );
      await q.prisma.idempotencyKey.update({
        where: { actor_id_key: { actor_id: actor.id, key: identity.key } },
        data: { response: { ...response } },
      });
    });
    return response;
  } catch (error) {
    const failure: FundingFailure =
      error instanceof AppError
        ? { status: error.status, code: error.code, message: error.message }
        : { status: 503, code: 'FUNDING_UNCERTAIN', message: uncertain.message };
    const ambiguous = !(error instanceof AppError) || error.code === 'PROVIDER_UNAVAILABLE';
    // If the final commit failed after receiving a URL, leave a durable, reviewable reference.
    // A committed READY intent must never be overwritten by an ambiguous commit acknowledgement.
    await db
      .transaction(async (q) => {
        await q.query(
          "UPDATE funding_intents SET status=$1,error=$2,updated_at=now() WHERE actor_id=$3 AND key=$4 AND status NOT IN ('READY')",
          [ambiguous ? 'UNCERTAIN' : 'FAILED', JSON.stringify(failure), actor.id, identity.key],
        );
        await q.query("UPDATE funding SET status=$1 WHERE id=$2 AND status='INITIALIZING'", [
          ambiguous ? 'UNCERTAIN' : 'FAILED',
          reference,
        ]);
        await q.query(
          "UPDATE payment_attempts SET status=$1,error_code=$2 WHERE funding_reference=$3 AND status='INITIALIZING'",
          [ambiguous ? 'UNCERTAIN' : 'FAILED', failure.code, reference],
        );
      })
      .catch(() => {});
    return fail(failure);
  }
}
