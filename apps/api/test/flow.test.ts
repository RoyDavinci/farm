import 'dotenv/config';
import { createHash,createHmac,randomUUID } from 'node:crypto';
import { mkdtempSync,readdirSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { connect,type Database } from '../src/database/client.js';
import { expireReservations } from '../src/services/booking.service.js';
import { recoverFunding } from '../src/services/funding-recovery.service.js';
import { deliverPush } from '../src/services/push.service.js';
let db: Database;
let app: ReturnType<typeof createApp>;
const mailDir = mkdtempSync(join(tmpdir(), 'fm-test-'));
const c = {
  ...config,
  dataDir: mailDir,
  mailMode: 'file' as const,
  rateLimitPerMinute: 100000,
  authRateLimit: 100000,
  production: false,
  demo: true,
  payments: true,
  paystack: 'sk_test_example',
  flutterwave: 'FLWSECK_TEST',
  flutterwaveWebhook: 'test-webhook-secret',
};
const actors = ['seller', 'buyer', 'other', 'admin'] as const;
function call(
  actor: (typeof actors)[number],
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  body?: any,
  key = randomUUID(),
) {
  const r = request(app)
    [method](`/v1${path}`)
    .set('Authorization', `Bearer token-${actor}`)
    .set('Idempotency-Key', key);
  return body === undefined ? r : r.send(body);
}
beforeAll(async () => {
  db = connect(process.env.TEST_DATABASE_URL!);
  app = createApp(db, c);
}, 30000);
beforeEach(async () => {
  await db.transaction(async (q) => {
    const tables = await q.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','settings','vehicle_types')",
    );
    await q.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} CASCADE`);
    await q.query(
      'UPDATE settings SET reservation_hours=168,commission_bps=500,payout_min_kobo=100000,payout_fee_kobo=5000',
    );
    for (const [i, actor] of actors.entries()) {
      await q.query(
        'INSERT INTO users(id,name,email,phone,password_hash,admin,staff_role) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          actor,
          actor,
          `${actor}@test.com`,
          `+234800000000${i}`,
          'unused',
          actor === 'admin',
          actor === 'admin' ? 'owner' : null,
        ],
      );
      await q.query('INSERT INTO sessions VALUES($1,$2,$3)', [
        createHash('sha256').update(`token-${actor}`).digest('hex'),
        actor,
        new Date(Date.now() + 86400000),
      ]);
    }
  });
});
afterEach(() => vi.unstubAllGlobals());
/** Reads the code from the newest development email (file mail mode). */
function latestCode() {
  const folder = join(mailDir, 'mail');
  const newest = readdirSync(folder).sort().at(-1)!;
  return /code is (\d{6})/.exec(readFileSync(join(folder, newest), 'utf8'))![1];
}
afterAll(async () => {
  await db.close();
});
async function setup(stock = 10) {
  expect(
    (
      await call('seller', 'post', '/sellers', {
        business_name: 'Ada’s Farm',
        business_type: 'home_based',
        city: 'Lagos',
        area: 'Ikorodu',
        address: 'PRIVATE 12 Harvest Lane',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call('admin', 'post', '/admin/sellers/seller/review', {
        status: 'APPROVED',
        reason: 'Identity and collection location checked',
      })
    ).status,
  ).toBe(200);
  const response = await call('seller', 'post', '/listings', {
    title: 'Fresh tomatoes',
    description: 'Fresh ripe tomatoes from the farm',
    category: 'Vegetables',
    unit: 'kg',
    price_kobo: 100000,
    stock,
  });
  expect(response.status).toBe(200);
  return response.body.id as string;
}
async function book(listing: string, actor: 'buyer' | 'other' = 'buyer', quantity = 2) {
  const r = await call(actor, 'post', '/bookings', {
    listing_id: listing,
    quantity,
  });
  expect(r.status).toBe(200);
  return r.body.id as string;
}
async function accepted() {
  const l = await setup();
  const b = await book(l);
  expect((await call('seller', 'post', `/bookings/${b}/accept`)).status).toBe(200);
  return { l, b };
}
async function funded(b: string) {
  await call('buyer', 'post', '/wallet/demo-fund', { amount_kobo: 1000000 });
  expect((await call('buyer', 'post', `/bookings/${b}/pay`)).status).toBe(200);
}
describe('seller registration to pickup confirmation', () => {
  it('registers and authenticates a real account without granting admin or seller approval', async () => {
    const data = {
      name: 'New Grower',
      email: 'NEW@TEST.COM',
      phone: '+2348091234567',
      password: 'correct-horse-123',
      admin: true,
    };
    const reg = await request(app).post('/v1/auth/register').send(data);
    expect(reg.status).toBe(202);
    expect(reg.body.code).toBeUndefined();
    const wrong = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: reg.body.challenge_id, code: '000000' });
    expect(wrong.status).toBe(400);
    const verified = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: reg.body.challenge_id, code: latestCode() });
    expect(verified.status).toBe(200);
    expect(verified.body.user.admin).toBe(false);
    expect(verified.body.user.email).toBe('new@test.com');
    expect(verified.body.user.password_hash).toBeUndefined();
    // Skip the one-minute resend cooldown for the sign-in code.
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    const challenge = await request(app)
      .post('/v1/auth/login')
      .send({ email: data.email, password: data.password });
    expect(challenge.status).toBe(202);
    const login = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: challenge.body.challenge_id, code: latestCode() });
    expect(login.status).toBe(200);
    expect(
      (await request(app).get('/v1/me').set('Authorization', `Bearer ${login.body.token}`)).body
        .seller,
    ).toBeNull();
    await request(app).post('/v1/auth/logout').set('Authorization', `Bearer ${login.body.token}`);
    expect(
      (await request(app).get('/v1/me').set('Authorization', `Bearer ${login.body.token}`)).status,
    ).toBe(401);
  });
  it('requires admin approval, rejects role escalation, and protects private seller addresses', async () => {
    await call('seller', 'post', '/sellers', {
      business_name: 'Private farm',
      business_type: 'home_based',
      city: 'Lagos',
      area: 'Ikeja',
      address: 'PRIVATE ADDRESS 123',
    });
    expect(
      (
        await call('seller', 'post', '/listings', {
          title: 'Fresh yams',
          description: 'Fresh produce',
          category: 'Tubers',
          unit: 'kg',
          price_kobo: 50000,
          stock: 5,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('buyer', 'post', '/admin/sellers/seller/review', {
          status: 'APPROVED',
          reason: 'attempted bypass',
        })
      ).status,
    ).toBe(403);
    expect((await call('buyer', 'get', '/listings')).body).toEqual([]);
  });
  it('completes the entire flow with one-week reservation, wallet payment, 5% commission and balanced ledger', async () => {
    const { l, b } = await accepted();
    const buyer = (await call('buyer', 'get', `/bookings/${b}`)).body;
    expect(buyer.pickup_address).toContain('PRIVATE');
    expect(buyer.pickup_code).toMatch(/^\d{6}$/);
    expect(new Date(buyer.reserved_until).getTime() - Date.now()).toBeGreaterThan(167.99 * 3600000);
    expect((await call('seller', 'get', `/bookings/${b}`)).body.pickup_code).toBeUndefined();
    expect(JSON.stringify((await call('other', 'get', '/listings')).body)).not.toContain('PRIVATE');
    await funded(b);
    await call('seller', 'post', `/bookings/${b}/ready`);
    const pickup = await call('seller', 'post', `/bookings/${b}/pickup`, {
      code: buyer.pickup_code,
    });
    expect(pickup.status).toBe(200);
    const completed = (await call('buyer', 'get', `/bookings/${b}`)).body;
    expect(completed.status).toBe('COMPLETED');
    expect(completed.pickup_address).toBeUndefined();
    expect(completed.pickup_code).toBeUndefined();
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(800000);
    expect((await call('seller', 'get', '/wallet')).body.seller_payable_kobo).toBe(190000);
    expect(
      (
        await db.query(
          "SELECT SUM(amount_kobo)::int AS total FROM ledger WHERE account='platform_revenue'",
        )
      )[0].total,
    ).toBe(10000);
    expect(
      await db.query('SELECT txn_id FROM ledger GROUP BY txn_id HAVING SUM(amount_kobo) != 0'),
    ).toEqual([]);
    expect((await db.query('SELECT stock FROM listings WHERE id=$1', [l]))[0].stock).toBe(8);
    expect(
      (await call('buyer', 'get', `/bookings/${b}/events`)).body.map((e: any) => e.to_status),
    ).toEqual(['REQUESTED', 'ACCEPTED', 'READY_FOR_PICKUP', 'COMPLETED']);
  });
  it('replays mutations without duplicate bookings or charges and rejects mismatched keys', async () => {
    const l = await setup();
    const key = randomUUID();
    const data = { listing_id: l, quantity: 2 };
    const one = await call('buyer', 'post', '/bookings', data, key);
    const two = await call('buyer', 'post', '/bookings', data, key);
    expect(two.body).toEqual(one.body);
    expect((await call('buyer', 'post', '/bookings', { ...data, quantity: 3 }, key)).status).toBe(
      409,
    );
    const b = one.body.id;
    await call('seller', 'post', `/bookings/${b}/accept`);
    await call('buyer', 'post', '/wallet/demo-fund', { amount_kobo: 500000 });
    const payKey = randomUUID();
    await Promise.all([
      call('buyer', 'post', `/bookings/${b}/pay`, {}, payKey),
      call('buyer', 'post', `/bookings/${b}/pay`, {}, payKey),
    ]);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(300000);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM bookings'))[0].n).toBe(1);
  });
  it('does not oversell the last stock when two buyers are accepted together', async () => {
    const l = await setup(3);
    const a = await book(l, 'buyer', 3),
      b = await book(l, 'other', 3);
    const results = await Promise.all([
      call('seller', 'post', `/bookings/${a}/accept`),
      call('seller', 'post', `/bookings/${b}/accept`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.query('SELECT stock FROM listings WHERE id=$1', [l]))[0].stock).toBe(0);
  });
  it('returns stock and wallet funds exactly once when a paid reservation expires', async () => {
    const { l, b } = await accepted();
    await funded(b);
    await db.query('UPDATE bookings SET reserved_until=$1 WHERE id=$2', [
      new Date(Date.now() - 1000),
      b,
    ]);
    await expireReservations(db);
    await expireReservations(db);
    const order = (await call('buyer', 'get', `/bookings/${b}`)).body;
    expect(order.status).toBe('EXPIRED');
    expect(order.pickup_address).toBeUndefined();
    expect(order.paid).toBe(false);
    expect((await db.query('SELECT stock FROM listings WHERE id=$1', [l]))[0].stock).toBe(10);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(1000000);
  });
  it('refunds cancelled bookings and preserves the price and fee quoted at booking', async () => {
    const { l, b } = await accepted();
    await funded(b);
    await call('admin', 'put', '/admin/settings', {
      reservation_hours: 24,
      commission_bps: 1000,
    });
    await call('seller', 'patch', `/listings/${l}`, { price_kobo: 200000 });
    const quote = (await call('buyer', 'get', `/bookings/${b}`)).body;
    expect(quote.price_kobo).toBe(100000);
    expect(quote.commission_bps).toBe(500);
    await call('buyer', 'post', `/bookings/${b}/cancel`);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(1000000);
    expect((await call('buyer', 'post', `/bookings/${b}/cancel`)).status).toBe(409);
  });
  it('enforces ownership, payment, state transitions and persistent pickup attempt lockout', async () => {
    const { b } = await accepted();
    expect((await call('other', 'get', `/bookings/${b}`)).status).toBe(404);
    expect((await call('buyer', 'post', `/bookings/${b}/ready`)).status).toBe(403);
    expect((await call('buyer', 'post', `/bookings/${b}/pay`)).status).toBe(409);
    await call('seller', 'post', `/bookings/${b}/ready`);
    expect(
      (
        await call('seller', 'post', `/bookings/${b}/pickup`, {
          code: '000000',
        })
      ).body.error.code,
    ).toBe('PAYMENT_REQUIRED');
    await funded(b);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await call('seller', 'post', `/bookings/${b}/pickup`, {
            code: '000000',
          })
        ).status,
      ).toBe(400);
    const code = (await call('buyer', 'get', `/bookings/${b}`)).body.pickup_code;
    expect((await call('seller', 'post', `/bookings/${b}/pickup`, { code })).status).toBe(429);
    expect(
      (await db.query('SELECT pickup_failures FROM bookings WHERE id=$1', [b]))[0].pickup_failures,
    ).toBe(5);
  });
  it('verifies provider payments server-side, rejects forged callbacks and credits only once', async () => {
    const fake = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: { authorization_url: 'https://checkout.paystack.com/test' },
      }),
    });
    vi.stubGlobal('fetch', fake);
    const start = await call('buyer', 'post', '/wallet/fund', {
      provider: 'paystack',
      amount_kobo: 100000,
    });
    expect(start.status).toBe(200);
    const ref = start.body.reference;
    const payload = { event: 'charge.success', data: { reference: ref } };
    const body = JSON.stringify(payload);
    const signature = createHmac('sha512', c.paystack).update(body).digest('hex');
    expect(
      (
        await request(app)
          .post('/v1/webhooks/paystack')
          .set('x-paystack-signature', 'forged')
          .send(payload)
      ).status,
    ).toBe(401);
    fake.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          id: 123,
          reference: ref,
          status: 'success',
          amount: 99999,
          currency: 'NGN',
        },
      }),
    });
    expect(
      (
        await request(app)
          .post('/v1/webhooks/paystack')
          .set('x-paystack-signature', signature)
          .set('Content-Type', 'application/json')
          .send(body)
      ).status,
    ).toBe(409);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(0);
    fake.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          id: 123,
          reference: ref,
          status: 'success',
          amount: 100000,
          currency: 'NGN',
        },
      }),
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(app)
            .post('/v1/webhooks/paystack')
            .set('x-paystack-signature', signature)
            .set('Content-Type', 'application/json')
            .send(body)
        ).status,
      ).toBe(200);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(100000);
  });
  it('supports Flutterwave checkout and raw-body HMAC callbacks without trusting redirect values', async () => {
    const fake = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { link: 'https://checkout.flutterwave.com/test' },
      }),
    });
    vi.stubGlobal('fetch', fake);
    const start = await call('buyer', 'post', '/wallet/fund', {
      provider: 'flutterwave',
      amount_kobo: 150000,
    });
    expect(start.status).toBe(200);
    const ref = start.body.reference;
    fake.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          id: 987,
          tx_ref: ref,
          status: 'successful',
          amount: 1500,
          currency: 'NGN',
        },
      }),
    });
    const body = JSON.stringify({
      event: 'charge.completed',
      data: { tx_ref: ref },
    });
    const sig = createHmac('sha256', c.flutterwaveWebhook).update(body).digest('base64');
    const response = await request(app)
      .post('/v1/webhooks/flutterwave')
      .set('flutterwave-signature', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(response.status).toBe(200);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(150000);
  });
  it('disables development funding in a production configuration', async () => {
    const production = createApp(db, { ...c, production: true, demo: false });
    const r = await request(production)
      .post('/v1/wallet/demo-fund')
      .set('Authorization', 'Bearer token-buyer')
      .set('Idempotency-Key', randomUUID())
      .send({ amount_kobo: 100000 });
    expect(r.status).toBe(404);
  });
});
async function completedSale() {
  const { b } = await accepted();
  await funded(b);
  expect((await call('seller', 'post', `/bookings/${b}/ready`)).status).toBe(200);
  const [row] = await db.query('SELECT pickup_code FROM bookings WHERE id=$1', [b]);
  expect(
    (await call('seller', 'post', `/bookings/${b}/pickup`, { code: row.pickup_code })).status,
  ).toBe(200);
  return b;
}
async function ledgerBalances() {
  const [r] = await db.query('SELECT COALESCE(SUM(amount_kobo),0)::text AS total FROM ledger');
  return Number(r.total);
}
describe('seller payouts', () => {
  const simulated = () => createApp(db, { ...c, payments: false, demo: true });
  function as(
    target: ReturnType<typeof createApp>,
    actor: string,
    method: 'get' | 'post',
    path: string,
    body?: any,
  ) {
    const r = request(target)
      [method](`/v1${path}`)
      .set('Authorization', `Bearer token-${actor}`)
      .set('Idempotency-Key', randomUUID());
    return body === undefined ? r : r.send(body);
  }
  it('holds proceeds on request, pays out once on approval and records the fee', async () => {
    await completedSale();
    const sim = simulated();
    expect((await as(sim, 'buyer', 'get', '/payouts')).status).toBe(403);
    const account = await as(sim, 'seller', 'post', '/payouts/accounts', {
      bank_code: '058',
      account_number: '0123456789',
    });
    expect(account.status).toBe(200);
    expect(account.body.account_last4).toBe('6789');
    expect(JSON.stringify(account.body)).not.toContain('0123456789');
    const [stored] = await db.query('SELECT account_cipher FROM payout_accounts');
    expect(stored.account_cipher).not.toContain('0123456789');
    expect((await as(sim, 'seller', 'get', '/payouts')).body.available_kobo).toBe(190000);
    expect(
      (await as(sim, 'seller', 'post', '/payouts', { amount_kobo: 190001 })).body.error.code,
    ).toBe('INSUFFICIENT_PROCEEDS');
    expect((await as(sim, 'seller', 'post', '/payouts', { amount_kobo: 5000 })).status).toBe(400);
    const payout = await as(sim, 'seller', 'post', '/payouts', { amount_kobo: 150000 });
    expect(payout.status).toBe(200);
    expect((await as(sim, 'seller', 'get', '/payouts')).body.available_kobo).toBe(40000);
    expect(
      (
        await as(sim, 'seller', 'post', '/payouts/accounts', {
          bank_code: '044',
          account_number: '1111111111',
        })
      ).body.error.code,
    ).toBe('PAYOUT_IN_PROGRESS');
    expect(
      (await as(sim, 'seller', 'post', `/admin/payouts/${payout.body.id}/approve`)).status,
    ).toBe(403);
    const approved = await as(sim, 'admin', 'post', `/admin/payouts/${payout.body.id}/approve`);
    expect(approved.body.status).toBe('PAID');
    expect(
      (await as(sim, 'admin', 'post', `/admin/payouts/${payout.body.id}/approve`)).status,
    ).toBe(409);
    const [fee] = await db.query(
      "SELECT SUM(amount_kobo)::int AS n FROM ledger WHERE account='platform_revenue' AND reference=$1",
      [payout.body.id],
    );
    expect(fee.n).toBe(5000);
    expect(await ledgerBalances()).toBe(0);
  });
  it('returns funds to proceeds when a payout is rejected or cancelled', async () => {
    await completedSale();
    const sim = simulated();
    await as(sim, 'seller', 'post', '/payouts/accounts', {
      bank_code: '058',
      account_number: '0123456789',
    });
    const first = await as(sim, 'seller', 'post', '/payouts', { amount_kobo: 100000 });
    expect(
      (
        await as(sim, 'admin', 'post', `/admin/payouts/${first.body.id}/reject`, {
          reason: 'Name mismatch',
        })
      ).body.status,
    ).toBe('REJECTED');
    const second = await as(sim, 'seller', 'post', '/payouts', { amount_kobo: 190000 });
    expect((await as(sim, 'seller', 'post', `/payouts/${second.body.id}/cancel`)).status).toBe(200);
    expect((await as(sim, 'seller', 'get', '/payouts')).body.available_kobo).toBe(190000);
    expect(await ledgerBalances()).toBe(0);
  });
  it('sends provider transfers and settles only after server-side verification', async () => {
    await completedSale();
    const fake = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes('/bank?')
          ? { status: true, data: [{ code: '058', name: 'Guaranty Trust Bank' }] }
          : url.includes('/bank/resolve')
            ? { status: true, data: { account_name: 'SELLER ADA' } }
            : url.includes('/transferrecipient')
              ? { status: true, data: { recipient_code: 'RCP_test' } }
              : url.endsWith('/transfer')
                ? { status: true, data: { transfer_code: 'TRF_test', status: 'pending' } }
                : { status: true, data: { status: 'success', amount: 145000 } },
    }));
    vi.stubGlobal('fetch', fake);
    await call('seller', 'post', '/payouts/accounts', {
      bank_code: '058',
      account_number: '0123456789',
    });
    const payout = await call('seller', 'post', '/payouts', { amount_kobo: 150000 });
    const approved = await call('admin', 'post', `/admin/payouts/${payout.body.id}/approve`);
    expect(approved.body.status).toBe('PROCESSING');
    const body = JSON.stringify({ event: 'transfer.success', data: { reference: payout.body.id } });
    const forged = await request(app)
      .post('/v1/webhooks/paystack')
      .set('x-paystack-signature', 'bad')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(forged.status).toBe(401);
    const signature = createHmac('sha512', c.paystack).update(body).digest('hex');
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(app)
            .post('/v1/webhooks/paystack')
            .set('x-paystack-signature', signature)
            .set('Content-Type', 'application/json')
            .send(body)
        ).status,
      ).toBe(200);
    const [p] = await db.query('SELECT status FROM payouts WHERE id=$1', [payout.body.id]);
    expect(p.status).toBe('PAID');
    expect(fake.mock.calls.some(([url]) => String(url).includes('/transfer/verify/'))).toBe(true);
    expect(await ledgerBalances()).toBe(0);
  });
});

describe('push notifications', () => {
  it('registers device tokens, sends queued booking alerts and disables dead tokens', async () => {
    expect(
      (await call('seller', 'put', '/me/push-tokens', { token: 'not-a-token', platform: 'ios' }))
        .status,
    ).toBe(400);
    for (const token of ['ExponentPushToken[seller-phone]', 'ExponentPushToken[old-tablet]'])
      expect(
        (await call('seller', 'put', '/me/push-tokens', { token, platform: 'android' })).status,
      ).toBe(200);
    const listing = await setup();
    await book(listing);
    const send = vi.fn(async (_url: any, init: any) => {
      const messages = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          data: messages.map((m: any) =>
            m.to.includes('old-tablet')
              ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
              : { status: 'ok', id: 'ticket' },
          ),
        }),
      } as any;
    });
    await deliverPush(db, c, send as any);
    const sent = send.mock.calls.flatMap(([, init]: any) => JSON.parse(init.body));
    const toSeller = sent.filter((m: any) => m.to.includes('seller-phone'));
    const requested = toSeller.find((m: any) => m.title === 'Booking requested');
    expect(requested.data.booking_id).toBeTruthy();
    const [dead] = await db.query(
      "SELECT disabled_at FROM push_tokens WHERE token LIKE '%old-tablet%'",
    );
    expect(dead.disabled_at).not.toBeNull();
    const [pending] = await db.query(
      "SELECT COUNT(*)::int AS n FROM push_outbox WHERE status='PENDING'",
    );
    expect(pending.n).toBe(0);
    await call('seller', 'put', '/notification-preferences', {
      email_enabled: true,
      push_enabled: false,
    });
    await book(listing, 'other');
    send.mockClear();
    await deliverPush(db, c, send as any);
    expect(send).not.toHaveBeenCalled();
  });
});
describe('retention', () => {
  it('alerts waiting buyers once when stock returns and tells followers about new listings', async () => {
    const listing = await setup(2);
    await call('buyer', 'put', '/favourites/seller');
    const b = await book(listing, 'other', 2);
    expect((await call('seller', 'post', `/bookings/${b}/accept`)).status).toBe(200);
    const view = await call('buyer', 'get', `/listings/${listing}`);
    expect(view.status).toBe(200);
    expect(view.body.in_stock).toBe(false);
    expect((await call('buyer', 'put', `/listings/${listing}/stock-alert`)).status).toBe(200);
    expect((await call('buyer', 'get', `/listings/${listing}`)).body.stock_alert).toBe(true);
    expect((await call('seller', 'put', `/listings/${listing}/stock-alert`)).status).toBe(400);
    // Cancelling the reservation returns stock and fires the alert exactly once.
    expect((await call('other', 'post', `/bookings/${b}/cancel`)).status).toBe(200);
    await call('seller', 'patch', `/listings/${listing}`, { stock: 9 });
    const alerts = await db.query(
      "SELECT title FROM notifications WHERE user_id='buyer' AND title='Back in stock'",
    );
    expect(alerts).toHaveLength(1);
    expect((await call('buyer', 'get', `/listings/${listing}`)).body.stock_alert).toBe(false);
    await call('seller', 'post', '/listings', {
      title: 'Sweet pineapples',
      description: 'Juicy and ripe pineapples',
      category: 'Fruit',
      unit: 'piece',
      price_kobo: 80000,
      stock: 4,
    });
    const news = await db.query(
      "SELECT body FROM notifications WHERE user_id='buyer' AND title LIKE 'New from%'",
    );
    expect(news[0].body).toContain('Sweet pineapples');
    expect((await call('buyer', 'get', '/sellers/seller/listings')).body).toHaveLength(2);
  });
  it('reports seller sales analytics from confirmed pickups only', async () => {
    await completedSale();
    expect((await call('buyer', 'get', '/sellers/me/analytics')).status).toBe(403);
    const a = await call('seller', 'get', '/sellers/me/analytics?days=30');
    expect(a.status).toBe(200);
    expect(a.body.orders).toBe(1);
    expect(a.body.gross_kobo).toBe(200000);
    expect(a.body.net_kobo).toBe(190000);
    expect(a.body.acceptance_rate).toBe(1);
    expect(a.body.daily.at(-1).gross_kobo).toBe(200000);
    expect(a.body.top_listings[0].title).toBe('Fresh tomatoes');
  });
});
describe('staff roles, verification documents, promotions and pre-orders', () => {
  it('limits staff to the areas their role allows and protects the last owner', async () => {
    await db.query("UPDATE users SET admin=TRUE,staff_role='finance' WHERE id='other'");
    expect((await call('other', 'get', '/admin/payouts')).status).toBe(200);
    expect((await call('other', 'get', '/admin/sellers')).body.error.code).toBe('ROLE_FORBIDDEN');
    expect((await call('other', 'get', '/admin/reports')).status).toBe(403);
    expect(
      (await call('other', 'put', '/admin/settings', { reservation_hours: 1, commission_bps: 0 }))
        .status,
    ).toBe(403);
    expect((await call('other', 'get', '/me')).body.staff_areas).toContain('payouts');
    expect(
      (
        await call('other', 'post', '/admin/staff', {
          email: 'buyer@test.com',
          role: 'owner',
          reason: 'escalate',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('admin', 'post', '/admin/staff', {
          email: 'buyer@test.com',
          role: 'support',
          reason: 'New support hire',
        })
      ).body.staff_role,
    ).toBe('support');
    expect((await call('admin', 'get', '/admin/staff')).body).toHaveLength(3);
    expect(
      (
        await call('admin', 'post', '/admin/staff', {
          email: 'admin@test.com',
          role: null,
          reason: 'leaving',
        })
      ).body.error.code,
    ).toBe('LAST_OWNER');
  });
  it('stores seller documents privately and lets operations review them', async () => {
    await call('seller', 'post', '/sellers', {
      business_name: 'Doc Farm',
      business_type: 'farm',
      city: 'Kano',
      area: 'Nassarawa',
      address: '1 Farm Road, Kano',
    });
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const upload = await request(app)
      .post('/v1/sellers/me/documents')
      .set('Authorization', 'Bearer token-seller')
      .field('kind', 'government_id')
      .attach('file', pdf, { filename: 'id.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    const fake = await request(app)
      .post('/v1/sellers/me/documents')
      .set('Authorization', 'Bearer token-seller')
      .field('kind', 'other')
      .attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const mine = await call('seller', 'get', '/sellers/me/documents');
    expect(mine.body[0].storage_key).toBeUndefined();
    expect((await call('buyer', 'get', '/admin/seller-documents?seller_id=seller')).status).toBe(
      403,
    );
    const link = await call('admin', 'get', `/admin/seller-documents/${upload.body.id}/link`);
    const url = new URL(link.body.url);
    const file = await request(app).get(url.pathname + url.search);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(
      (await request(app).get(url.pathname + url.search.replace(/sig=../, 'sig=00'))).status,
    ).toBe(403);
    const review = await call('admin', 'post', `/admin/seller-documents/${upload.body.id}/review`, {
      status: 'REJECTED',
      note: 'Photo is blurred',
    });
    expect(review.body.status).toBe('REJECTED');
  });
  it('charges promotions to seller proceeds, labels them in search and refunds unused days', async () => {
    const sale = await completedSale();
    const [{ listing_id: listing }] = await db.query(
      'SELECT listing_id FROM bookings WHERE id=$1',
      [sale],
    );
    expect(
      (await call('seller', 'post', `/listings/${listing}/promote`, { days: 60 })).body.error.code,
    ).toBe('INSUFFICIENT_PROCEEDS');
    const promo = await call('seller', 'post', `/listings/${listing}/promote`, { days: 3 });
    expect(promo.status).toBe(200);
    expect(Number(promo.body.fee_kobo)).toBe(150000);
    expect((await call('seller', 'post', `/listings/${listing}/promote`, { days: 1 })).status).toBe(
      409,
    );
    const search = await call('buyer', 'get', '/search');
    expect(search.body.sponsored.map((l: any) => l.id)).toEqual([listing]);
    expect(search.body.sponsored[0].sponsored).toBe(true);
    const cancel = await call('admin', 'post', `/admin/promotions/${promo.body.id}/cancel`, {
      reason: 'Misleading photo',
    });
    expect(Number(cancel.body.refund_kobo)).toBe(100000);
    expect((await call('buyer', 'get', '/search')).body.sponsored).toEqual([]);
    expect((await call('seller', 'get', '/wallet')).body.seller_payable_kobo).toBe(
      190000 - 150000 + 100000,
    );
    expect(await ledgerBalances()).toBe(0);
  });
  it('takes pre-orders against harvest capacity and starts the hold from the harvest date', async () => {
    const listing = await setup(0);
    const harvest = new Date(Date.now() + 10 * 86400000).toISOString();
    expect((await call('buyer', 'get', '/search')).body.items).toHaveLength(0);
    expect(
      (
        await call('seller', 'patch', `/listings/${listing}`, {
          available_from: harvest,
          preorder_capacity: 5,
        })
      ).status,
    ).toBe(200);
    expect((await call('buyer', 'get', '/search')).body.items).toHaveLength(1);
    expect(
      (await call('buyer', 'post', '/bookings', { listing_id: listing, quantity: 6 })).status,
    ).toBe(409);
    const b = await book(listing, 'buyer', 4);
    const other = await book(listing, 'other', 2);
    expect((await call('seller', 'post', `/bookings/${b}/accept`)).status).toBe(200);
    expect((await call('seller', 'post', `/bookings/${other}/accept`)).body.error.code).toBe(
      'OUT_OF_STOCK',
    );
    const [row] = await db.query('SELECT preorder,reserved_until FROM bookings WHERE id=$1', [b]);
    expect(row.preorder).toBe(true);
    expect(new Date(row.reserved_until).getTime()).toBeGreaterThan(new Date(harvest).getTime());
    const [cap] = await db.query('SELECT preorder_capacity FROM listings WHERE id=$1', [listing]);
    expect(cap.preorder_capacity).toBe(1);
    expect((await call('buyer', 'post', `/bookings/${b}/cancel`)).status).toBe(200);
    const [restored] = await db.query('SELECT preorder_capacity FROM listings WHERE id=$1', [
      listing,
    ]);
    expect(restored.preorder_capacity).toBe(5);
    const [variant] = await db.query('SELECT stock FROM listing_variants WHERE listing_id=$1', [
      listing,
    ]);
    expect(variant.stock).toBe(0);
  });
});
describe('delivery network', () => {
  const drop = { latitude: 6.6, longitude: 3.36 };
  async function readyForDelivery(pay = true) {
    const { b } = await accepted();
    await db.query('UPDATE sellers SET latitude=6.55,longitude=3.35 WHERE user_id=$1', ['seller']);
    if (pay) await funded(b);
    else await call('buyer', 'post', '/wallet/demo-fund', { amount_kobo: 1000000 });
    await call('other', 'post', '/drivers', {
      vehicle_type: 'motorcycle',
      plate_number: 'lag-123-xy',
      licence_number: 'ABC12345',
      city: 'Lagos',
    });
    await call('admin', 'post', '/admin/drivers/other/review', {
      status: 'APPROVED',
      reason: 'Licence checked',
    });
    expect(
      (
        await call('other', 'put', '/drivers/me/status', {
          online: true,
          latitude: 6.551,
          longitude: 3.351,
        })
      ).status,
    ).toBe(200);
    const quote = await call('buyer', 'post', `/bookings/${b}/delivery/quote`, {
      vehicle_type: 'motorcycle',
      dropoff: drop,
    });
    expect(quote.status).toBe(200);
    return { b, quote: quote.body };
  }
  it('never fails when a buyer cancels while a driver claims the same delivery', async () => {
    const { b, quote } = await readyForDelivery();
    const d = await call('buyer', 'post', `/bookings/${b}/delivery`, {
      vehicle_type: 'motorcycle',
      dropoff: drop,
      dropoff_address: '14 Allen Avenue, Ikeja, Lagos',
      expected_fare_kobo: quote.fare_kobo,
    });
    const [cancel, claim] = await Promise.all([
      call('buyer', 'post', `/bookings/${b}/cancel`),
      call('other', 'post', `/deliveries/${d.body.id}/claim`),
    ]);
    // One wins; the other gets a clean business error, never a 500.
    expect([cancel.status, claim.status].every((s) => s < 500)).toBe(true);
    const [row] = await db.query('SELECT status FROM bookings WHERE id=$1', [b]);
    expect(row.status).toBe('CANCELLED');
    const [delivery] = await db.query('SELECT status FROM deliveries WHERE id=$1', [d.body.id]);
    expect(delivery.status).toBe('CANCELLED');
    expect(await ledgerBalances()).toBe(0);
  });
  it('delivers a prepaid order with PIN handover and pays the driver', async () => {
    const { b, quote } = await readyForDelivery();
    expect(quote.distance_km).toBeGreaterThan(5);
    const request_ = {
      vehicle_type: 'motorcycle',
      dropoff: drop,
      dropoff_address: '14 Allen Avenue, Ikeja, Lagos',
      expected_fare_kobo: quote.fare_kobo,
    };
    expect(
      (
        await call('buyer', 'post', `/bookings/${b}/delivery`, {
          ...request_,
          expected_fare_kobo: 1,
        })
      ).body.error.code,
    ).toBe('FARE_CHANGED');
    const delivery = await call('buyer', 'post', `/bookings/${b}/delivery`, request_);
    expect(delivery.status).toBe(200);
    expect(delivery.body.pickup_pin).toBeUndefined();
    const jobs = await call('other', 'get', '/drivers/me/jobs');
    expect(jobs.body.open).toHaveLength(1);
    expect(jobs.body.open[0].dropoff_address).toBeUndefined();
    const claim = await call('other', 'post', `/deliveries/${delivery.body.id}/claim`);
    expect(claim.body.pickup_pin).toMatch(/^\d{6}$/);
    expect(
      (await call('buyer', 'post', `/bookings/${b}/pickup`, { code: '123456' })).body.error.code,
    ).toBe('DELIVERY_IN_PROGRESS');
    expect(
      (await call('seller', 'post', `/deliveries/${delivery.body.id}/handover`, { pin: '000000' }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('seller', 'post', `/deliveries/${delivery.body.id}/handover`, {
          pin: claim.body.pickup_pin,
        })
      ).body.status,
    ).toBe('PICKED_UP');
    await call('other', 'put', '/drivers/me/status', {
      online: true,
      latitude: 6.58,
      longitude: 3.355,
    });
    const tracking = await call('buyer', 'get', `/bookings/${b}/delivery`);
    expect(tracking.body.driver_latitude).toBe(6.58);
    expect(tracking.body.delivery_pin).toMatch(/^\d{6}$/);
    expect((await call('buyer', 'post', `/bookings/${b}/cancel`)).status).toBe(409);
    const done = await call('other', 'post', `/deliveries/${delivery.body.id}/deliver`, {
      pin: tracking.body.delivery_pin,
    });
    expect(done.body.status).toBe('DELIVERED');
    const [booking] = await db.query('SELECT status FROM bookings WHERE id=$1', [b]);
    expect(booking.status).toBe('COMPLETED');
    const earnings = Math.round(quote.fare_kobo * 0.9);
    expect((await call('other', 'get', '/payouts')).body.available_kobo).toBe(earnings);
    expect(await ledgerBalances()).toBe(0);
  });
  it('supports digital Pay on Delivery only when enabled and refunds fares on cancellation', async () => {
    const { b, quote } = await readyForDelivery(false);
    const body = {
      vehicle_type: 'motorcycle',
      dropoff: drop,
      dropoff_address: '14 Allen Avenue, Ikeja',
      expected_fare_kobo: quote.fare_kobo,
      pay_on_delivery: true,
    };
    expect((await call('buyer', 'post', `/bookings/${b}/delivery`, body)).body.error.code).toBe(
      'POD_DISABLED',
    );
    await db.query('UPDATE settings SET pay_on_delivery_enabled=TRUE');
    const d = await call('buyer', 'post', `/bookings/${b}/delivery`, body);
    expect(d.body.fare_paid).toBe(false);
    const claim = await call('other', 'post', `/deliveries/${d.body.id}/claim`);
    await call('seller', 'post', `/deliveries/${d.body.id}/handover`, {
      pin: claim.body.pickup_pin,
    });
    expect(
      (await call('other', 'post', `/deliveries/${d.body.id}/deliver`, { pin: '111111' })).body
        .error.code,
    ).toBe('PAYMENT_REQUIRED');
    expect(
      (await call('buyer', 'get', `/bookings/${b}/delivery`)).body.delivery_pin,
    ).toBeUndefined();
    expect((await call('buyer', 'post', `/deliveries/${d.body.id}/pay`)).status).toBe(200);
    const pinNow = (await call('buyer', 'get', `/bookings/${b}/delivery`)).body.delivery_pin;
    expect(
      (await call('other', 'post', `/deliveries/${d.body.id}/deliver`, { pin: pinNow })).body
        .status,
    ).toBe('DELIVERED');
    expect(await ledgerBalances()).toBe(0);
    await db.query('UPDATE settings SET pay_on_delivery_enabled=FALSE');
  });
  it('refunds a prepaid fare when the booking is cancelled before collection', async () => {
    const { b, quote } = await readyForDelivery();
    const before = (await call('buyer', 'get', '/wallet')).body.balance_kobo;
    const d = await call('buyer', 'post', `/bookings/${b}/delivery`, {
      vehicle_type: 'motorcycle',
      dropoff: drop,
      dropoff_address: '14 Allen Avenue, Ikeja',
      expected_fare_kobo: quote.fare_kobo,
    });
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(
      before - quote.fare_kobo,
    );
    await call('other', 'post', `/deliveries/${d.body.id}/claim`);
    expect((await call('buyer', 'post', `/bookings/${b}/cancel`)).status).toBe(200);
    const [row] = await db.query('SELECT status FROM deliveries WHERE id=$1', [d.body.id]);
    expect(row.status).toBe('CANCELLED');
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(before + 200000);
    expect(await ledgerBalances()).toBe(0);
  });
});
describe('operations', () => {
  it('pages through the ledger without skipping rows that share a timestamp', async () => {
    await completedSale();
    const all = (await call('admin', 'get', '/admin/ledger?limit=200')).body;
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 20; i++) {
      const page = (await call('admin', 'get', `/admin/ledger?limit=2${cursor}`)).body;
      if (!page.length) break;
      seen.push(...page.map((r: any) => r.id));
      const last = page.at(-1);
      cursor = `&before=${encodeURIComponent(last.cursor)}&before_id=${last.id}`;
    }
    expect(seen).toEqual(all.map((r: any) => r.id));
  });
  it('reports readiness from worker heartbeats', async () => {
    expect((await request(app).get('/health/ready')).status).toBe(503);
    await db.query(
      "INSERT INTO worker_heartbeats(name,beat_at) VALUES('reservation-expiry',now())",
    );
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.backlog.email_late).toBe(0);
  });
});
describe('security and configuration', () => {
  it('sends security headers, request ids and consistent JSON errors', async () => {
    const r = await request(app).get('/v1/nope').set('X-Request-Id', 'test-request-0001');
    expect(r.status).toBe(401);
    expect(r.headers['x-request-id']).toBe('test-request-0001');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['x-powered-by']).toBeUndefined();
    const missing = await call('buyer', 'get', '/does-not-exist');
    expect(missing.body.error.code).toBe('NOT_FOUND');
    const bad = await request(app)
      .post('/v1/bookings')
      .set('Authorization', 'Bearer token-buyer')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(bad.body.error.code).toBe('INVALID_JSON');
  });
  it('allows only configured browser origins', async () => {
    const allowed = await request(app).get('/v1/settings').set('Origin', c.origins[0]);
    expect(allowed.headers['access-control-allow-origin']).toBe(c.origins[0]);
    const blocked = await request(app).get('/v1/settings').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app)
      .options('/v1/bookings')
      .set('Origin', c.origins[0])
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key,authorization');
    expect(preflight.headers['access-control-allow-headers']).toContain('Idempotency-Key');
  });
  it('refuses unsafe production configuration', async () => {
    const { productionProblems, readEnv } = await import('../src/config/env.js');
    const problems = productionProblems(
      readEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'http://localhost:5173' }),
    );
    expect(problems.join(' ')).toMatch(/DATABASE_URL/);
    expect(problems.join(' ')).toMatch(/OTP_SECRET/);
    expect(problems.join(' ')).toMatch(/PAYOUT_ENCRYPTION_KEY/);
    expect(problems.join(' ')).toMatch(/https/);
    expect(() => readEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('funding recovery', () => {
  const paystackOk = (data: object) => ({
    ok: true,
    status: 200,
    json: async () => ({ status: true, data }),
  });
  it('releases interrupted checkouts so a retry gets a clear answer', async () => {
    // The provider never answers, as if the server died mid-checkout.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const key = randomUUID();
    const pending = call(
      'buyer',
      'post',
      '/wallet/fund',
      { provider: 'paystack', amount_kobo: 100000 },
      key,
    );
    void pending.then(
      () => {},
      () => {},
    );
    await new Promise((r) => setTimeout(r, 300));
    const [intent] = await db.query('SELECT current_reference FROM funding_intents');
    expect(intent).toBeTruthy();
    expect(
      (
        await call(
          'buyer',
          'post',
          '/wallet/fund',
          { provider: 'paystack', amount_kobo: 100000 },
          key,
        )
      ).body.error.code,
    ).toBe('FUNDING_IN_PROGRESS');
    await db.query("UPDATE funding_intents SET lease_until=now()-interval '1 second'");
    const result = await recoverFunding(db, c);
    expect(result.released).toBe(1);
    const [f] = await db.query('SELECT status FROM funding WHERE id=$1', [
      intent.current_reference,
    ]);
    expect(f.status).toBe('UNCERTAIN');
    expect(
      (
        await call(
          'buyer',
          'post',
          '/wallet/fund',
          { provider: 'paystack', amount_kobo: 100000 },
          key,
        )
      ).body.error.code,
    ).toBe('FUNDING_UNCERTAIN');
    const wallet = await call('buyer', 'get', '/wallet');
    expect(wallet.body.funding.map((x: any) => x.status)).toContain('UNCERTAIN');
  });
  it('credits a paid top-up whose webhook was lost, exactly once, and expires stale ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => paystackOk({ authorization_url: 'https://checkout.paystack.com/x' })),
    );
    const start = await call('buyer', 'post', '/wallet/fund', {
      provider: 'paystack',
      amount_kobo: 150000,
    });
    expect(start.status).toBe(200);
    await db.query("UPDATE funding SET created_at=now()-interval '5 minutes'");
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        paystackOk({
          status: 'success',
          reference: start.body.reference,
          amount: 150000,
          currency: 'NGN',
          id: 77,
        }),
      ),
    );
    expect((await recoverFunding(db, c)).credited).toBe(1);
    // Checked rows back off, and a forced recheck cannot credit twice.
    await db.query('UPDATE funding SET checked_at=NULL');
    await recoverFunding(db, c);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(150000);
    await db.query(
      "INSERT INTO funding(id,user_id,provider,amount_kobo,status,created_at) VALUES('fm-old','buyer','paystack',5000,'PENDING',now()-interval '4 days')",
    );
    expect((await recoverFunding(db, c)).expired).toBe(1);
    expect(await ledgerBalances()).toBe(0);
  });
});
