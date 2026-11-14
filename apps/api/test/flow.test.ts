import 'dotenv/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { writeFileSync } from 'node:fs';
import { createApp as buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { connect, type Database } from '../src/database/client.js';
import { expireReservations } from '../src/services/booking.service.js';
import { recoverFunding } from '../src/services/funding-recovery.service.js';
import { deliverPush } from '../src/services/push.service.js';
/**
 * Every JSON response is recorded and checked against the published response schemas by the
 * last test. With CONTRACT_CAPTURE=<file> the recordings are also written out (to derive schemas).
 */
const captures: { method: string; path: string; status: number; body: unknown }[] = [];
function createApp(...args: Parameters<typeof buildApp>) {
  const inner = buildApp(...args);
  const outer = express();
  outer.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      captures.push({
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        // Exactly what goes over the wire (dates become strings, BigInts numbers).
        body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
      });
      return json(body);
    };
    next();
  });
  outer.use(inner);
  return outer as unknown as ReturnType<typeof buildApp>;
}
let db: Database;
let app: ReturnType<typeof createApp>;
const mailDir = mkdtempSync(join(tmpdir(), 'fm-test-'));
const c = {
  ...config,
  dataDir: mailDir,
  mailMode: 'file' as const,
  // Tests never call real map services.
  mapboxToken: '',
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
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
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
  if (process.env.CONTRACT_CAPTURE)
    writeFileSync(process.env.CONTRACT_CAPTURE, JSON.stringify(captures));
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
describe('API contract', () => {
  it('keeps openapi.json in step with the mounted routes', async () => {
    const { buildOpenApi, render, specPath } = await import('../scripts/openapi.js');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(specPath, 'utf8')).toBe(render());
    const spec = buildOpenApi();
    const ops = Object.values(spec.paths).flatMap((p) => Object.values(p)) as any[];
    // Every money/order write requires an Idempotency-Key; public routes need no token.
    const op = (path: string, method: string) => (spec.paths as any)[path][method];
    expect(op('/v1/bookings/{id}/{action}', 'post').parameters).toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    });
    expect(op('/v1/wallet/fund', 'post').parameters).toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    });
    expect(op('/v1/auth/login', 'post').security).toEqual([]);
    expect(op('/v1/admin/payouts', 'get').security).toBeUndefined();
    expect(new Set(ops.map((o) => o.operationId)).size).toBe(ops.length);
  });
});
describe('response contract', () => {
  it('returns responses that match the published schemas', async () => {
    const { responses } = await import('../src/contracts/index.js');
    const b = await completedSale();
    const [{ listing_id }] = await db.query('SELECT listing_id FROM bookings WHERE id=$1', [b]);
    const checks: [string, string, string][] = [
      ['buyer', '/me', 'account.getMe'],
      ['seller', '/me', 'account.getMe'],
      ['buyer', '/settings', 'account.getSettings'],
      ['buyer', '/bookings', 'bookings.listBookings'],
      ['seller', `/bookings/${b}`, 'bookings.getBooking'],
      ['buyer', `/bookings/${b}/events`, 'bookings.listBookingEvents'],
      ['seller', '/listings?mine=true', 'marketplace.listListings'],
      ['buyer', `/listings/${listing_id}`, 'retention.getListing'],
      ['buyer', '/sellers/seller/listings', 'retention.listSellerListings'],
      ['buyer', '/search', 'geography.search'],
      ['buyer', '/wallet', 'wallet.getWallet'],
      ['seller', '/payouts', 'payouts.getPayoutSummary'],
      ['buyer', `/bookings/${b}/delivery`, 'deliveries.getBookingDelivery'],
    ];
    for (const [actor, path, operation] of checks) {
      const r = await call(actor as any, 'get', path);
      expect(r.status, `${operation} ${path}`).toBe(200);
      const parsed = responses[operation].safeParse(r.body);
      expect(parsed.success, `${operation}: ${parsed.error?.message}`).toBe(true);
    }
  });
});
describe('contract tour', () => {
  /** Calls every endpoint the other tests don't, asserting success, so each has a smoke test. */
  it('exercises every remaining endpoint successfully', async () => {
    const ok = async (r: any, label: string) => {
      const res = await r;
      expect(res.status, `${label}: ${JSON.stringify(res.body).slice(0, 300)}`).toBeLessThan(300);
      return res.body;
    };
    const sale = await completedSale();
    const [{ listing_id: listing }] = await db.query(
      'SELECT listing_id FROM bookings WHERE id=$1',
      [sale],
    );
    await db.query('UPDATE sellers SET latitude=6.55,longitude=3.35 WHERE user_id=$1', ['seller']);

    // Account
    await ok(
      call('buyer', 'patch', '/me', { name: 'Buyer Renamed', phone: '+2348000000099' }),
      'updateMe',
    );
    await db.query(
      "UPDATE sessions SET refresh_expires_at=now()+interval '1 day',id=gen_random_uuid()::text WHERE user_id='buyer'",
    );
    const sessions = await ok(call('buyer', 'get', '/me/sessions'), 'listSessions');
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at,refresh_expires_at) VALUES('old-device','buyer',now()+interval '1 day',now()+interval '1 day')",
    );
    const old = (await call('buyer', 'get', '/me/sessions')).body.find((s: any) => !s.current);
    expect(sessions.length).toBeGreaterThan(0);
    await ok(call('buyer', 'delete', `/me/sessions/${old.id}`), 'revokeSession');

    // Notifications, messaging, blocks, reports, favourites, reviews
    await ok(call('seller', 'get', '/notifications'), 'listNotifications');
    await ok(call('seller', 'post', '/notifications/read', {}), 'markNotificationsRead');
    await ok(call('seller', 'get', '/notification-preferences'), 'getNotificationPreferences');
    const convo = await ok(
      call('buyer', 'post', '/conversations', { listing_id: listing }),
      'startConversation',
    );
    await ok(
      call('buyer', 'post', `/conversations/${convo.id}/messages`, { body: 'Is it fresh?' }),
      'sendMessage',
    );
    await ok(call('seller', 'get', '/conversations'), 'listConversations');
    await ok(call('seller', 'get', `/conversations/${convo.id}/messages`), 'listMessages');
    await ok(call('seller', 'post', `/conversations/${convo.id}/read`, {}), 'markConversationRead');
    await ok(call('buyer', 'put', '/me/blocks/other'), 'blockUser');
    await ok(call('buyer', 'get', '/me/blocks'), 'listBlocks');
    await ok(call('buyer', 'delete', '/me/blocks/other'), 'unblockUser');
    const report = await ok(
      call('buyer', 'post', '/reports', {
        subject_type: 'listing',
        subject_id: listing,
        reason: 'Photo looks wrong',
      }),
      'createReport',
    );
    await ok(call('admin', 'get', '/admin/reports'), 'listReports');
    await ok(
      call('admin', 'post', `/admin/reports/${report.id}/resolve`, {
        resolution: 'Checked; photo is fine',
      }),
      'resolveReport',
    );
    await ok(call('buyer', 'put', '/favourites/seller'), 'addFavourite');
    await ok(call('buyer', 'get', '/favourites'), 'listFavourites');
    await ok(call('buyer', 'delete', '/favourites/seller'), 'removeFavourite');
    await ok(call('buyer', 'get', '/sellers/seller'), 'getSellerProfile');
    await ok(call('buyer', 'get', `/bookings/${sale}/rating`), 'getRating');
    await ok(
      call('buyer', 'post', `/bookings/${sale}/rating`, { score: 5, comment: 'Lovely tomatoes' }),
      'rateBooking',
    );
    await ok(call('buyer', 'put', `/listings/${listing}/stock-alert`), 'addStockAlert');
    await ok(call('buyer', 'delete', `/listings/${listing}/stock-alert`), 'removeStockAlert');
    await ok(
      call('buyer', 'delete', '/me/push-tokens', { token: 'ExponentPushToken[none]' }),
      'removePushToken',
    );

    // Disputes, evidence and receipts
    await ok(call('buyer', 'get', `/bookings/${sale}/receipt`), 'getReceipt');
    await ok(call('buyer', 'get', `/bookings/${sale}/dispute`), 'getBookingDispute(none)');
    const dispute = await ok(
      call('buyer', 'post', `/bookings/${sale}/dispute`, {
        reason_code: 'DAMAGED',
        description: 'Half the crate was crushed',
      }),
      'openDispute',
    );
    await ok(call('buyer', 'get', `/bookings/${sale}/dispute`), 'getBookingDispute');
    await ok(call('buyer', 'get', '/disputes'), 'listDisputes');
    await ok(call('seller', 'get', `/disputes/${dispute.id}`), 'getDispute');
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3a5' } })
      .png()
      .toBuffer();
    const evidence = await ok(
      request(app)
        .post(`/v1/disputes/${dispute.id}/evidence`)
        .set('Authorization', 'Bearer token-buyer')
        .attach('file', png, 'photo.png'),
      'uploadEvidence',
    );
    await ok(call('buyer', 'get', `/evidence/${evidence.id}/link`), 'getEvidenceLink');
    await ok(call('admin', 'get', '/admin/disputes'), 'listAllDisputes');
    await ok(
      call('admin', 'post', `/disputes/${dispute.id}/return`, { action: 'request' }),
      'updateReturn',
    );
    await ok(
      call('seller', 'post', `/disputes/${dispute.id}/return`, { action: 'received' }),
      'updateReturn(received)',
    );
    await ok(
      call('admin', 'post', `/admin/disputes/${dispute.id}/resolve`, {
        resolution: 'Partial refund for damage',
        refund_kobo: 50000,
      }),
      'resolveDispute',
    );

    // Seller tools, markets, maps, media
    await ok(
      call('admin', 'post', '/admin/markets', {
        name: 'Mile 12 Market',
        city: 'Lagos',
        area: 'Kosofe',
        latitude: 6.6,
        longitude: 3.4,
      }),
      'createMarket',
    );
    await ok(call('seller', 'get', '/markets?city=Lagos'), 'listMarkets');
    await ok(call('seller', 'get', '/maps/config'), 'getMapConfig');
    await ok(
      call('seller', 'patch', '/sellers/me/location', {
        address: '12 Harvest Lane, Ikorodu',
        city: 'Lagos',
        area: 'Ikorodu',
        reason: 'Moved stall',
        latitude: 6.56,
        longitude: 3.36,
      }),
      'updateSellerLocation',
    );
    await db.query("UPDATE sellers SET status='APPROVED' WHERE user_id='seller'");
    await ok(
      request(app)
        .post('/v1/media')
        .set('Authorization', 'Bearer token-seller')
        .attach('image', png, { filename: 'p.png', contentType: 'image/png' }),
      'uploadPhoto',
    );
    await ok(call('seller', 'get', '/sellers/me/promotions'), 'listMyPromotions');
    await ok(call('admin', 'get', '/admin/promotions'), 'listPromotions');
    await ok(call('admin', 'get', '/admin/seller-documents?seller_id=seller'), 'listDocuments');

    // Delivery and drivers
    await ok(call('buyer', 'get', '/delivery/options'), 'getDeliveryOptions');
    await ok(call('other', 'get', '/drivers/me'), 'getMyDriverProfile');
    await ok(call('admin', 'get', '/admin/drivers'), 'listDrivers');
    await ok(call('admin', 'get', '/admin/deliveries'), 'listDeliveries');
    await ok(call('admin', 'get', '/admin/vehicle-types'), 'listVehicleTypes');
    await ok(
      call('admin', 'put', '/admin/vehicle-types/bicycle', {
        name: 'Bicycle',
        base_fare_kobo: 30000,
        per_km_kobo: 10000,
        min_fare_kobo: 50000,
        max_km: 8,
        active: true,
      }),
      'saveVehicleType',
    );

    // Admin console
    for (const path of [
      '/admin/overview',
      '/admin/sellers',
      '/admin/bookings',
      '/admin/listings',
      '/admin/reconciliation',
      '/admin/audit',
      '/admin/email-queue',
      '/admin/users',
    ])
      await ok(call('admin', 'get', path), path);
    await ok(
      call('admin', 'post', `/admin/listings/${listing}/moderate`, {
        status: 'PAUSED',
        reason: 'Checking photos',
      }),
      'moderateListing',
    );
    const [job] = await db.query(
      "UPDATE notification_outbox SET status='FAILED' WHERE id=(SELECT id FROM notification_outbox LIMIT 1) RETURNING id",
    );
    await ok(call('admin', 'post', `/admin/email-queue/${job.id}/retry`, {}), 'retryEmail');
    await ok(
      call('admin', 'post', '/admin/users/other/status', {
        status: 'SUSPENDED',
        reason: 'Testing suspension',
      }),
      'setUserStatus',
    );

    // Payouts in simulated mode
    const sim = createApp(db, { ...c, payments: false, demo: true });
    const simCall = (path: string, body?: any) =>
      (body ? request(sim).post(`/v1${path}`).send(body) : request(sim).get(`/v1${path}`))
        .set('Authorization', 'Bearer token-seller')
        .set('Idempotency-Key', randomUUID());
    await ok(simCall('/payouts/banks'), 'listBanks');
    await ok(
      simCall('/payouts/accounts/resolve', { bank_code: '058', account_number: '0123456789' }),
      'resolveAccount',
    );

    // Auth: forgot password, resend code, refresh session
    await ok(
      request(app).post('/v1/auth/password/forgot').send({ email: 'buyer@test.com' }),
      'forgotPassword',
    );
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    const [otp] = await db.query('SELECT id FROM otp_challenges ORDER BY created_at DESC LIMIT 1');
    await ok(request(app).post('/v1/auth/otp/resend').send({ challenge_id: otp.id }), 'resendCode');
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    await db.query("UPDATE users SET password_hash=$1 WHERE id='seller'", [
      await bcrypt.hash('correct-horse-123', 4),
    ]);
    const login = await ok(
      request(app)
        .post('/v1/auth/login')
        .send({ email: 'seller@test.com', password: 'correct-horse-123' }),
      'login',
    );
    const verified = await ok(
      request(app)
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: login.challenge_id, code: latestCode() }),
      'verifyCode',
    );
    await ok(
      request(app).post('/v1/auth/refresh').send({ refresh_token: verified.refresh_token }),
      'refreshSession',
    );
    await ok(request(app).get('/health'), 'liveness');
  });
});

describe('road-distance fares', () => {
  const from = { latitude: 6.55, longitude: 3.35 },
    to = { latitude: 6.6, longitude: 3.36 };
  it('uses Mapbox driving distance, caches it, and falls back to the estimate', async () => {
    const { createRouting } = await import('../src/services/routing.service.js');
    const mapbox = vi.fn(
      async () => ({ ok: true, json: async () => ({ routes: [{ distance: 9340 }] }) }) as any,
    );
    const routing = createRouting({ ...c, mapboxToken: 'pk.test' }, null, mapbox);
    expect(await routing.drivingDistance(from, to)).toEqual({ km: 9.3, method: 'road' });
    expect(await routing.drivingDistance(from, to)).toEqual({ km: 9.3, method: 'road' });
    expect(mapbox).toHaveBeenCalledTimes(1);
    const down = createRouting({ ...c, mapboxToken: 'pk.test' }, null, (async () => {
      throw new Error('timeout');
    }) as any);
    const fallback = await down.drivingDistance({ latitude: 6.5, longitude: 3.3 }, to);
    expect(fallback.method).toBe('estimate');
    expect((await createRouting({ ...c, mapboxToken: '' }).drivingDistance(from, to)).method).toBe(
      'estimate',
    );
  });
  it('quotes and charges delivery on the road distance when Mapbox is configured', async () => {
    const roadApp = createApp(db, { ...c, mapboxToken: 'pk.test' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ routes: [{ distance: 12000 }] }) })),
    );
    const { b } = await accepted();
    await funded(b);
    await db.query('UPDATE sellers SET latitude=6.551,longitude=3.351 WHERE user_id=$1', [
      'seller',
    ]);
    const quote = await request(roadApp)
      .post(`/v1/bookings/${b}/delivery/quote`)
      .set('Authorization', 'Bearer token-buyer')
      .send({ vehicle_type: 'motorcycle', dropoff: to });
    expect(quote.body).toMatchObject({ distance_km: 12, distance_method: 'road' });
    // 500 base + 12 km × 150 = ₦2,300
    expect(quote.body.fare_kobo).toBe(230000);
    const d = await request(roadApp)
      .post(`/v1/bookings/${b}/delivery`)
      .set('Authorization', 'Bearer token-buyer')
      .set('Idempotency-Key', randomUUID())
      .send({
        vehicle_type: 'motorcycle',
        dropoff: to,
        dropoff_address: '14 Allen Avenue, Ikeja',
        expected_fare_kobo: quote.body.fare_kobo,
      });
    expect(d.status).toBe(200);
    expect(d.body.distance_km).toBe(12);
  });
});
describe('redis, rate limits and realtime', () => {
  it('publishes user events only after commit, never on rollback', async () => {
    const { events } = await import('../src/lib/events.js');
    const seen: string[] = [];
    const stop = events.onUserChanged((id) => seen.push(id));
    await db.transaction(async (q) => {
      q.afterCommit(() => events.userChanged('committed'));
      expect(seen).toEqual([]);
    });
    await db
      .transaction(async (q) => {
        q.afterCommit(() => events.userChanged('rolled-back'));
        throw new Error('abort');
      })
      .catch(() => {});
    stop();
    expect(seen).toEqual(['committed']);
  });
  it('pushes a sync to the connected app as soon as its data changes', async () => {
    const { attachRealtime } = await import('../src/realtime/socket.js');
    const { WebSocket } = await import('ws');
    const token = 'a'.repeat(64);
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,'buyer',now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex')],
    );
    const listing = await setup();
    const b = await book(listing);
    const server = app.listen(0);
    const close = attachRealtime(server, db, { ...c, origins: [] });
    const port = (server.address() as any).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: string[] = [];
    await new Promise<void>((resolve) => {
      socket.on('message', (m) => {
        const type = JSON.parse(String(m)).type;
        messages.push(type);
        if (type === 'ready') resolve();
      });
      socket.on('open', () => socket.send(JSON.stringify({ type: 'authenticate', token })));
    });
    const started = Date.now();
    await call('seller', 'post', `/bookings/${b}/accept`);
    await new Promise((r) => setTimeout(r, 300));
    expect(messages).toContain('sync');
    expect(Date.now() - started).toBeLessThan(5000); // the fallback poll is 30 s
    socket.close();
    close();
    await new Promise((r) => server.close(r));
  });
  it.skipIf(!process.env.TEST_REDIS_URL)(
    'shares rate limits and events between instances through Redis',
    async () => {
      const { connectRedis } = await import('../src/lib/redis.js');
      const { events } = await import('../src/lib/events.js');
      const url = process.env.TEST_REDIS_URL!;
      const [one, two, sub, outside] = ['a', 'b', 'sub', 'outside'].map((n) =>
        connectRedis(url, `test-${n}`),
      );
      await one.flushdb();
      const limited = { ...c, rateLimitPerMinute: 3 };
      const first = createApp(db, limited, one);
      const second = createApp(db, limited, two);
      const statuses: number[] = [];
      for (const target of [first, second, first, second])
        statuses.push((await request(target).get('/v1/settings')).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
      events.useRedis(one, sub);
      await new Promise((r) => setTimeout(r, 200));
      const seen: string[] = [];
      const stop = events.onUserChanged((id) => seen.push(id));
      // Published by "another instance" (a separate connection).
      await outside.publish('farmers-market:user-sync', 'buyer');
      await new Promise((r) => setTimeout(r, 200));
      stop();
      expect(seen).toEqual(['buyer']);
      expect((await request(createApp(db, c, one)).get('/health/ready')).body.redis).toBe('ok');
      await Promise.all([one, two, sub, outside].map((r) => r.quit()));
    },
  );
});
describe('response contract (whole suite)', () => {
  // Runs last: every response recorded by the tests above must match its published schema.
  it('every JSON operation has a schema and every recorded response matches it', async () => {
    const { responses, nonJsonOperations } = await import('../src/contracts/index.js');
    const { buildOpenApi } = await import('../scripts/openapi.js');
    const spec = buildOpenApi() as any;
    const routes: { method: string; rx: RegExp; id: string; depth: number }[] = [];
    for (const [path, ops] of Object.entries<any>(spec.paths))
      for (const [method, op] of Object.entries<any>(ops)) {
        const rx = new RegExp(`^${path.replace(/\{\w+\}/g, '[^/]+')}$`);
        routes.push({
          method: method.toUpperCase(),
          rx,
          id: op.operationId,
          depth: path.split('{').length,
        });
      }
    routes.sort((a, b) => a.depth - b.depth);
    const missing = routes
      .map((r) => r.id)
      .filter((id) => !responses[id] && !nonJsonOperations.has(id));
    expect(missing).toEqual([]);
    const seen = new Set<string>();
    for (const c of captures) {
      if (c.status < 200 || c.status >= 300) continue;
      const route = routes.find((r) => r.method === c.method && r.rx.test(c.path));
      if (!route || nonJsonOperations.has(route.id)) continue;
      seen.add(route.id);
      const parsed = responses[route.id].safeParse(c.body);
      expect(parsed.success, `${route.id} ${c.path}: ${parsed.error?.message}`).toBe(true);
    }
    // The suite (including the contract tour) exercises nearly every JSON operation.
    expect(seen.size).toBeGreaterThan(110);
  });
});
