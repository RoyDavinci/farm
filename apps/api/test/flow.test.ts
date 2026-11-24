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
import { readFeatures } from '../src/config/features.js';
import { config } from '../src/config/index.js';
import { connect, type Database } from '../src/database/client.js';
import { expireReservations } from '../src/services/booking.service.js';
import { recoverFunding } from '../src/services/funding-recovery.service.js';
import { deliverPush } from '../src/services/push.service.js';
import { deliverPartnerWebhooks } from '../src/services/partner.service.js';
import { clearMarketCache, plannerReminders } from '../src/services/planner-wizard.service.js';
import { pickPhoto, refreshFulfilment } from '../src/services/catalogue-products.service.js';
import { dealsSweep } from '../src/services/deals.service.js';
/**
 * Every JSON response is recorded and checked against the published response schemas by the
 * last test. With CONTRACT_CAPTURE=<file> the recordings are also written out (to derive schemas).
 */
/** Every test user's transaction PIN. */
const PIN = '2580';
const pinHash = bcrypt.hashSync(PIN, 4);
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
  smsMode: 'file' as const,
  // Tests never call real map or storage services.
  mapboxToken: '',
  storageProvider: 'local' as const,
  recordsStorageProvider: 'local' as const,
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
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','settings','vehicle_types','catalogue_categories','market_regions','marketplace_policies','promotion_packages','subscription_plans','catalogue_products')",
    );
    await q.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} CASCADE`);
    await q.query(
      `UPDATE settings SET reservation_hours=168,commission_bps=500,payout_min_kobo=100000,payout_fee_kobo=5000,
         monetisation='{"transaction_commission":true,"delivery_commission":true,"sponsored_products":true,"featured_sellers":true,"local_ads":true}'`,
    );
    await q.query('UPDATE catalogue_categories SET commission_bps=NULL');
    await q.query(
      `INSERT INTO promotion_packages(id,kind,name,days,price_kobo,active) VALUES
         ('pkg-product-7','PRODUCT','7-day boost',7,350000,true),('pkg-product-14','PRODUCT','14-day boost',14,600000,true),
         ('pkg-product-30','PRODUCT','30-day boost',30,1100000,true),('pkg-seller-7','SELLER','Featured shop, 7 days',7,500000,true),
         ('pkg-seller-14','SELLER','Featured shop, 14 days',14,900000,true),('pkg-seller-30','SELLER','Featured shop, 30 days',30,1600000,true)
       ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,name=EXCLUDED.name,days=EXCLUDED.days,price_kobo=EXCLUDED.price_kobo,active=true`,
    );
    await q.query("DELETE FROM promotion_packages WHERE id NOT LIKE 'pkg-%'");
    await q.query(
      `INSERT INTO subscription_plans(id,audience,name,description,price_kobo,period_days,features,active) VALUES
         ('seller-pro','SELLER','Seller Pro','',500000,30,'{"insights":true,"ai_assistant":true,"business_report":true,"bulk_import":false,"team_seats":1,"api_access":false}',true),
         ('seller-business','SELLER','Business','',1500000,30,'{"insights":true,"ai_assistant":true,"business_report":true,"bulk_import":true,"team_seats":5,"api_access":true}',true),
         ('ahia-plus','BUYER','Ahia Plus','',200000,30,'{"member_deals":true,"delivery_offer":true}',true)
       ON CONFLICT(id) DO UPDATE SET audience=EXCLUDED.audience,name=EXCLUDED.name,price_kobo=EXCLUDED.price_kobo,period_days=EXCLUDED.period_days,features=EXCLUDED.features,active=true`,
    );
    await q.query(
      "DELETE FROM subscription_plans WHERE id NOT IN ('seller-pro','seller-business','ahia-plus')",
    );
    for (const [i, actor] of actors.entries()) {
      await q.query(
        'INSERT INTO users(id,name,email,phone,password_hash,admin,staff_role,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())',
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
      await q.query('UPDATE users SET transaction_pin_hash=$1 WHERE id=$2', [pinHash, actor]);
      // Sellers and riders are approved only with a selfie on file.
      for (const [subject, kind] of [
        ['seller', 'selfie'],
        ['driver', 'selfie'],
        ['driver', 'drivers_licence'],
      ])
        await q.query(
          "INSERT INTO seller_documents(id,seller_id,kind,filename,mime_type,storage_provider,storage_key,subject) VALUES($1,$2,$3,'photo.webp','image/webp','local',$1,$4)",
          [`${kind}-${subject}-${actor}`, actor, kind, subject],
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
      transaction_pin: '4826',
      admin: true,
    };
    expect(
      (
        await request(app)
          .post('/v1/auth/register')
          .send({ ...data, transaction_pin: '1234' })
      ).status,
    ).toBe(400);
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
    const [pinRow] = await db.query('SELECT transaction_pin_hash FROM users WHERE email=$1', [
      'new@test.com',
    ]);
    expect(await bcrypt.compare('4826', pinRow.transaction_pin_hash)).toBe(true);
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
    // The device that entered a code signs in again with just the password.
    expect(login.body.device_token).toMatch(/^[a-f0-9]{64}$/);
    const trusted = await request(app)
      .post('/v1/auth/login')
      .send({ email: data.email, password: data.password, device_token: login.body.device_token });
    expect(trusted.status).toBe(200);
    expect(trusted.body).toMatchObject({ trusted_device: true, user: { email: 'new@test.com' } });
    expect(
      (await request(app).get('/v1/me').set('Authorization', `Bearer ${trusted.body.token}`))
        .status,
    ).toBe(200);
    // The password is still checked, and an unknown device still gets a code.
    expect(
      (
        await request(app).post('/v1/auth/login').send({
          email: data.email,
          password: 'wrong-password-1',
          device_token: login.body.device_token,
        })
      ).status,
    ).toBe(401);
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    expect(
      (
        await request(app)
          .post('/v1/auth/login')
          .send({ email: data.email, password: data.password, device_token: 'f'.repeat(64) })
      ).status,
    ).toBe(202);
    // A password reset forgets every trusted device.
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    const reset = await request(app).post('/v1/auth/password/forgot').send({ email: data.email });
    await request(app).post('/v1/auth/otp/verify').send({
      challenge_id: reset.body.challenge_id,
      code: latestCode(),
      new_password: 'another-horse-456',
    });
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    expect(
      (
        await request(app).post('/v1/auth/login').send({
          email: data.email,
          password: 'another-horse-456',
          device_token: login.body.device_token,
        })
      ).status,
    ).toBe(202);
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
      method: 'card',
    });
    expect(start.status).toBe(200);
    // A card deposit opens Paystack's checkout with only the card option.
    expect(JSON.parse(fake.mock.calls[0][1].body).channels).toEqual(['card']);
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
describe('phone-number accounts and fingerprint sign-in', () => {
  const latestSms = () => {
    const folder = join(mailDir, 'sms');
    const newest = readdirSync(folder).sort().at(-1)!;
    return /(\d{6}) is your Ahia/.exec(readFileSync(join(folder, newest), 'utf8'))![1];
  };
  const person = {
    name: 'Ngozi Phone',
    phone: '0803 555 1234',
    password: 'correct-horse-123',
    transaction_pin: '4826',
  };
  it('with text messages: signs up and signs in with a phone number and a texted code', async () => {
    const reg = await request(app).post('/v1/auth/register').send(person);
    expect(reg.status).toBe(202);
    expect(reg.body).toMatchObject({ channel: 'sms', email: '+2348035551234' });
    const ok = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: reg.body.challenge_id, code: latestSms() });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: null, phone: '+2348035551234' });
    const [u] = await db.query('SELECT phone_verified_at,email FROM users WHERE id=$1', [
      ok.body.user.id,
    ]);
    expect(u.phone_verified_at).toBeTruthy();
    // Signing in with the phone (any common format) on a new device texts a code.
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ login: '+234 803 555 1234', password: person.password });
    expect(login.status).toBe(202);
    expect(login.body.channel).toBe('sms');
    // A known device signs straight in; email accounts still sign in with "email".
    const again = await request(app)
      .post('/v1/auth/login')
      .send({
        login: '08035551234',
        password: person.password,
        device_token: ok.body.device_token,
      });
    expect(again.status).toBe(200);
    expect(
      (
        await request(app)
          .post('/v1/auth/login')
          .send({ login: '08035551234', password: 'wrong-password-1' })
      ).status,
    ).toBe(401);
  });
  it('without text messages: opens a phone-only account with the minimal check', async () => {
    const noSms = createApp(db, { ...c, smsMode: 'off' as const });
    const reg = await request(noSms)
      .post('/v1/auth/register')
      .send({ ...person, email: '' });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ verification: 'minimal', user: { email: null } });
    const auth = { Authorization: `Bearer ${reg.body.token}` };
    // Money can't leave the account until the phone or BVN is verified.
    const sent = await request(noSms)
      .post('/v1/wallet/transfers')
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        to: (await db.query("SELECT ahia_id FROM users WHERE id='other'"))[0].ahia_id,
        amount_kobo: 10000,
        transaction_pin: '4826',
      });
    expect(sent.body.error.code).toBe('VERIFY_TO_MOVE_MONEY');
    // A new-device sign-in uses the password alone, and pauses withdrawals for a day.
    const login = await request(noSms)
      .post('/v1/auth/login')
      .send({ phone: '2348035551234', password: person.password });
    expect(login.status).toBe(200);
    const [u] = await db.query('SELECT money_locked_until FROM users WHERE phone=$1', [
      '+2348035551234',
    ]);
    expect(new Date(u.money_locked_until).getTime()).toBeGreaterThan(Date.now());
    // Password reset by phone needs texts.
    expect(
      (await request(noSms).post('/v1/auth/password/forgot').send({ login: '08035551234' })).body
        .error.code,
    ).toBe('SMS_UNAVAILABLE');
  });
  it('signs in with a fingerprint key made with the password, until the password changes', async () => {
    const bad = await call('buyer', 'post', '/me/login-keys', { password: 'nope-nope-nope' });
    expect(bad.body.error.code).toBe('INVALID_PASSWORD');
    await db.query("UPDATE users SET password_hash=$1 WHERE id='buyer'", [
      bcrypt.hashSync('buyer-password-1', 4),
    ]);
    const made = await call('buyer', 'post', '/me/login-keys', {
      password: 'buyer-password-1',
      device_name: 'Pixel 8',
    });
    expect(made.body.key).toMatch(/^login:/);
    const signIn = (key: string) => request(app).post('/v1/auth/biometric').send({ key });
    const ok = await signIn(made.body.key);
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe('buyer');
    expect((await signIn(`${made.body.key}0`)).status).toBe(401);
    // A sign-in key can't confirm payments, and a payment key can't sign in.
    expect(
      (
        await call('buyer', 'post', '/wallet/transfers', {
          to: (await db.query("SELECT ahia_id FROM users WHERE id='other'"))[0].ahia_id,
          amount_kobo: 10000,
          transaction_pin: made.body.key.replace('login:', 'bio:'),
        })
      ).body.error.code,
    ).toBe('BIOMETRIC_INVALID');
    // A password reset turns it off.
    const reset = await request(app)
      .post('/v1/auth/password/forgot')
      .send({ email: 'buyer@test.com' });
    await request(app)
      .post('/v1/auth/otp/verify')
      .send({
        challenge_id: reset.body.challenge_id,
        code: latestCode(),
        new_password: 'buyer-password-2',
      });
    expect((await signIn(made.body.key)).status).toBe(401);
  });
});
describe('Ahia IDs, transfers, referrals and promo codes', () => {
  const idOf = async (actor: string) =>
    (await db.query('SELECT ahia_id FROM users WHERE id=$1', [actor]))[0].ahia_id as string;
  const wallet = async (actor: string) =>
    Number(
      (
        await db.query(
          "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM ledger WHERE account='wallet' AND owner_id=$1",
          [actor],
        )
      )[0].n,
    );
  it('gives everyone an Ahia ID and sends money between wallets by it', async () => {
    const me = (await call('buyer', 'get', '/me')).body.user;
    expect(me.ahia_id).toMatch(/^AH-\d{8}$/);
    const other = await idOf('other');
    expect(
      (
        await call(
          'buyer',
          'get',
          `/wallet/transfers/recipient?id=${other.replace('-', '').toLowerCase()}`,
        )
      ).body,
    ).toMatchObject({ ahia_id: other, name: 'other' });
    expect(
      (await call('buyer', 'get', `/wallet/transfers/recipient?id=${me.ahia_id}`)).body.error.code,
    ).toBe('SELF_TRANSFER');
    await call('buyer', 'post', '/wallet/demo-fund', { amount_kobo: 500000 });
    const send = (body: any) => call('buyer', 'post', '/wallet/transfers', body);
    expect((await send({ to: other, amount_kobo: 100000, transaction_pin: '0000' })).status).toBe(
      400,
    );
    const ok = await send({
      to: other,
      amount_kobo: 100000,
      note: 'For the rice',
      transaction_pin: PIN,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.to).toEqual({ ahia_id: other, name: 'other' });
    expect(await wallet('other')).toBe(100000);
    expect(await wallet('buyer')).toBe(400000);
    const theirs = (await call('other', 'get', '/wallet/transfers')).body;
    expect(theirs[0]).toMatchObject({
      direction: 'RECEIVED',
      amount_kobo: 100000,
      note: 'For the rice',
    });
    expect(theirs[0].other.ahia_id).toBe(me.ahia_id);
    expect(await ledgerBalances()).toBe(0);
  });
  it('confirms money moves with a fingerprint key made with the PIN', async () => {
    await call('buyer', 'post', '/wallet/demo-fund', { amount_kobo: 300000 });
    const other = await idOf('other');
    expect(
      (await call('buyer', 'post', '/me/biometrics', { transaction_pin: '1111' })).status,
    ).toBe(400);
    const made = await call('buyer', 'post', '/me/biometrics', {
      transaction_pin: PIN,
      device_name: 'Pixel 8',
    });
    expect(made.status).toBe(200);
    expect(made.body.key).toMatch(/^bio:/);
    // A fingerprint key can't make another key: that needs the PIN itself.
    expect(
      (await call('buyer', 'post', '/me/biometrics', { transaction_pin: made.body.key })).body.error
        .code,
    ).toBe('PIN_REQUIRED');
    const send = (pin: string) =>
      call('buyer', 'post', '/wallet/transfers', {
        to: other,
        amount_kobo: 50000,
        transaction_pin: pin,
      });
    expect((await send(made.body.key)).status).toBe(200);
    expect((await send(`${made.body.key}x`)).body.error.code).toBe('BIOMETRIC_INVALID');
    expect((await call('buyer', 'get', '/me/biometrics')).body[0]).toMatchObject({
      device_name: 'Pixel 8',
    });
    // Changing the PIN turns fingerprint off everywhere.
    await call('buyer', 'put', '/me/transaction-pin', { pin: '4826', current_pin: PIN });
    expect((await send(made.body.key)).body.error.code).toBe('BIOMETRIC_INVALID');
    expect((await call('buyer', 'get', '/me/biometrics')).body).toEqual([]);
  });
  it('rewards both people when an invited customer’s first order completes', async () => {
    // A bad invite code is refused at sign-up; a good one names the inviter.
    const reg = await request(app).post('/v1/auth/register').send({
      name: 'Invited Person',
      email: 'invited@test.com',
      phone: '+2348091112222',
      password: 'correct-horse-123',
      referral_code: 'AH-00000000',
    });
    expect(reg.body.error.code).toBe('REFERRAL_INVALID');
    const code = await idOf('other');
    expect((await request(app).get(`/v1/auth/referrer?code=${code}`)).body).toEqual({
      code,
      name: 'other',
    });
    await db.query("UPDATE users SET referred_by='other' WHERE id='buyer'");
    await completedSale();
    expect(await wallet('other')).toBe(50000);
    const credits = await db.query(
      'SELECT user_id,source,amount_kobo::int FROM wallet_credits ORDER BY source',
    );
    expect(credits).toEqual([
      { user_id: 'other', source: 'REFERRAL', amount_kobo: 50000 },
      { user_id: 'buyer', source: 'WELCOME', amount_kobo: 50000 },
    ]);
    const mine = (await call('other', 'get', '/referrals/me')).body;
    expect(mine).toMatchObject({ code, invited: 1, rewarded: 1, earned_kobo: 50000 });
    expect(mine.link).toContain(`?ref=${code}`);
    // Credit can be spent but not sent or withdrawn until the hold ends.
    const send = await call('other', 'post', '/wallet/transfers', {
      to: await idOf('buyer'),
      amount_kobo: 20000,
      transaction_pin: PIN,
    });
    expect(send.body.error.code).toBe('FUNDS_ON_HOLD');
    // Paid once: the buyer is marked rewarded, so later orders pay nothing more.
    const [buyer] = await db.query("SELECT referral_rewarded_at FROM users WHERE id='buyer'");
    expect(buyer.referral_rewarded_at).toBeTruthy();
    expect(await ledgerBalances()).toBe(0);
  });
  it('promo codes: instant credit, cashback on the next completed order, one use each', async () => {
    const mk = (body: any) => call('admin', 'post', '/admin/promo-codes', body);
    expect((await mk({ code: 'welcome500', kind: 'CREDIT', amount_kobo: 50000 })).status).toBe(200);
    expect(
      (await mk({ code: 'WELCOME500', kind: 'CREDIT', amount_kobo: 50000 })).body.error.code,
    ).toBe('PROMO_EXISTS');
    expect(
      (await mk({ code: 'BACK10', kind: 'CASHBACK', percent: 10, max_kobo: 50000, max_uses: 1 }))
        .status,
    ).toBe(200);
    const redeem = (actor: 'buyer' | 'other', code: string) =>
      call(actor, 'post', '/promo-codes/redeem', { code });
    expect((await redeem('buyer', 'welcome500')).body.kind).toBe('CREDIT');
    expect(await wallet('buyer')).toBe(50000);
    expect((await redeem('buyer', 'WELCOME500')).body.error.code).toBe('PROMO_USED');
    expect((await redeem('buyer', 'NOPE123')).body.error.code).toBe('PROMO_INVALID');
    expect((await redeem('buyer', 'BACK10')).body.message).toContain('10% back');
    expect((await redeem('other', 'BACK10')).body.error.code).toBe('PROMO_USED_UP');
    const before = await wallet('buyer');
    const b = await completedSale();
    const [order] = await db.query('SELECT total_kobo FROM bookings WHERE id=$1', [b]);
    const back = Math.min(50000, Math.round(Number(order.total_kobo) / 10));
    const [r] = await db.query(
      "SELECT status,amount_kobo::int FROM promo_redemptions WHERE status='PAID' AND booking_id=$1",
      [b],
    );
    expect(r).toEqual({ status: 'PAID', amount_kobo: back });
    expect(
      (await call('buyer', 'get', '/promo-codes/mine')).body.map((x: any) => x.status).sort(),
    ).toEqual(['PAID', 'PAID']);
    expect(before).toBeGreaterThan(0);
    const admin = (await call('admin', 'get', '/admin/promo-codes')).body;
    expect(admin.find((p: any) => p.code === 'BACK10')).toMatchObject({ uses: 1, paid_kobo: back });
    expect(
      (await call('admin', 'post', `/admin/promo-codes/${admin[0].id}/active`, { active: false }))
        .status,
    ).toBe(200);
    expect((await call('admin', 'get', '/admin/referrals')).body.totals.promo_paid_kobo).toBe(
      50000 + back,
    );
    expect(
      (
        await call('admin', 'put', '/admin/referrals', {
          referral_reward_kobo: 100000,
          referral_welcome_kobo: 50000,
          referral_min_order_kobo: 100000,
          credit_hold_days: 14,
        })
      ).status,
    ).toBe(200);
    expect(await ledgerBalances()).toBe(0);
  });
});
describe('seller payouts', () => {
  const simulated = () => createApp(db, { ...c, payments: false, demo: true });
  /** These tests are about the payout flow, so money is treated as past its fraud hold. */
  async function pastHolds() {
    await db.query("UPDATE ledger SET created_at=created_at-interval '10 days'");
    await db.query("UPDATE funding SET credited_at=credited_at-interval '10 days'");
  }
  async function as(
    target: ReturnType<typeof createApp>,
    actor: string,
    method: 'get' | 'post',
    path: string,
    body?: any,
  ) {
    if (method === 'post' && path === '/payouts') await pastHolds();
    const r = request(target)
      [method](`/v1${path}`)
      .set('Authorization', `Bearer token-${actor}`)
      .set('Idempotency-Key', randomUUID());
    return body === undefined ? r : r.send(body);
  }
  it('holds proceeds on request, pays out once on approval and records the fee', async () => {
    await completedSale();
    const sim = simulated();
    expect((await as(sim, 'buyer', 'get', '/payouts')).body).toMatchObject({
      earner: false,
      wallet_kobo: expect.any(Number),
    });
    expect(
      (
        await as(sim, 'seller', 'post', '/payouts/accounts', {
          transaction_pin: '9999',
          bank_code: '058',
          account_number: '0123456789',
        })
      ).body.error.code,
    ).toBe('INVALID_TRANSACTION_PIN');
    const account = await as(sim, 'seller', 'post', '/payouts/accounts', {
      transaction_pin: PIN,
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
      (await as(sim, 'seller', 'post', '/payouts', { transaction_pin: PIN, amount_kobo: 190001 }))
        .body.error.code,
    ).toBe('INSUFFICIENT_PROCEEDS');
    expect(
      (await as(sim, 'seller', 'post', '/payouts', { transaction_pin: PIN, amount_kobo: 5000 }))
        .status,
    ).toBe(400);
    const payout = await as(sim, 'seller', 'post', '/payouts', {
      transaction_pin: PIN,
      amount_kobo: 150000,
    });
    expect(payout.status).toBe(200);
    expect((await as(sim, 'seller', 'get', '/payouts')).body.available_kobo).toBe(40000);
    expect(
      (
        await as(sim, 'seller', 'post', '/payouts/accounts', {
          transaction_pin: PIN,
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
  it('lets anyone withdraw their wallet balance through the same review', async () => {
    const sim = simulated();
    await db.query(
      "INSERT INTO ledger(id,txn_id,account,owner_id,amount_kobo,reference) VALUES($1,$3,'wallet','buyer',300000,'test-deposit'),($2,$3,'provider_clearing',NULL,-300000,'test-deposit')",
      [randomUUID(), randomUUID(), randomUUID()],
    );
    expect(
      (await as(sim, 'buyer', 'post', '/payouts', { transaction_pin: PIN, amount_kobo: 150000 }))
        .body.error.code,
    ).toBe('SELLER_NOT_APPROVED');
    await as(sim, 'buyer', 'post', '/payouts/accounts', {
      transaction_pin: PIN,
      bank_code: '058',
      account_number: '0123456789',
    });
    expect(
      (
        await as(sim, 'buyer', 'post', '/payouts', {
          transaction_pin: PIN,
          amount_kobo: 300001,
          source: 'wallet',
        })
      ).body.error.code,
    ).toBe('INSUFFICIENT_PROCEEDS');
    const payout = await as(sim, 'buyer', 'post', '/payouts', {
      transaction_pin: PIN,
      amount_kobo: 200000,
      source: 'wallet',
    });
    expect(payout.body).toMatchObject({ status: 'REQUESTED', source_account: 'wallet' });
    expect((await as(sim, 'buyer', 'get', '/payouts')).body.wallet_kobo).toBe(100000);
    await as(sim, 'buyer', 'post', `/payouts/${payout.body.id}/cancel`);
    expect((await as(sim, 'buyer', 'get', '/payouts')).body.wallet_kobo).toBe(300000);
    const again = await as(sim, 'buyer', 'post', '/payouts', {
      transaction_pin: PIN,
      amount_kobo: 200000,
      source: 'wallet',
    });
    expect(
      (await as(sim, 'admin', 'post', `/admin/payouts/${again.body.id}/approve`)).body.status,
    ).toBe('PAID');
    expect((await as(sim, 'buyer', 'get', '/payouts')).body.wallet_kobo).toBe(100000);
    expect(await ledgerBalances()).toBe(0);
  });
  it('returns funds to proceeds when a payout is rejected or cancelled', async () => {
    await completedSale();
    const sim = simulated();
    await as(sim, 'seller', 'post', '/payouts/accounts', {
      transaction_pin: PIN,
      bank_code: '058',
      account_number: '0123456789',
    });
    const first = await as(sim, 'seller', 'post', '/payouts', {
      transaction_pin: PIN,
      amount_kobo: 100000,
    });
    expect(
      (
        await as(sim, 'admin', 'post', `/admin/payouts/${first.body.id}/reject`, {
          reason: 'Name mismatch',
        })
      ).body.status,
    ).toBe('REJECTED');
    const second = await as(sim, 'seller', 'post', '/payouts', {
      transaction_pin: PIN,
      amount_kobo: 190000,
    });
    expect((await as(sim, 'seller', 'post', `/payouts/${second.body.id}/cancel`)).status).toBe(200);
    expect((await as(sim, 'seller', 'get', '/payouts')).body.available_kobo).toBe(190000);
    expect(await ledgerBalances()).toBe(0);
  });
  /** Controllable fake Paystack: counts transfer POSTs and can report pending/success, a wrong
   * amount, or be unreachable when verifying. */
  function fakePaystack() {
    const state = {
      transferStatus: 'pending',
      verifyAmount: 145000,
      verifyDown: false,
      transfers: 0,
    };
    const ok = (data: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({ status: true, data }),
    });
    const fn = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/bank?')) return ok([{ code: '058', name: 'Guaranty Trust Bank' }]);
      if (url.includes('/bank/resolve')) return ok({ account_name: 'SELLER ADA' });
      if (url.includes('/transferrecipient')) return ok({ recipient_code: 'RCP_test' });
      if (url.endsWith('/transfer')) {
        state.transfers++;
        return ok({
          transfer_code: 'TRF_test',
          status: 'pending',
          reference: JSON.parse(init.body).reference,
        });
      }
      if (url.includes('/transfer/verify/')) {
        if (state.verifyDown) throw new TypeError('fetch failed');
        const reference = decodeURIComponent(url.split('/transfer/verify/')[1]);
        return ok({
          transfer_code: 'TRF_test',
          reference,
          currency: 'NGN',
          status: state.transferStatus,
          amount: state.verifyAmount,
        });
      }
      throw new Error(`unexpected provider call ${url}`);
    });
    vi.stubGlobal('fetch', fn);
    return state;
  }
  async function providerPayout() {
    await completedSale();
    await call('seller', 'post', '/payouts/accounts', {
      transaction_pin: PIN,
      bank_code: '058',
      account_number: '0123456789',
    });
    // Past the new-seller earnings hold; these tests are about the transfer itself.
    await db.query("UPDATE ledger SET created_at=created_at-interval '10 days'");
    const r = await call('seller', 'post', '/payouts', {
      transaction_pin: PIN,
      amount_kobo: 150000,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.id as string;
  }
  const payoutRow = async (id: string) =>
    (await db.query('SELECT * FROM payouts WHERE id=$1', [id]))[0];
  const held = async (id: string) =>
    Number(
      (
        await db.query(
          "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM ledger WHERE account='payout_pending' AND owner_id=$1",
          [id],
        )
      )[0].n,
    );

  it('sends provider transfers once and settles only after server-side verification', async () => {
    const paystack = fakePaystack();
    const id = await providerPayout();
    const approved = await call('admin', 'post', `/admin/payouts/${id}/approve`);
    expect(approved.body.status).toBe('PROCESSING');
    expect(paystack.transfers).toBe(1);
    const body = JSON.stringify({ event: 'transfer.success', data: { reference: id } });
    const forged = await request(app)
      .post('/v1/webhooks/paystack')
      .set('x-paystack-signature', 'bad')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(forged.status).toBe(401);
    paystack.transferStatus = 'success';
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
    expect((await payoutRow(id)).status).toBe('PAID');
    expect(paystack.transfers).toBe(1);
    expect(await ledgerBalances()).toBe(0);
  });
  it('resumes an approved payout after a crash and sends it exactly once', async () => {
    const paystack = fakePaystack();
    const id = await providerPayout();
    // Approval committed (READY) but the process died before sending.
    await db.query(
      "UPDATE payouts SET status='PROCESSING',provider='paystack',dispatch_state='READY',recovery_after=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    const { recoverPayouts } = await import('../src/services/payouts.service.js');
    await Promise.all([recoverPayouts(db, c), recoverPayouts(db, c), recoverPayouts(db, c)]);
    expect(paystack.transfers).toBe(1);
    expect((await payoutRow(id)).dispatch_state).toBe('SUBMITTED');
    paystack.transferStatus = 'success';
    await db.query("UPDATE payouts SET recovery_after=now()-interval '1 second' WHERE id=$1", [id]);
    await recoverPayouts(db, c);
    expect((await payoutRow(id)).status).toBe('PAID');
    expect(paystack.transfers).toBe(1);
    expect(await ledgerBalances()).toBe(0);
  });
  it('never re-sends an ambiguous payout; funds stay held until staff resolve it', async () => {
    const paystack = fakePaystack();
    const id = await providerPayout();
    // A dispatch whose outcome is unknown (lease expired mid-send), and the provider is unreachable.
    await db.query(
      "UPDATE payouts SET status='PROCESSING',provider='paystack',dispatch_state='SENDING',recovery_token='old',recovery_after=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    paystack.verifyDown = true;
    const { recoverPayouts } = await import('../src/services/payouts.service.js');
    await recoverPayouts(db, c);
    const stuck = await payoutRow(id);
    expect(paystack.transfers).toBe(0);
    expect(stuck.status).toBe('PROCESSING');
    expect(stuck.recovery_error).toMatch(/could not be verified/);
    expect(await held(id)).toBe(150000);
    const resolve = (actor: any, body: object) =>
      call(actor, 'post', `/admin/payouts/${id}/resolve`, body);
    expect(
      (await resolve('seller', { outcome: 'FAILED', reason: 'Not found at provider' })).status,
    ).toBe(403);
    expect((await resolve('admin', { outcome: 'FAILED', reason: 'short' })).status).toBe(400);
    const resolved = await resolve('admin', {
      outcome: 'FAILED',
      reason: 'Paystack dashboard shows no transfer with this reference',
    });
    expect(resolved.body.status).toBe('FAILED');
    expect(await held(id)).toBe(0);
    expect((await call('seller', 'get', '/payouts')).body.available_kobo).toBe(190000);
    expect(await ledgerBalances()).toBe(0);
  });
  it('does not mark a payout paid when the provider reports a different amount', async () => {
    const paystack = fakePaystack();
    paystack.transferStatus = 'success';
    paystack.verifyAmount = 100;
    const id = await providerPayout();
    const approved = await call('admin', 'post', `/admin/payouts/${id}/approve`);
    expect(approved.body.status).toBe('PROCESSING');
    expect(approved.body.recovery_error).toMatch(/could not be verified/);
    expect(await held(id)).toBe(150000);
    // Staff confirm on the provider dashboard and complete it.
    const resolved = await call('admin', 'post', `/admin/payouts/${id}/resolve`, {
      outcome: 'PAID',
      reason: 'Confirmed ₦1,450 transfer in Paystack dashboard',
    });
    expect(resolved.body.status).toBe('PAID');
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
    // New-listing alerts to followers are promotional: opt-in only (default off).
    expect(
      (
        await call('buyer', 'put', '/notification-preferences', {
          email_enabled: true,
          marketing_enabled: true,
        })
      ).status,
    ).toBe(200);
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
  /** A photo the rider just took, and where they were (at the seller unless given). */
  async function photo(
    at: { latitude: number; longitude: number } = { latitude: 6.55, longitude: 3.35 },
  ) {
    const url = `https://example.com/evidence/${randomUUID()}.webp`;
    await db.query('INSERT INTO media(id,owner_id,url,thumbnail_url) VALUES($1,$2,$3,$3)', [
      randomUUID(),
      'other',
      url,
    ]);
    return { photo_url: url, ...at };
  }
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
    // The rider checks the goods before the seller may hand them over.
    expect(
      (
        await call('seller', 'post', `/deliveries/${delivery.body.id}/handover`, {
          pin: claim.body.pickup_pin,
        })
      ).body.error.code,
    ).toBe('RIDER_CHECK_REQUIRED');
    const checked = await call('other', 'post', `/deliveries/${delivery.body.id}/check`, {
      note: 'Tomatoes fresh, 2 kg',
      ...(await photo()),
    });
    expect(checked.body.rider_checked_at).toBeTruthy();
    // Prepaid: the buyer's money is already in escrow, so the rider fronts nothing.
    expect(Number(checked.body.rider_fronted_kobo)).toBe(0);
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
    // Rider checked + seller confirmed: escrow is released to the seller at handover.
    expect((await call('seller', 'get', '/payouts')).body.available_kobo).toBe(190000);
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
      ...(await photo(drop)),
    });
    expect(done.body.status).toBe('DELIVERED');
    const [booking] = await db.query('SELECT status FROM bookings WHERE id=$1', [b]);
    expect(booking.status).toBe('COMPLETED');
    const earnings = Math.round(quote.fare_kobo * 0.9);
    expect((await call('other', 'get', '/payouts')).body.available_kobo).toBe(earnings);
    expect(await ledgerBalances()).toBe(0);
  });
  it('lets the rider pay the seller into escrow and the buyer pay on delivery', async () => {
    const { b, quote } = await readyForDelivery(false);
    const body = {
      vehicle_type: 'motorcycle',
      dropoff: drop,
      dropoff_address: '14 Allen Avenue, Ikeja',
      expected_fare_kobo: quote.fare_kobo,
      pay_on_delivery: true,
    };
    await db.query('UPDATE settings SET pay_on_delivery_enabled=FALSE');
    expect((await call('buyer', 'post', `/bookings/${b}/delivery`, body)).body.error.code).toBe(
      'POD_DISABLED',
    );
    await db.query('UPDATE settings SET pay_on_delivery_enabled=TRUE');
    const d = await call('buyer', 'post', `/bookings/${b}/delivery`, body);
    expect(d.body.fare_paid).toBe(false);
    const claim = await call('other', 'post', `/deliveries/${d.body.id}/claim`);
    // The rider needs the item price in their wallet to pay the seller.
    expect(
      (await call('other', 'post', `/deliveries/${d.body.id}/check`, await photo())).body.error
        .code,
    ).toBe('INSUFFICIENT_BALANCE');
    await call('other', 'post', '/wallet/demo-fund', { amount_kobo: 500000 });
    const checked = await call('other', 'post', `/deliveries/${d.body.id}/check`, await photo());
    expect(Number(checked.body.rider_fronted_kobo)).toBe(200000);
    expect((await call('other', 'get', '/wallet')).body.balance_kobo).toBe(300000);
    expect(
      (
        await call('seller', 'post', `/deliveries/${d.body.id}/handover`, {
          pin: claim.body.pickup_pin,
        })
      ).body.status,
    ).toBe('PICKED_UP');
    expect((await call('seller', 'get', '/payouts')).body.available_kobo).toBe(190000);
    expect(
      (
        await call('other', 'post', `/deliveries/${d.body.id}/deliver`, {
          pin: '111111',
          ...(await photo(drop)),
        })
      ).body.error.code,
    ).toBe('PAYMENT_REQUIRED');
    expect(
      (await call('buyer', 'get', `/bookings/${b}/delivery`)).body.delivery_pin,
    ).toBeUndefined();
    expect((await call('buyer', 'post', `/deliveries/${d.body.id}/pay`)).status).toBe(200);
    // The buyer's payment repays the rider.
    expect((await call('other', 'get', '/wallet')).body.balance_kobo).toBe(500000);
    const pinNow = (await call('buyer', 'get', `/bookings/${b}/delivery`)).body.delivery_pin;
    expect(
      (
        await call('other', 'post', `/deliveries/${d.body.id}/deliver`, {
          pin: pinNow,
          ...(await photo(drop)),
        })
      ).body.status,
    ).toBe('DELIVERED');
    // Seller was paid once, at handover.
    expect((await call('seller', 'get', '/payouts')).body.available_kobo).toBe(190000);
    expect(await ledgerBalances()).toBe(0);
  });
  it('returns the rider’s escrow money when the order is cancelled before collection', async () => {
    const { b, quote } = await readyForDelivery(false);
    const d = await call('buyer', 'post', `/bookings/${b}/delivery`, {
      vehicle_type: 'motorcycle',
      dropoff: drop,
      dropoff_address: '14 Allen Avenue, Ikeja',
      expected_fare_kobo: quote.fare_kobo,
      pay_on_delivery: true,
    });
    await call('other', 'post', `/deliveries/${d.body.id}/claim`);
    await call('other', 'post', '/wallet/demo-fund', { amount_kobo: 500000 });
    await call('other', 'post', `/deliveries/${d.body.id}/check`, await photo());
    expect((await call('other', 'get', '/wallet')).body.balance_kobo).toBe(300000);
    expect((await call('buyer', 'post', `/bookings/${b}/cancel`)).status).toBe(200);
    expect((await call('other', 'get', '/wallet')).body.balance_kobo).toBe(500000);
    expect(await ledgerBalances()).toBe(0);
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
    // Every job the readiness check requires must have reported recently.
    for (const name of [
      'reservation-expiry',
      'voice-expiry',
      'discovery-maintenance',
      'stock-freshness',
      'local-status-expiry',
      'status-boost-recovery',
    ])
      await db.query('INSERT INTO worker_heartbeats(name,beat_at) VALUES($1,now())', [name]);
    const ready = await request(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.backlog.email_late).toBe(0);
  });
});
describe('password reset', () => {
  const newestMail = () => {
    const folder = join(mailDir, 'mail');
    // Undo quoted-printable soft line breaks.
    return readFileSync(join(folder, readdirSync(folder).sort().at(-1)!), 'utf8').replace(
      /=\r?\n/g,
      '',
    );
  };
  it('tells an address with no account so, instead of pretending to reset it', async () => {
    const r = await request(app)
      .post('/v1/auth/password/forgot')
      .send({ email: 'nobody@test.com' });
    // Same response as for a real account, so the form can't be used to find accounts.
    expect(r.status).toBe(202);
    expect(r.body.challenge_id).toBeTruthy();
    const mail = newestMail();
    expect(mail).toContain('no Ahia account uses this email address');
    expect(mail).not.toMatch(/code is \d{6}/);
    // Even with a guessed code, completing it never reports a reset.
    const [otp] = await db.query('SELECT id FROM otp_challenges WHERE id=$1', [
      r.body.challenge_id,
    ]);
    await db.query('UPDATE otp_challenges SET code_hash=$1 WHERE id=$2', [
      createHmac('sha256', c.otpSecret).update(`${otp.id}:123456`).digest('hex'),
      otp.id,
    ]);
    const done = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: otp.id, code: '123456', new_password: 'another-password-123' });
    expect(done.status).toBe(404);
    expect(done.body.error.code).toBe('NO_ACCOUNT');
  });
  it('resets a real account and lets it sign in with the new password', async () => {
    const r = await request(app).post('/v1/auth/password/forgot').send({ email: 'buyer@test.com' });
    expect(r.status).toBe(202);
    const done = await request(app).post('/v1/auth/otp/verify').send({
      challenge_id: r.body.challenge_id,
      code: latestCode(),
      new_password: 'brand-new-password-1',
    });
    expect(done.body.password_reset).toBe(true);
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'buyer@test.com', password: 'brand-new-password-1' });
    // The new password is accepted (a code cooldown may apply right after the reset email).
    expect(login.status).not.toBe(401);
    expect(login.ok || login.body.error?.code === 'OTP_COOLDOWN').toBe(true);
  });
});
describe('pilot mode', () => {
  const pilotFeatures = () => readFeatures({ PILOT_MODE: 'true' });
  const pilot = (extra: object = {}) =>
    createApp(db, { ...c, demo: false, payments: true, features: pilotFeatures(), ...extra });
  const as = (
    target: ReturnType<typeof createApp>,
    actor: string,
    method: 'get' | 'post' | 'put',
    path: string,
    body?: object,
  ) => {
    const r = request(target)
      [method](`/v1${path}`)
      .set('Authorization', `Bearer token-${actor}`)
      .set('Idempotency-Key', randomUUID());
    return body === undefined ? r : r.send(body);
  };
  /** Fake Paystack: checkout, verify (paid when `paid`), refunds (configurable outcome). */
  function fakeProvider() {
    const state = {
      paid: new Set<string>(),
      amounts: new Map<string, number>(),
      refund: 'ok' as 'ok' | 'reject' | 'down',
      refunds: [] as { transaction: string; amount: number }[],
    };
    const ok = (data: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({ status: true, data }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: any) => {
        if (url.endsWith('/transaction/initialize')) {
          const b = JSON.parse(init.body);
          state.amounts.set(b.reference, b.amount);
          return ok({ authorization_url: `https://checkout.paystack.test/${b.reference}` });
        }
        if (url.includes('/transaction/verify/')) {
          const ref = decodeURIComponent(url.split('/transaction/verify/')[1]);
          return ok({
            id: 9000 + state.amounts.size,
            reference: ref,
            currency: 'NGN',
            amount: state.amounts.get(ref),
            status: state.paid.has(ref) ? 'success' : 'abandoned',
          });
        }
        if (url.endsWith('/refund')) {
          if (state.refund === 'down') throw new TypeError('fetch failed');
          if (state.refund === 'reject')
            return {
              ok: false,
              status: 400,
              json: async () => ({ status: false, message: 'Refund not allowed' }),
            };
          state.refunds.push(JSON.parse(init.body));
          return ok({ id: 7000 + state.refunds.length, status: 'pending' });
        }
        throw new Error(`unexpected provider call ${url}`);
      }),
    );
    return state;
  }
  async function payWebhook(target: ReturnType<typeof createApp>, reference: string) {
    const body = JSON.stringify({ event: 'charge.success', data: { reference } });
    const signature = createHmac('sha512', c.paystack).update(body).digest('hex');
    expect(
      (
        await request(target)
          .post('/v1/webhooks/paystack')
          .set('x-paystack-signature', signature)
          .set('Content-Type', 'application/json')
          .send(body)
      ).status,
    ).toBe(200);
  }
  const walletOf = async (id: string) =>
    Number(
      (
        await db.query(
          "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM ledger WHERE account='wallet' AND owner_id=$1",
          [id],
        )
      )[0].n,
    );
  const pastGrace = () => db.query("UPDATE funding SET credited_at=now()-interval '1 hour'");

  it('switches later-phase features off and tells clients', () => {
    expect(readFeatures({}).shopping).toBe(true);
    expect(readFeatures({ PILOT_MODE: 'true' })).toEqual({
      wallet: false,
      local_status: false,
      promotions: false,
      shopping: false,
      parcels: false,
      voice: false,
      preorders: false,
      market_maps: false,
    });
    expect(readFeatures({ PILOT_MODE: 'true', FEATURE_VOICE: 'true' }).voice).toBe(true);
  });
  it('hides switched-off routes, keeps the core loop, and refuses wallet-only options', async () => {
    const app = pilot();
    const settings = (await as(app, 'buyer', 'get', '/settings')).body;
    expect(settings.features.wallet).toBe(false);
    for (const [method, path] of [
      ['get', '/shopping'],
      ['get', '/local-status'],
      ['get', '/parcels'],
      ['get', '/voice/config'],
      ['post', '/wallet/fund'],
      ['get', '/admin/shopping'],
      ['get', '/admin/promotions'],
    ] as const) {
      const r = await as(
        app,
        method === 'get' ? 'admin' : 'buyer',
        method,
        path,
        method === 'post' ? {} : undefined,
      );
      expect([path, r.status, r.body.error?.code]).toEqual([path, 404, 'FEATURE_DISABLED']);
    }
    expect((await as(app, 'buyer', 'get', '/bookings')).status).toBe(200);
    const listing = await setup();
    const preorder = await as(app, 'seller', 'post', '/listings', {
      title: 'Next month yams',
      description: 'Harvesting soon from the farm',
      category: 'Tubers',
      unit: 'kg',
      price_kobo: 50000,
      stock: 0,
      available_from: new Date(Date.now() + 7 * 86400000).toISOString(),
      preorder_capacity: 10,
    });
    expect(preorder.body.error?.code).toBe('FEATURE_DISABLED');
    expect((await as(app, 'admin', 'get', `/sellers/seller/listings`)).status).toBe(200);
    const pod = await as(app, 'admin', 'put', '/admin/settings', {
      reservation_hours: 168,
      commission_bps: 500,
      pay_on_delivery_enabled: true,
    });
    expect(pod.body.error?.code).toBe('WALLET_REQUIRED');
    expect(listing).toBeTruthy();
  });
  it('pays a booking directly at the provider, once, with nothing left in a wallet', async () => {
    const provider = fakeProvider();
    const app = pilot();
    const { b } = await accepted();
    const checkout = await as(app, 'buyer', 'post', '/payments/checkout', {
      purpose: 'booking',
      provider: 'paystack',
      booking_id: b,
    });
    expect(checkout.status).toBe(200);
    expect(checkout.body.checkout_url).toContain('checkout.paystack.test');
    expect(provider.amounts.get(checkout.body.reference)).toBe(200000);
    provider.paid.add(checkout.body.reference);
    await payWebhook(app, checkout.body.reference);
    await payWebhook(app, checkout.body.reference);
    const [booking] = await db.query('SELECT paid FROM bookings WHERE id=$1', [b]);
    expect(booking.paid).toBe(true);
    expect(await walletOf('buyer')).toBe(0);
    expect(
      (
        await as(app, 'buyer', 'post', '/payments/checkout', {
          purpose: 'booking',
          provider: 'paystack',
          booking_id: b,
        })
      ).body.error?.code,
    ).toBe('ALREADY_PAID');
    expect(await ledgerBalances()).toBe(0);
  });
  it('refunds a cancelled direct payment to the card exactly once', async () => {
    const provider = fakeProvider();
    const app = pilot();
    const { b } = await accepted();
    const ref = (
      await as(app, 'buyer', 'post', '/payments/checkout', {
        purpose: 'booking',
        provider: 'paystack',
        booking_id: b,
      })
    ).body.reference;
    provider.paid.add(ref);
    await payWebhook(app, ref);
    expect((await as(app, 'buyer', 'post', `/bookings/${b}/cancel`, {})).status).toBe(200);
    expect(await walletOf('buyer')).toBe(200000);
    const { runCardRefunds } = await import('../src/services/card-refunds.service.js');
    const cfg = { ...c, features: pilotFeatures() };
    // Inside the grace period nothing is refunded yet.
    expect((await runCardRefunds(db, cfg)).queued).toBe(0);
    await pastGrace();
    await Promise.all([runCardRefunds(db, cfg), runCardRefunds(db, cfg)]);
    await runCardRefunds(db, cfg);
    expect(provider.refunds).toEqual([{ transaction: ref, amount: 200000 }]);
    const [refund] = await db.query('SELECT * FROM card_refunds');
    expect(refund.status).toBe('REFUNDED');
    expect(await walletOf('buyer')).toBe(0);
    expect(
      (await db.query('SELECT refunded_kobo FROM funding WHERE id=$1', [ref]))[0].refunded_kobo,
    ).toBe(200000);
    expect((await as(app, 'buyer', 'get', '/wallet')).body.refunds[0].status).toBe('REFUNDED');
    expect(await ledgerBalances()).toBe(0);
  });
  it('never resends a refund with an unknown outcome; staff settle rejected ones', async () => {
    const provider = fakeProvider();
    const app = pilot();
    const { runCardRefunds } = await import('../src/services/card-refunds.service.js');
    const cfg = { ...c, features: pilotFeatures() };
    const pay = async () => {
      const { b } = await accepted();
      const ref = (
        await as(app, 'buyer', 'post', '/payments/checkout', {
          purpose: 'booking',
          provider: 'paystack',
          booking_id: b,
        })
      ).body.reference;
      provider.paid.add(ref);
      await payWebhook(app, ref);
      await as(app, 'buyer', 'post', `/bookings/${b}/cancel`, {});
      await pastGrace();
    };
    await pay();
    provider.refund = 'down';
    await runCardRefunds(db, cfg);
    provider.refund = 'ok';
    await runCardRefunds(db, cfg);
    const [unknown] = await db.query('SELECT * FROM card_refunds');
    expect(unknown.status).toBe('SENDING');
    expect(unknown.error).toMatch(/may or may not/);
    expect(provider.refunds).toHaveLength(0);
    const resolve = (id: string, body: object, actor = 'admin') =>
      as(app, actor, 'post', `/admin/refunds/${id}/resolve`, body);
    expect((await resolve(unknown.id, { outcome: 'REFUNDED', reason: 'x' })).status).toBe(400);
    expect(
      (
        await resolve(
          unknown.id,
          { outcome: 'RETRY', reason: 'Paystack dashboard shows no refund' },
          'seller',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await resolve(unknown.id, {
          outcome: 'RETRY',
          reason: 'Paystack dashboard shows no refund',
        })
      ).body.status,
    ).toBe('PENDING');
    await runCardRefunds(db, cfg);
    expect(provider.refunds).toHaveLength(1);
    expect(
      (await db.query('SELECT status FROM card_refunds WHERE id=$1', [unknown.id]))[0].status,
    ).toBe('REFUNDED');
    expect(await ledgerBalances()).toBe(0);
  });
  it('marks a provider-rejected refund FAILED and keeps the money held for staff', async () => {
    const provider = fakeProvider();
    const app = pilot();
    const { runCardRefunds } = await import('../src/services/card-refunds.service.js');
    const cfg = { ...c, features: pilotFeatures() };
    const { b } = await accepted();
    const ref = (
      await as(app, 'buyer', 'post', '/payments/checkout', {
        purpose: 'booking',
        provider: 'paystack',
        booking_id: b,
      })
    ).body.reference;
    provider.paid.add(ref);
    await payWebhook(app, ref);
    await as(app, 'buyer', 'post', `/bookings/${b}/cancel`, {});
    await pastGrace();
    provider.refund = 'reject';
    await runCardRefunds(db, cfg);
    await runCardRefunds(db, cfg);
    const rows = await db.query('SELECT * FROM card_refunds');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('FAILED');
    const held = await db.query(
      "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM ledger WHERE account='refund_pending'",
    );
    expect(Number(held[0].n)).toBe(200000);
    const done = await as(app, 'admin', 'post', `/admin/refunds/${rows[0].id}/resolve`, {
      outcome: 'REFUNDED',
      reason: 'Refunded by hand in the Paystack dashboard',
    });
    expect(done.body.status).toBe('REFUNDED');
    expect(await ledgerBalances()).toBe(0);
  });
  it('refunds a checkout that arrives after its booking expired', async () => {
    const provider = fakeProvider();
    const app = pilot();
    const { b } = await accepted();
    const ref = (
      await as(app, 'buyer', 'post', '/payments/checkout', {
        purpose: 'booking',
        provider: 'paystack',
        booking_id: b,
      })
    ).body.reference;
    await db.query("UPDATE bookings SET reserved_until=now()-interval '1 minute' WHERE id=$1", [b]);
    provider.paid.add(ref);
    await payWebhook(app, ref);
    expect((await db.query('SELECT paid FROM bookings WHERE id=$1', [b]))[0].paid).toBe(false);
    expect(await walletOf('buyer')).toBe(200000);
    await pastGrace();
    const { runCardRefunds } = await import('../src/services/card-refunds.service.js');
    await runCardRefunds(db, { ...c, features: pilotFeatures() });
    expect(provider.refunds).toEqual([{ transaction: ref, amount: 200000 }]);
    expect(await ledgerBalances()).toBe(0);
  });
  it('pays for a membership by card through the Paystack checkout', async () => {
    const provider = fakeProvider();
    const app = pilot();
    const sub = await as(app, 'buyer', 'post', '/me/subscriptions', {
      plan_id: 'ahia-plus',
      pay_with: 'card',
    });
    expect(sub.body).toMatchObject({ status: 'PENDING_PAYMENT', pay_by_card: true });
    const checkout = await as(app, 'buyer', 'post', '/payments/checkout', {
      purpose: 'subscription',
      provider: 'paystack',
      subscription_id: sub.body.id,
    });
    expect(checkout.status).toBe(200);
    const ref = checkout.body.reference;
    expect(provider.amounts.get(ref)).toBe(200000);
    provider.paid.add(ref);
    await payWebhook(app, ref);
    await payWebhook(app, ref);
    const [mine] = await db.query(
      'SELECT status,payment_reference FROM subscriptions WHERE id=$1',
      [sub.body.id],
    );
    expect(mine).toEqual({ status: 'ACTIVE', payment_reference: ref });
    // The payment became revenue, not a wallet balance.
    expect(await walletOf('buyer')).toBe(0);
    const [rev] = await db.query(
      "SELECT COALESCE(SUM(amount_kobo),0)::int AS total FROM ledger WHERE account='platform_revenue'",
    );
    expect(rev.total).toBe(200000);
    expect(await ledgerBalances()).toBe(0);
  });
});
describe('rider and call privacy', () => {
  it('never reveals exact rider positions to nearby-rider searches', async () => {
    await db.query(
      "INSERT INTO drivers(user_id,vehicle_type,plate_number,licence_number,city,status,online,latitude,longitude,location_at) VALUES('other','motorcycle','LAG-123-XY','ABC12345','Lagos','APPROVED',true,6.5512,3.3517,now())",
    );
    const search = async (lat: number, lng: number) =>
      (await call('buyer', 'get', `/riders/nearby?lat=${lat}&lng=${lng}`)).body;
    const a = await search(6.5513, 3.3518);
    expect(a).toHaveLength(1);
    expect(a[0].latitude).toBeUndefined();
    // Points inside the same ~1 km grid cell give identical answers, so probing reveals nothing.
    expect(await search(6.5541, 3.3549)).toEqual(a);
    for (const [lat, lng] of [
      [6.5513, 3.3518],
      [6.57, 3.36],
      [6.6, 3.4],
    ]) {
      const [r] = await search(lat, lng);
      expect(r.distance_km).toBeGreaterThanOrEqual(0.5);
      expect((r.distance_km * 2) % 1).toBe(0);
    }
  });
  async function convo() {
    const listing = await setup();
    return (await call('buyer', 'post', '/conversations', { listing_id: listing })).body
      .id as string;
  }
  it('keeps voice calls off outside demo mode until a TURN relay is configured', async () => {
    const id = await convo();
    const live = createApp(db, {
      ...c,
      demo: false,
      voiceEnabled: true,
      voiceTurnUrl: '',
      voiceTurnSecret: '',
    });
    const auth = (r: any) =>
      r.set('Authorization', 'Bearer token-buyer').set('Idempotency-Key', randomUUID());
    const cfg = (await auth(request(live).get('/v1/voice/config'))).body;
    expect(cfg.enabled).toBe(false);
    expect(cfg.ice_transport_policy).toBe('relay');
    expect((await auth(request(live).post(`/v1/conversations/${id}/call`))).status).toBe(503);
  });
  it('relays calls only: direct network addresses never reach the other participant', async () => {
    const id = await convo();
    const relayed = createApp(db, {
      ...c,
      demo: false,
      voiceEnabled: true,
      voiceTurnUrl: 'turn:turn.example.test:3478',
      voiceTurnSecret: 'turn-secret',
      voiceStunUrl: 'stun:stun.example.test:3478',
    });
    const as = (actor: string, r: any) =>
      r.set('Authorization', `Bearer token-${actor}`).set('Idempotency-Key', randomUUID());
    const cfg = (await as('buyer', request(relayed).get('/v1/voice/config'))).body;
    expect(cfg.ice_transport_policy).toBe('relay');
    expect(cfg.ice_servers.every((s: any) => s.credential)).toBe(true);
    const callId = (await as('buyer', request(relayed).post(`/v1/conversations/${id}/call`))).body
      .id;
    const sdp = [
      'v=0',
      'a=candidate:1 1 udp 2122260223 192.168.1.20 54400 typ host',
      'a=candidate:2 1 udp 1686052607 102.89.4.7 54400 typ srflx raddr 192.168.1.20 rport 54400',
      'a=candidate:3 1 udp 41885439 203.0.113.9 3478 typ relay raddr 102.89.4.7 rport 54400',
    ].join('\r\n');
    const signal = (body: object) =>
      as('buyer', request(relayed).post(`/v1/voice/${callId}/signals`)).send(body);
    expect((await signal({ kind: 'offer', payload: { type: 'offer', sdp } })).status).toBe(200);
    for (const candidate of [
      'candidate:1 1 udp 2122260223 192.168.1.20 54400 typ host',
      'candidate:3 1 udp 41885439 203.0.113.9 3478 typ relay raddr 102.89.4.7 rport 54400',
    ])
      expect((await signal({ kind: 'ice', payload: { candidate, sdpMid: '0' } })).status).toBe(200);
    const seen = JSON.stringify(
      (await as('seller', request(relayed).get(`/v1/voice/${callId}/signals`))).body,
    );
    expect(seen).not.toContain('192.168.1.20 54400 typ host');
    expect(seen).not.toContain('typ srflx');
    expect(seen).toContain('203.0.113.9 3478 typ relay');
    // The relay candidate's related address is the caller's public IP: it is masked too.
    expect(seen).not.toContain('102.89.4.7');
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
    expect(preflight.headers['access-control-allow-headers']).toContain('X-Act-As-Seller');
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
    // A Render-style staging environment is accepted: URL and origins come from Render's values.
    const render = readEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db/x',
      OTP_SECRET: 'x'.repeat(44),
      PAYOUT_ENCRYPTION_KEY: 'y'.repeat(44),
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'Ahia <no-reply@example.com>',
      RENDER_EXTERNAL_URL: 'https://ahia-api.onrender.com',
      RENDER_GIT_COMMIT: 'abc123',
      CORS_ALLOWED_HOSTS_ADMIN: 'ahia-admin.onrender.com',
    });
    expect(productionProblems(render)).toEqual([]);
    expect(render.PUBLIC_API_URL).toBe('https://ahia-api.onrender.com');
    expect(render.CORS_ORIGINS).toBe('');
    expect(render.GIT_COMMIT).toBe('abc123');
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
describe('cart', () => {
  it('collects items from several sellers and sends each seller a booking request', async () => {
    const tomatoes = await setup(10);
    const add = await call('buyer', 'post', '/cart', { listing_id: tomatoes, quantity: 2 });
    expect(add.status).toBe(200);
    // Adding the same product again increases the quantity.
    await call('buyer', 'post', '/cart', { listing_id: tomatoes, quantity: 1 });
    let cart = (await call('buyer', 'get', '/cart')).body;
    expect(cart.line_count).toBe(1);
    expect(cart.sellers[0].lines[0].quantity).toBe(3);
    expect(cart.total_kobo).toBe(300000);
    expect((await call('seller', 'post', '/cart', { listing_id: tomatoes })).body.error.code).toBe(
      'OWN_LISTING',
    );
    expect((await call('buyer', 'patch', `/cart/${add.body.id}`, { quantity: 12 })).status).toBe(
      200,
    );
    cart = (await call('buyer', 'get', '/cart')).body;
    expect(cart.sellers[0].lines[0].problem).toBe('Only 10 kg left');
    const tooMany = await call('buyer', 'post', '/cart/checkout', {});
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.message).toMatch(/^Fresh tomatoes: /);
    await call('buyer', 'patch', `/cart/${add.body.id}`, { quantity: 4 });
    const done = await call('buyer', 'post', '/cart/checkout', {});
    expect(done.status).toBe(200);
    expect(done.body.bookings).toHaveLength(1);
    expect(done.body.bookings[0]).toMatchObject({ status: 'REQUESTED', quantity: 4 });
    expect((await call('buyer', 'get', '/cart')).body.line_count).toBe(0);
    expect((await call('buyer', 'post', '/cart/checkout', {})).body.error.code).toBe('CART_EMPTY');
    const again = await call('buyer', 'post', '/cart', { listing_id: tomatoes });
    expect((await call('buyer', 'delete', `/cart/${again.body.id}`)).status).toBe(200);
  });
});

describe('smart planner', () => {
  it('reads a short request into a guided plan', async () => {
    const read = await call('buyer', 'post', '/planner/read', {
      text: 'Help me furnish a 2-bedroom flat with ₦5m',
    });
    expect(read.body).toMatchObject({ template: 'home-setup', budget_kobo: 500000000, rooms: 2 });
    const party = await call('buyer', 'post', '/planner/read', {
      text: 'birthday party for 50 guests, 800k naira',
    });
    expect(party.body).toMatchObject({ template: 'party', people: 50, budget_kobo: 80000000 });
    const templates = (await call('buyer', 'get', '/planner/templates')).body;
    expect(templates.map((t: any) => t.key)).toContain('meal-plan');
  });

  it('builds a home plan from a template and tracks budget, products and spending', async () => {
    const created = await call('buyer', 'post', '/plans', {
      template: 'home-setup',
      title: 'Our new flat',
      budget_kobo: 100000000,
      rooms: 2,
      people: 3,
      tier: 'BASIC',
    });
    expect(created.status).toBe(200);
    const planId = created.body.id;
    let plan = (await call('buyer', 'get', `/plans/${planId}`)).body;
    const beds = plan.items.find((i: any) => i.name === 'Bed frame');
    expect(beds).toMatchObject({
      quantity: 2,
      budget_kobo: 2 * 90000 * 100,
      priority: 'ESSENTIAL',
    });
    // Basic furniture for two bedrooms costs more than ₦1m, so the plan is over budget.
    expect(plan.summary.over_budget_kobo).toBeGreaterThan(0);
    expect(plan.summary.suggestions[0]).toMatch(/over budget/);
    expect(plan.summary.sections.map((s: any) => s.section)).toContain('Bedroom');

    // A custom item, matched to a real listing and bought through the cart.
    const tomatoes = await setup(10);
    const item = await call('buyer', 'post', `/plans/${planId}/items`, {
      name: 'Tomatoes for the house-warming',
      keywords: 'tomatoes',
      category: 'Vegetables',
      quantity: 2,
      unit: 'kg',
      budget_kobo: 250000,
    });
    const found = await call('buyer', 'get', `/plans/${planId}/items/${item.body.id}/matches`);
    expect(found.body.items[0]).toMatchObject({
      listing_id: tomatoes,
      within_estimate: true,
      sponsored: false,
    });
    expect(found.body.items[0].reasons).toContain('Within your estimate');
    await call('buyer', 'post', '/cart', {
      listing_id: tomatoes,
      quantity: 2,
      plan_item_id: item.body.id,
    });
    const order = await call('buyer', 'post', '/cart/checkout', {});
    expect(order.body.bookings[0].plan_item_id).toBe(item.body.id);
    plan = (await call('buyer', 'get', `/plans/${planId}`)).body;
    expect(plan.summary.requested_kobo).toBe(200000);
    expect(plan.items.find((i: any) => i.id === item.body.id).listing.listing_id).toBe(tomatoes);
    await call('seller', 'post', `/bookings/${order.body.bookings[0].id}/accept`);
    plan = (await call('buyer', 'get', `/plans/${planId}`)).body;
    expect(plan.summary).toMatchObject({ spent_kobo: 200000, remaining_kobo: 100000000 - 200000 });

    // Another user cannot see or attach to this plan.
    expect((await call('other', 'get', `/plans/${planId}`)).status).toBe(404);
    expect(
      (
        await call('other', 'post', '/cart', {
          listing_id: tomatoes,
          plan_item_id: item.body.id,
        })
      ).body.error.code,
    ).toBe('PLAN_ITEM_NOT_FOUND');

    // Editing, statuses, duplicating and deleting.
    const rug = plan.items.find((i: any) => i.name === 'Rug');
    await call('buyer', 'patch', `/plans/${planId}/items/${rug.id}`, { status: 'OWNED' });
    await call('buyer', 'patch', `/plans/${planId}`, { budget_kobo: 900000000, status: 'PAUSED' });
    plan = (await call('buyer', 'get', `/plans/${planId}`)).body;
    expect(plan.status).toBe('PAUSED');
    expect(plan.summary.over_budget_kobo).toBe(0);
    const copy = await call('buyer', 'post', `/plans/${planId}/duplicate`, {});
    const copied = (await call('buyer', 'get', `/plans/${copy.body.id}`)).body;
    expect(copied.items.length).toBe(plan.items.length);
    expect(copied.items.find((i: any) => i.name === 'Rug').status).toBe('OWNED');
    expect((await call('buyer', 'get', '/plans')).body).toHaveLength(2);
    expect((await call('buyer', 'delete', `/plans/${planId}/items/${rug.id}`)).status).toBe(200);
    expect((await call('buyer', 'delete', `/plans/${copy.body.id}`)).status).toBe(200);
    expect((await call('buyer', 'get', '/plans')).body).toHaveLength(1);
  });

  it('plans meals into a grocery list and respects the allergy profile', async () => {
    const plan = await call('buyer', 'post', '/plans', { template: 'meal-plan', people: 4 });
    const planId = plan.body.id;
    const jollof = await call('buyer', 'post', `/plans/${planId}/meals`, {
      recipe: 'jollof-rice',
      day: 1,
      servings: 4,
    });
    expect(jollof.status).toBe(200);
    await call('buyer', 'post', `/plans/${planId}/meals`, {
      recipe: 'yam-and-egg',
      day: 2,
      meal: 'BREAKFAST',
      servings: 4,
    });
    const list = await call('buyer', 'post', `/plans/${planId}/grocery-list`, {});
    expect(list.body.added).toBeGreaterThan(5);
    let detail = (await call('buyer', 'get', `/plans/${planId}`)).body;
    const rice = detail.items.find((i: any) => i.ingredient_key === 'rice');
    expect(rice).toMatchObject({ quantity: 1, unit: 'kg', source: 'RECIPE' }); // 0.6 kg → 1 kg
    const eggs = detail.items.find((i: any) => i.ingredient_key === 'eggs');
    expect(eggs.quantity).toBe(8);

    // Allergy information needs consent, then filters recipes and flags ingredients.
    expect(
      (await call('buyer', 'put', '/planner/diet-profile', { allergies: ['shellfish', 'egg'] }))
        .body.error.code,
    ).toBe('CONSENT_REQUIRED');
    await call('buyer', 'put', '/planner/diet-profile', {
      allergies: ['shellfish', 'egg'],
      patterns: ['no_pork'],
      consent: true,
    });
    const profile = (await call('buyer', 'get', '/planner/diet-profile')).body;
    expect(profile.profile.allergies).toEqual(['shellfish', 'egg']);
    expect(profile.profile.consented_at).toBeTruthy();
    const recipes = (await call('buyer', 'get', '/planner/recipes')).body;
    const egusi = recipes.find((r: any) => r.key === 'egusi-soup');
    expect(egusi).toMatchObject({ diet_status: 'EXCLUDED' });
    expect(egusi.diet_reasons[0]).toMatch(/Shellfish/);
    expect(recipes.find((r: any) => r.key === 'jollof-rice').diet_status).toBe('OK');
    const blocked = await call('buyer', 'post', `/plans/${planId}/meals`, {
      recipe: 'egusi-soup',
      servings: 4,
    });
    expect(blocked.body.error.code).toBe('DIET_CONFLICT');
    detail = (await call('buyer', 'get', `/plans/${planId}`)).body;
    expect(detail.items.find((i: any) => i.ingredient_key === 'eggs').allergy_warning).toMatch(
      /Eggs/,
    );
    // Food matches never claim to be safe: allergen data is shown as unknown.
    const listing = await setup(10);
    const tomatoes = detail.items.find((i: any) => i.ingredient_key === 'tomatoes');
    const found = (await call('buyer', 'get', `/plans/${planId}/items/${tomatoes.id}/matches`))
      .body;
    expect(found.items[0].listing_id).toBe(listing);
    expect(found.items[0].allergen_note).toMatch(/Allergen information unavailable/);
    // Sellers never see a buyer's diet profile; the buyer can delete it.
    expect((await call('seller', 'get', '/planner/diet-profile')).body.profile.allergies).toEqual(
      [],
    );
    expect((await call('buyer', 'delete', '/planner/diet-profile')).status).toBe(200);
    // Removing a meal and rebuilding drops ingredients no longer needed.
    const yamMeal = detail.meals.find((m: any) => m.recipe === 'yam-and-egg');
    await call('buyer', 'delete', `/plans/${planId}/meals/${yamMeal.id}`);
    const rebuilt = await call('buyer', 'post', `/plans/${planId}/grocery-list`, {});
    expect(rebuilt.body.removed).toBeGreaterThan(0);
  });

  it('takes allergen reports for staff review and shows aggregate planner usage', async () => {
    const listing = await setup(10);
    expect(
      (
        await call('buyer', 'post', '/planner/allergen-reports', {
          issue: 'MISSING',
          details: 'short',
        })
      ).status,
    ).toBe(400);
    const sent = await call('buyer', 'post', '/planner/allergen-reports', {
      listing_id: listing,
      issue: 'REACTION',
      allergens: ['peanut'],
      details: 'My son reacted after eating this; the seller said it had no groundnut.',
    });
    expect(sent.status).toBe(200);
    expect(sent.body.message).toMatch(/medical help/);
    await call('buyer', 'post', '/planner/allergen-reports', {
      recipe: 'egusi-soup',
      issue: 'INCORRECT',
      details: 'The recipe should say it contains crayfish (shellfish).',
    });
    expect((await call('buyer', 'get', '/planner/allergen-reports')).body).toHaveLength(2);
    // Support staff see urgent reports first; finance staff cannot open them.
    await db.query("UPDATE users SET staff_role='finance' WHERE id='admin'");
    expect((await call('admin', 'get', '/admin/allergen-reports')).status).toBe(403);
    expect((await call('admin', 'get', '/admin/planner/usage')).status).toBe(200);
    await db.query("UPDATE users SET staff_role='support' WHERE id='admin'");
    const queue = (await call('admin', 'get', '/admin/allergen-reports')).body;
    expect(queue[0]).toMatchObject({
      urgent: true,
      issue: 'REACTION',
      business_name: 'Ada’s Farm',
    });
    expect(
      (
        await call('admin', 'post', `/admin/allergen-reports/${queue[0].id}/review`, {
          status: 'RESOLVED',
          resolution: 'Seller confirmed groundnut oil is used; listing paused until relabelled.',
        })
      ).status,
    ).toBe(200);
    const closed = await call('admin', 'post', `/admin/allergen-reports/${queue[0].id}/review`, {
      status: 'DISMISSED',
      resolution: 'Trying to change a closed report again.',
    });
    expect(closed.body.error.code).toBe('ALREADY_CLOSED');
    const [logged] = await db.query(
      "SELECT action FROM audit WHERE entity_id=$1 AND action='allergen_report.resolved'",
      [queue[0].id],
    );
    expect(logged).toBeTruthy();
    const [note] = await db.query(
      "SELECT title FROM notifications WHERE user_id='buyer' AND title='Allergen report reviewed'",
    );
    expect(note).toBeTruthy();

    // Usage is aggregate; small health counts are masked.
    await call('buyer', 'post', '/plans', { template: 'party', people: 30 });
    await call('buyer', 'put', '/planner/diet-profile', { allergies: ['peanut'], consent: true });
    const usage = (await call('admin', 'get', '/admin/planner/usage')).body;
    expect(usage.plans.total).toBe(1);
    expect(usage.by_template[0]).toMatchObject({
      template: 'party',
      title: 'Party or celebration',
    });
    expect(usage.diet.with_allergies).toBe('<5');
    expect(usage.allergen_reports).toMatchObject({ open: 1, urgent: 0, total: 2 });
    expect(usage.daily).toHaveLength(14);
    expect(JSON.stringify(usage)).not.toMatch(/buyer@|Buyer/);
  });
});

describe('step-by-step planner', () => {
  const preview = (template: string, answers: any = {}, budget_kobo?: number) =>
    call('buyer', 'post', '/planner/preview', { template, answers, budget_kobo });
  it('asks guided questions for every plan type and fits the list to the budget', async () => {
    const templates = (await call('buyer', 'get', '/planner/templates')).body;
    const guided = templates.filter((t: any) => t.wizard).map((t: any) => t.key);
    expect(guided).toEqual(
      expect.arrayContaining([
        'groceries',
        'meal-plan',
        'kitchen-utensils',
        'household',
        'home-setup',
        'wedding',
        'party',
        'office-setup',
        'back-to-school',
      ]),
    );
    for (const key of guided) {
      const w = (await call('buyer', 'get', `/planner/templates/${key}/wizard`)).body;
      expect(w.steps.length).toBeGreaterThanOrEqual(5);
      const p = (await preview(key, w.defaults)).body;
      expect(p.total_kobo).toBeGreaterThan(0);
      expect(p.have_options.length).toBeGreaterThan(0);
      // A tight budget is met by trimming, or the shortfall is reported.
      const tight = (await preview(key, w.defaults, Math.round(p.total_kobo * 0.7))).body;
      expect(tight.total_kobo).toBeLessThanOrEqual(p.total_kobo);
      if (tight.fits) expect(tight.total_kobo).toBeLessThanOrEqual(Math.round(p.total_kobo * 0.7));
    }
    expect((await call('buyer', 'get', '/planner/templates/custom/wizard')).status).toBe(404);
  });
  it('sizes a plan from the answers and leaves out what you already have', async () => {
    const small = (await preview('home-setup', { bedrooms: 1, rooms: ['bedroom'] })).body;
    const big = (await preview('home-setup', { bedrooms: 3, rooms: ['bedroom'] })).body;
    expect(big.total_kobo).toBeGreaterThan(small.total_kobo);
    // Answers switch whole sections on: AC only when picked.
    const names = (p: any) => p.lines.map((l: any) => l.name);
    expect(names(small)).not.toContain('Bedroom air conditioners (1 hp)');
    const cool = (await preview('home-setup', { rooms: ['bedroom'], comfort: ['ac'] })).body;
    expect(names(cool)).toContain('Bedroom air conditioners (1 hp)');
    const created = await call('buyer', 'post', '/plans', {
      template: 'home-setup',
      answers: { bedrooms: 2, rooms: ['living', 'bedroom'], have: ['Mattress'], quality: 'BASIC' },
      budget_kobo: 300000000,
    });
    expect(created.body).toMatchObject({ fits: true, budget_kobo: 300000000 });
    const plan = (await call('buyer', 'get', `/plans/${created.body.id}`)).body;
    expect(plan).toMatchObject({ tier: 'BASIC', rooms: 2 });
    const mattress = plan.items.find((i: any) => i.name === 'Mattress');
    expect(mattress.status).toBe('OWNED');
    expect(plan.items.find((i: any) => i.name === 'Bed frame').quantity).toBe(2);
    expect(plan.summary.estimate_kobo).toBe(created.body.total_kobo);
  });
  it('plans meals for chosen days, avoids dislikes and swaps a dish', async () => {
    const answers = {
      adults: 2,
      kids: 1,
      days: ['MON', 'WED', 'FRI'],
      meals: ['BREAKFAST', 'DINNER'],
      kitchen: ['blender', 'gas'],
      dislikes: ['beef', 'eggs'],
      have: ['salt', 'veg_oil'],
    };
    const p = (await preview('meal-plan', answers)).body;
    expect(new Set(p.meals.map((m: any) => m.day))).toEqual(new Set([1, 3, 5]));
    expect(p.meals.every((m: any) => ['BREAKFAST', 'DINNER'].includes(m.meal))).toBe(true);
    expect(p.lines.some((l: any) => l.key === 'beef' || l.key === 'eggs')).toBe(false);
    expect(p.lines.find((l: any) => l.key === 'salt')?.have).toBe(true);
    const created = (await call('buyer', 'post', '/plans', { template: 'meal-plan', answers }))
      .body;
    const plan = (await call('buyer', 'get', `/plans/${created.id}`)).body;
    expect(plan.meals.length).toBe(p.meals.length);
    expect(plan.answers.days).toEqual(['MON', 'WED', 'FRI']);
    expect(plan.items.find((i: any) => i.ingredient_key === 'salt')?.status).toBe('OWNED');
    const first = plan.meals.find((m: any) => m.meal === 'DINNER');
    const swapped = await call('buyer', 'post', `/plans/${created.id}/meals/${first.id}/swap`, {});
    expect(swapped.body.recipe).not.toBe(first.recipe);
    const after = (await call('buyer', 'get', `/plans/${created.id}`)).body;
    expect(after.meals.find((m: any) => m.id === first.id).recipe).toBe(swapped.body.recipe);
  });
});
describe('planner extras', () => {
  /** Three approved sellers each selling rice by the kg. */
  async function riceSellers() {
    for (const [actor, naira] of [
      ['seller', 1500],
      ['other', 2000],
      ['admin', 2600],
    ] as const) {
      await call(actor, 'post', '/sellers', {
        business_name: `${actor} stores`,
        business_type: 'home_based',
        city: 'Lagos',
        area: 'Ikorodu',
        address: 'PRIVATE 1 Market Road',
      });
      await call('admin', 'post', `/admin/sellers/${actor}/review`, {
        status: 'APPROVED',
        reason: 'Checked',
      });
      const l = await call(actor, 'post', '/listings', {
        title: 'Local rice',
        description: 'Clean stone-free local rice',
        category: 'Grains',
        unit: 'kg',
        price_kobo: naira * 100,
        stock: 100,
      });
      expect(l.status).toBe(200);
    }
    clearMarketCache();
  }
  const riceOnly = {
    adults: 2,
    kids: 0,
    duration: 'month',
    staples: ['rice'],
    protein: [],
    extras: [],
  };
  it('prices items from Ahia sellers and fills the cart with the whole plan', async () => {
    await riceSellers();
    const p = (
      await call('buyer', 'post', '/planner/preview', { template: 'groceries', answers: riceOnly })
    ).body;
    const rice = p.lines.find((l: any) => l.name === 'Rice');
    expect(rice).toMatchObject({ price_source: 'MARKET', sellers: 3 });
    // Standard quality uses the middle seller price: 8 kg × ₦2,000.
    expect(rice.kobo).toBe(8 * 2000 * 100);
    expect(p.market_count).toBeGreaterThanOrEqual(1);
    const plan = (
      await call('buyer', 'post', '/plans', { template: 'groceries', answers: riceOnly })
    ).body;
    const filled = (await call('buyer', 'post', `/plans/${plan.id}/fill-cart`, {})).body;
    expect(filled.added).toBeGreaterThanOrEqual(1);
    expect(filled.missing.length).toBeGreaterThan(0);
    const cart = (await call('buyer', 'get', '/cart')).body;
    expect(JSON.stringify(cart)).toContain('Local rice');
    const detail = (await call('buyer', 'get', `/plans/${plan.id}`)).body;
    const linked = detail.items.find((i: any) => i.name === 'Rice');
    expect(linked.status).toBe('SAVED');
    // A price drop on the chosen product is announced once.
    await db.query('UPDATE listing_variants SET price_kobo=price_kobo/2 WHERE listing_id=$1', [
      linked.listing.listing_id,
    ]);
    await plannerReminders(db);
    await plannerReminders(db);
    const notes = await db.query(
      "SELECT title FROM notifications WHERE user_id='buyer' AND title LIKE 'Price drop%'",
    );
    expect(notes).toHaveLength(1);
  });
  it('reads a typed request into answers, translates questions and repeats a list', async () => {
    const read = (
      await call('buyer', 'post', '/planner/read', {
        text: 'Traditional and white wedding for 300 guests with ₦8m',
      })
    ).body;
    expect(read).toMatchObject({ template: 'wedding', budget_kobo: 800000000 });
    expect(read.answers).toMatchObject({ guests: 300, ceremonies: ['trad', 'white'] });
    const pcm = (await call('buyer', 'get', '/planner/templates/groceries/wizard?lang=pcm')).body;
    expect(pcm.steps[0].title).toBe('Na who you dey buy for?');
    const plan = (
      await call('buyer', 'post', '/plans', { template: 'groceries', answers: riceOnly })
    ).body;
    const again = (await call('buyer', 'post', `/plans/${plan.id}/repeat`, {})).body;
    const copy = (await call('buyer', 'get', `/plans/${again.id}`)).body;
    expect(copy.title).toMatch(/^Grocery & foodstuff shopping · [A-Z][a-z]+ \d{4}$/);
    expect(
      copy.items.every((i: any) => ['PLANNED', 'SAVED', 'NOT_NEEDED'].includes(i.status)),
    ).toBe(true);
    expect(copy.answers.staples).toEqual(['rice']);
  });
  it('schedules buy-by dates, reminds, assigns to family and rebuilds from new answers', async () => {
    const target = new Date(Date.now() + 100 * 86400000).toISOString().slice(0, 10);
    const created = (
      await call('buyer', 'post', '/plans', {
        template: 'wedding',
        answers: { ceremonies: ['white', 'reception'], covering: ['venue', 'drinks'] },
        target_date: target,
      })
    ).body;
    let plan = (await call('buyer', 'get', `/plans/${created.id}`)).body;
    const venue = plan.items.find((i: any) => i.name === 'Hall or venue hire');
    expect(venue.buy_by).toBe(new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10));
    await db.query('UPDATE plan_items SET buy_by=current_date WHERE id=$1', [venue.id]);
    await plannerReminders(db);
    const [note] = await db.query(
      "SELECT body FROM notifications WHERE user_id='buyer' AND title LIKE 'Time to buy%'",
    );
    expect(note.body).toContain('Hall or venue hire');
    // Assigning needs the person on the plan.
    const water = plan.items.find((i: any) => i.name === 'Bottled water');
    expect(
      (
        await call('buyer', 'patch', `/plans/${created.id}/items/${water.id}`, {
          assignee_id: 'other',
        })
      ).body.error.code,
    ).toBe('NOT_A_MEMBER');
    await call('buyer', 'post', `/plans/${created.id}/members`, { contact: 'other@test.com' });
    await call('buyer', 'patch', `/plans/${created.id}/items/${water.id}`, {
      assignee_id: 'other',
    });
    const [asked] = await db.query(
      "SELECT title FROM notifications WHERE user_id='other' AND title LIKE 'You’re buying%'",
    );
    expect(asked.title).toBe('You’re buying Bottled water');
    // New answers: 400 guests and food. The assigned item stays; food items appear.
    await call('buyer', 'patch', `/plans/${created.id}/items/${venue.id}`, { status: 'PURCHASED' });
    const changed = await call('buyer', 'put', `/plans/${created.id}/answers`, {
      answers: {
        guests: 400,
        ceremonies: ['white', 'reception'],
        covering: ['venue', 'drinks', 'food'],
      },
    });
    expect(changed.status).toBe(200);
    plan = (await call('buyer', 'get', `/plans/${created.id}`)).body;
    expect(plan.items.find((i: any) => i.id === venue.id).status).toBe('PURCHASED');
    expect(plan.items.find((i: any) => i.id === water.id).assignee_name).toBe('other');
    expect(plan.items.some((i: any) => i.name === 'Rice (jollof and fried)')).toBe(true);
    expect(plan.answers.guests).toBe(400);
    expect(plan.people).toBe(400);
  });
});
async function readyForDeliveryFraud() {
  const { b } = await accepted();
  await db.query('UPDATE sellers SET latitude=6.55,longitude=3.35 WHERE user_id=$1', ['seller']);
  await call('other', 'post', '/drivers', {
    vehicle_type: 'motorcycle',
    plate_number: 'lag-777-xy',
    licence_number: 'ABC12345',
    city: 'Lagos',
  });
  await call('admin', 'post', '/admin/drivers/other/review', {
    status: 'APPROVED',
    reason: 'Checked',
  });
  await call('other', 'put', '/drivers/me/status', {
    online: true,
    latitude: 6.551,
    longitude: 3.351,
  });
  const quote = await call('buyer', 'post', `/bookings/${b}/delivery/quote`, {
    vehicle_type: 'motorcycle',
    dropoff: { latitude: 6.6, longitude: 3.36 },
  });
  return { b, quote: quote.body };
}
describe('shared catalogue and easy stock', () => {
  async function approveSeller(actor: 'seller' | 'other' | 'admin', name: string) {
    await call(actor, 'post', '/sellers', {
      business_name: name,
      business_type: 'home_based',
      city: 'Lagos',
      area: 'Ikeja',
      address: 'PRIVATE 2 Shop Road',
    });
    await call('admin', 'post', `/admin/sellers/${actor}/review`, {
      status: 'APPROVED',
      reason: 'Checked',
    });
  }
  const photoOf = async (owner: string) => {
    const url = `http://localhost/media/${randomUUID()}.webp`;
    await db.query('INSERT INTO media(id,owner_id,url,thumbnail_url) VALUES($1,$2,$3,$3)', [
      randomUUID(),
      owner,
      url,
    ]);
    return url;
  };
  it('gives listings without a photo one from the library, and cleans staff uploads', async () => {
    await approveSeller('seller', 'Mama Ngozi Foodstuff');
    const made = async (title: string) =>
      (
        await call('seller', 'post', '/listings', {
          title,
          description: `${title} from the market`,
          category: 'Food & groceries',
          unit: 'piece',
          price_kobo: 30000,
          stock: 10,
        })
      ).body.id;
    const ponmo = await made('Ponmo (cow skin)');
    const curry = await made('Curry sachet');
    const odd = await made('Zobo flower');
    // A shared photo for ponmo is already in the library.
    await call('admin', 'post', '/admin/catalogue-products', {
      name: 'Ponmo',
      category: 'Food & groceries',
      unit: 'piece',
    });
    const [p] = (await call('admin', 'get', '/admin/catalogue-products?q=ponmo')).body;
    await call('admin', 'post', `/admin/catalogue-products/${p.id}/photos`, {
      url: await photoOf('admin'),
    });
    const bare = (await call('admin', 'get', '/admin/catalogue-products/bare-listings')).body;
    // The ponmo listing wasn't added from the catalogue, so it is still bare, with a suggestion.
    const row = (id: string) => bare.find((x: any) => x.id === id);
    expect(row(ponmo).suggestions[0].product).toBe('Ponmo');
    expect(row(odd).suggestions).toEqual([]);
    // Staff upload a cleaned photo for the curry: it lands on a white square.
    const tall = await sharp({
      create: { width: 300, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const up = await request(app)
      .post('/v1/media?clean=true')
      .set('Authorization', 'Bearer token-admin')
      .attach('image', tall, { filename: 'c.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(
      (
        await call('admin', 'post', `/admin/catalogue-products/bare-listings/${curry}/photo`, {
          url: up.body.url,
        })
      ).status,
    ).toBe(200);
    const [c] = await db.query('SELECT * FROM listings WHERE id=$1', [curry]);
    expect(c.image_url).toBe(up.body.url);
    expect(c.catalogue_photo_id).toBeTruthy();
    // The new photo joined the library, so the next "curry" listing is suggested it.
    const later = await made('Curry powder');
    const again = (await call('admin', 'get', '/admin/catalogue-products/bare-listings')).body;
    expect(again.find((x: any) => x.id === later).suggestions[0].url).toBe(up.body.url);
    // Fill all: every listing with a match gets its best photo; the rest stay.
    const fill = (await call('admin', 'post', '/admin/catalogue-products/bare-listings/fill', {}))
      .body;
    expect(fill).toEqual({ filled: 2, left: 1 });
    const [pm] = await db.query('SELECT image_url FROM listings WHERE id=$1', [ponmo]);
    expect(pm.image_url).toBeTruthy();
    const seen = (await call('seller', 'get', '/notifications')).body;
    expect(JSON.stringify(seen)).toContain('We added a photo to your product');
  });
  it('adds many products without photos, shares and rotates photos, skips duplicates', async () => {
    await approveSeller('seller', 'Ada Phones');
    await approveSeller('other', 'Tunde Gadgets');
    const found = (await call('seller', 'get', '/catalogue/products?q=iphone 15')).body;
    expect(found.map((p: any) => p.name)).toEqual(
      expect.arrayContaining(['iPhone 15', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 15 Plus']),
    );
    const pro = found.find((p: any) => p.name === 'iPhone 15 Pro');
    const plus = found.find((p: any) => p.name === 'iPhone 15 Plus');
    const own = await photoOf('seller');
    const added = (
      await call('seller', 'post', '/sellers/me/listings/from-catalogue', {
        items: [
          { product_id: pro.id, price_kobo: 98000000, photo_url: own, condition: 'USED' },
          { product_id: plus.id, price_kobo: 95000000 },
        ],
      })
    ).body;
    expect(added).toMatchObject({ created: 2, skipped: [] });
    // Again: already in the shop.
    expect(
      (
        await call('seller', 'post', '/sellers/me/listings/from-catalogue', {
          items: [{ product_id: pro.id, price_kobo: 1000 }],
        })
      ).body.skipped,
    ).toEqual(['iPhone 15 Pro']);
    // Another seller gets the shared photo, labelled as representative.
    const theirs = (
      await call('other', 'post', '/sellers/me/listings/from-catalogue', {
        items: [{ product_id: pro.id, price_kobo: 97000000 }],
      })
    ).body;
    const listing = (await call('buyer', 'get', `/listings/${theirs.ids[0]}`)).body;
    expect(listing).toMatchObject({
      image_url: own,
      representative_photo: true,
      stock_mode: 'ALWAYS',
    });
    // A photo on 10 listings makes way for a less-used one.
    const [first] = await db.query('SELECT id FROM catalogue_photos WHERE product_id=$1', [pro.id]);
    await db.query(
      "INSERT INTO catalogue_photos(id,product_id,url,source) VALUES('photo-2',$1,'https://example.com/p2.webp','STAFF')",
      [pro.id],
    );
    await db.query('UPDATE listings SET catalogue_photo_id=$1 WHERE id=$2', [
      first.id,
      theirs.ids[0],
    ]);
    for (let i = 0; i < 9; i++)
      await db.query(
        `INSERT INTO listings(id,seller_id,title,description,category,unit,price_kobo,stock,catalogue_product_id,catalogue_photo_id)
         VALUES($1,'other','iPhone 15 Pro','Representative test listing','Phones & electronics','piece',100,1,$2,$3)`,
        [randomUUID(), pro.id, first.id],
      );
    expect((await pickPhoto(db as any, pro.id)).id).toBe('photo-2');
    // Searching shows how many sellers and the price range.
    const again = (await call('buyer', 'get', '/catalogue/products?q=iphone 15 pro')).body.find(
      (p: any) => p.id === pro.id,
    );
    expect(again).toMatchObject({ sellers: 2, min_price_kobo: 100 });
  });
  it('keeps always-in-stock items available, hides out-today items and updates prices in bulk', async () => {
    await approveSeller('seller', 'Mega Mart');
    const milk = (await call('seller', 'get', '/catalogue/products?q=peak milk powder')).body[0];
    const { ids } = (
      await call('seller', 'post', '/sellers/me/listings/from-catalogue', {
        items: [{ product_id: milk.id, price_kobo: 450000 }],
      })
    ).body;
    const id = ids[0];
    const booking = (await call('buyer', 'post', '/bookings', { listing_id: id, quantity: 3 }))
      .body;
    await call('seller', 'post', `/bookings/${booking.id}/accept`, {});
    const [v] = await db.query('SELECT stock FROM listing_variants WHERE listing_id=$1', [id]);
    expect(v.stock).toBe(100000);
    // Out today: hidden from buyers until midnight.
    await call('seller', 'post', `/listings/${id}/out-today`, { out: true });
    expect((await call('buyer', 'get', '/listings')).body.some((l: any) => l.id === id)).toBe(
      false,
    );
    await call('seller', 'post', `/listings/${id}/out-today`, { out: false });
    expect((await call('buyer', 'get', '/listings')).body.some((l: any) => l.id === id)).toBe(true);
    // Prices up 10% across the shop, rounded to ₦10.
    expect(
      (await call('seller', 'post', '/sellers/me/listings/prices', { percent: 10 })).body.updated,
    ).toBeGreaterThan(0);
    const [l] = await db.query('SELECT price_kobo FROM listings WHERE id=$1', [id]);
    expect(l.price_kobo).toBe(495000);
    await call('seller', 'post', '/sellers/me/listings/prices', {
      items: [{ listing_id: id, price_kobo: 470000 }],
    });
    const [p] = await db.query('SELECT price_kobo FROM listing_variants WHERE listing_id=$1', [id]);
    expect(p.price_kobo).toBe(470000);
    // Switch to counting stock.
    expect(
      (await call('seller', 'put', `/listings/${id}/stock-mode`, { mode: 'COUNTED', stock: 4 }))
        .body.stock,
    ).toBe(4);
  });
  it('points buyers elsewhere when a seller is out of stock and tracks fulfilment', async () => {
    await approveSeller('seller', 'Shop A');
    await approveSeller('other', 'Shop B');
    const rice = (await call('seller', 'get', '/catalogue/products?q=mama gold 50kg')).body[0];
    const a = (
      await call('seller', 'post', '/sellers/me/listings/from-catalogue', {
        items: [{ product_id: rice.id, price_kobo: 9000000 }],
      })
    ).body.ids[0];
    await call('other', 'post', '/sellers/me/listings/from-catalogue', {
      items: [{ product_id: rice.id, price_kobo: 9200000 }],
    });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push((await call('buyer', 'post', '/bookings', { listing_id: a, quantity: 1 })).body.id);
    for (const id of ids.slice(0, 4)) await call('seller', 'post', `/bookings/${id}/accept`, {});
    await call('seller', 'post', `/bookings/${ids[4]}/decline`, { reason: 'OUT_OF_STOCK' });
    const [l] = await db.query('SELECT out_until FROM listings WHERE id=$1', [a]);
    expect(new Date(l.out_until).getTime()).toBeGreaterThan(Date.now());
    const [n] = await db.query(
      "SELECT body FROM notifications WHERE user_id='buyer' AND title LIKE '%available elsewhere'",
    );
    expect(n.body).toMatch(/1 other seller has it/);
    await refreshFulfilment(db);
    const [s] = await db.query(
      "SELECT fulfilment_pct,fulfilment_orders FROM sellers WHERE user_id='seller'",
    );
    expect(s).toEqual({ fulfilment_pct: 80, fulfilment_orders: 5 });
  });
});
describe('deals and buyer requests', () => {
  async function sellerWith(actor: 'seller' | 'other', name: string, products: [string, number][]) {
    await call(actor, 'post', '/sellers', {
      business_name: name,
      business_type: 'market_stall',
      city: 'Lagos',
      area: 'Mile 12',
      address: 'PRIVATE 3 Market Lane',
    });
    await call('admin', 'post', `/admin/sellers/${actor}/review`, {
      status: 'APPROVED',
      reason: 'Checked',
    });
    const ids: string[] = [];
    for (const [title, naira] of products) {
      const r = await call(actor, 'post', '/listings', {
        title,
        description: `${title} from the market`,
        category: 'Vegetables',
        unit: 'kg',
        price_kobo: naira * 100,
        stock: 50,
      });
      ids.push(r.body.id);
    }
    return ids;
  }
  const alerts = (title: string) =>
    db.query("SELECT title,body FROM notifications WHERE user_id='buyer' AND title LIKE $1", [
      title,
    ]);
  it('runs sales and tells watchers about price cuts and sales once', async () => {
    const [tomatoes] = await sellerWith('seller', 'Mama Tomato', [['Fresh tomatoes', 1600]]);
    // Watch a search and a listing.
    const search = (await call('buyer', 'post', '/price-watches', { query: 'tomatoes' })).body;
    expect(search.watched_price_kobo).toBe(160000);
    await call('buyer', 'post', '/price-watches', { listing_id: tomatoes });
    await dealsSweep(db);
    expect(await alerts('Price drop%')).toHaveLength(0);
    // A 10% cut.
    await call('seller', 'post', '/sellers/me/listings/prices', {
      items: [{ listing_id: tomatoes, price_kobo: 144000 }],
    });
    await dealsSweep(db);
    await dealsSweep(db);
    const drops = await alerts('Price drop%');
    expect(drops).toHaveLength(2);
    expect(drops[0].body).toMatch(/now ₦1,440 at Mama Tomato \(was ₦1,600\)/);
    // A sale: was-price shown, watchers told, and it ends by itself.
    const saleOf = (body: any) => call('seller', 'post', `/listings/${tomatoes}/sale`, body);
    expect((await saleOf({ price_kobo: 150000, days: 2, deal_stock: 5 })).body.error.code).toBe(
      'NOT_A_SALE',
    );
    // Genuine deals only: ₦1,440 has only just become the price.
    expect((await saleOf({ price_kobo: 120000, days: 2, deal_stock: 5 })).body.error.code).toBe(
      'PRICE_NOT_ESTABLISHED',
    );
    await db.query(
      "UPDATE listing_price_history SET from_at=from_at-interval '10 days' WHERE listing_id=$1",
      [tomatoes],
    );
    expect((await saleOf({ price_kobo: 140000, days: 2, deal_stock: 5 })).body.error.code).toBe(
      'DEAL_TOO_SMALL',
    );
    expect((await saleOf({ price_kobo: 120000, days: 2, deal_stock: 500 })).body.error.code).toBe(
      'DEAL_STOCK',
    );
    const sale = (await saleOf({ price_kobo: 120000, days: 2, deal_stock: 5 })).body;
    expect(sale).toMatchObject({ price_kobo: 120000, was_price_kobo: 144000, deal_stock_left: 5 });
    await dealsSweep(db);
    expect((await alerts('On sale%')).length).toBeGreaterThan(0);
    expect((await call('buyer', 'get', '/price-watches')).body[0].lowest).toMatchObject({
      price_kobo: 120000,
      on_sale: true,
    });
    await db.query("UPDATE listings SET sale_until=now()-interval '1 minute' WHERE id=$1", [
      tomatoes,
    ]);
    await dealsSweep(db);
    const [l] = await db.query('SELECT price_kobo,was_price_kobo FROM listings WHERE id=$1', [
      tomatoes,
    ]);
    expect(l).toEqual({ price_kobo: 144000, was_price_kobo: null });
    const [v] = await db.query('SELECT price_kobo FROM listing_variants WHERE listing_id=$1', [
      tomatoes,
    ]);
    expect(v.price_kobo).toBe(144000);
    expect((await call('buyer', 'delete', `/price-watches/${search.id}`)).status).toBe(200);
  });
  it('suggests the best-matched sellers for something no one lists, and lets them offer it', async () => {
    const [, pepper] = await sellerWith('seller', 'Ada Vegetables', [
      ['Fresh tomatoes', 1600],
      ['Scotch bonnet pepper', 3000],
    ]);
    await sellerWith('other', 'Tunde Veg', [['Red pepper (tatashe)', 2800]]);
    // The verified, better-rated seller comes first.
    await db.query(
      "UPDATE sellers SET verification_status='VERIFIED',verification_expires_at=now()+interval '1 year' WHERE user_id='seller'",
    );
    const hint = (await call('buyer', 'get', '/product-requests/suggest?q=bell peppers')).body;
    expect(hint.category).toBe('Vegetables');
    expect(hint.sellers.map((x: any) => x.seller_id)).toEqual(['seller', 'other']);
    expect(hint.sellers[0].reason).toMatch(/Sells Scotch bonnet pepper · verified/);
    const req = (await call('buyer', 'post', '/product-requests', { text: 'Bell peppers, 2kg' }))
      .body;
    expect(req.sellers).toHaveLength(2);
    const [asked] = await db.query(
      "SELECT title FROM notifications WHERE user_id='seller' AND kind='request'",
    );
    expect(asked.title).toBe('Wanted: Bell peppers, 2kg');
    const open = (await call('seller', 'get', '/sellers/me/product-requests')).body;
    expect(open[0]).toMatchObject({
      id: req.id,
      text: 'Bell peppers, 2kg',
      offered_listing_id: null,
    });
    expect(
      (await call('buyer', 'post', `/product-requests/${req.id}/offer`, { listing_id: pepper }))
        .status,
    ).toBe(404);
    expect(
      (
        await call('seller', 'post', `/product-requests/${req.id}/offer`, {
          listing_id: pepper,
          note: 'Have tatashe too',
        })
      ).status,
    ).toBe(200);
    const mine = (await call('buyer', 'get', '/product-requests/mine')).body;
    expect(mine[0].offers[0]).toMatchObject({
      title: 'Scotch bonnet pepper',
      business_name: 'Ada Vegetables',
      price_kobo: 300000,
    });
    expect((await alerts('Ada Vegetables has what you asked for')).length).toBe(1);
    await call('buyer', 'post', `/product-requests/${req.id}/close`, {});
    expect((await call('seller', 'get', '/sellers/me/product-requests')).body).toEqual([]);
  });
});
describe('buy it and bring it', () => {
  async function foodShop(
    actor: 'seller' | 'other',
    name: string,
    lat: number,
    lng: number,
    items: [string, string, number, string][],
  ) {
    await call(actor, 'post', '/sellers', {
      business_name: name,
      business_type: 'market_stall',
      city: 'Lagos',
      area: 'Ikeja',
      address: 'PRIVATE 6 Market Road',
    });
    await call('admin', 'post', `/admin/sellers/${actor}/review`, {
      status: 'APPROVED',
      reason: 'Checked',
    });
    await db.query('UPDATE sellers SET latitude=$1,longitude=$2 WHERE user_id=$3', [
      lat,
      lng,
      actor,
    ]);
    const ids: Record<string, string> = {};
    for (const [title, category, naira, unit] of items)
      ids[title] = (
        await call(actor, 'post', '/listings', {
          title,
          description: `${title} from the market`,
          category,
          unit,
          price_kobo: naira * 100,
          stock: 30,
        })
      ).body.id;
    return ids;
  }
  it('turns "I want to make egusi" into a basket from the fewest nearby shops and books delivery on acceptance', async () => {
    const a = await foodShop('seller', 'Mama Ngozi Foodstuff', 6.6, 3.35, [
      ['Ground egusi', 'Food & groceries', 5000, 'kg'],
      ['Palm oil', 'Food & groceries', 2800, 'litre'],
      ['Ugu leaves', 'Vegetables', 400, 'bunch'],
      ['Ijebu garri', 'Grains', 1200, 'kg'],
      ['Beef', 'Food & groceries', 6500, 'kg'],
    ]);
    // A shop with only one of the items: not needed when one shop covers them.
    await foodShop('other', 'Iya Bisi', 6.61, 3.36, [
      ['Ground egusi', 'Food & groceries', 4800, 'kg'],
    ]);
    const ideas = (await call('buyer', 'get', '/errands/ideas')).body;
    expect(ideas.map((i: any) => i.key)).toContain('egusi-soup');
    const plan = (
      await call('buyer', 'post', '/errands/plan', {
        text: 'I want to make egusi for 6',
        latitude: 6.59,
        longitude: 3.34,
      })
    ).body;
    expect(plan.recipes.map((r: any) => r.key)).toEqual(['egusi-soup']);
    expect(plan.servings).toBe(6);
    expect(plan.sellers.map((s: any) => s.business_name)).toEqual(['Mama Ngozi Foodstuff']);
    const egusi = plan.items.find((i: any) => i.name === 'Ground egusi');
    expect(egusi.listing).toMatchObject({
      title: 'Ground egusi',
      business_name: 'Mama Ngozi Foodstuff',
    });
    expect(plan.items.find((i: any) => i.from.includes('Eba'))).toBeTruthy();
    expect(plan.missing.length).toBeGreaterThan(0);
    expect(plan.delivery_kobo).toBeGreaterThan(0);
    // Too soon is refused.
    const chosen = plan.items
      .filter((i: any) => i.listing)
      .map((i: any) => ({ listing_id: i.listing.id, quantity: i.quantity }));
    const body = {
      text: 'I want to make egusi for 6',
      dropoff: { latitude: 6.59, longitude: 3.34 },
      dropoff_address: '12 Office Close, Ikeja, Lagos',
      items: chosen,
    };
    expect(
      (
        await call('buyer', 'post', '/errands', {
          ...body,
          deliver_at: new Date(Date.now() + 30 * 60000).toISOString(),
        })
      ).body.error.code,
    ).toBe('INVALID_TIME');
    const at = new Date(Date.now() + 4 * 3600000).toISOString();
    const placed = (await call('buyer', 'post', '/errands', { ...body, deliver_at: at })).body;
    expect(placed.orders).toHaveLength(1);
    const [order] = await db.query('SELECT * FROM bookings WHERE id=$1', [
      placed.orders[0].booking_id,
    ]);
    expect(order).toMatchObject({
      seller_id: 'seller',
      unit: 'basket',
      errand_id: placed.errand_id,
    });
    const lines = await db.query('SELECT * FROM booking_lines WHERE booking_id=$1', [order.id]);
    expect(lines.length).toBe(chosen.length);
    const seen = (await call('seller', 'get', `/bookings/${order.id}`)).body;
    expect(seen.lines.length).toBe(chosen.length);
    expect(seen.errand.dropoff_address).toBe('12 Office Close, Ikeja, Lagos');
    // Seller accepts: every line's stock is reserved and a rider delivery is booked for the time.
    expect((await call('seller', 'post', `/bookings/${order.id}/accept`, {})).status).toBe(200);
    const [stock] = await db.query('SELECT stock FROM listing_variants WHERE listing_id=$1', [
      a['Ground egusi'],
    ]);
    expect(stock.stock).toBe(
      30 - lines.find((l: any) => l.listing_id === a['Ground egusi'])!.quantity,
    );
    const [d] = await db.query('SELECT * FROM deliveries WHERE booking_id=$1', [order.id]);
    expect(d).toMatchObject({
      status: 'OPEN',
      pay_on_delivery: true,
      dropoff_address: '12 Office Close, Ikeja, Lagos',
    });
    expect(Math.round((new Date(at).getTime() - new Date(d.scheduled_at).getTime()) / 60000)).toBe(
      40,
    );
    // Cancelling returns every line's stock.
    await call('buyer', 'post', `/bookings/${order.id}/cancel`, {});
    const [back] = await db.query('SELECT stock FROM listing_variants WHERE listing_id=$1', [
      a['Ground egusi'],
    ]);
    expect(back.stock).toBe(30);
  });
  it('fits the basket to a budget and leaves out what the person can’t eat', async () => {
    await foodShop('seller', 'Mama Ngozi Foodstuff', 6.6, 3.35, [
      ['Ground egusi', 'Food & groceries', 9000, 'kg'],
      ['Palm oil', 'Food & groceries', 2800, 'litre'],
      ['Ugu leaves', 'Vegetables', 400, 'bunch'],
      ['Ijebu garri', 'Grains', 1200, 'kg'],
      ['Beef', 'Food & groceries', 6500, 'kg'],
      ['Stockfish', 'Food & groceries', 9000, 'kg'],
      ['Ground crayfish', 'Food & groceries', 12000, 'kg'],
    ]);
    await foodShop('other', 'Iya Bisi', 6.61, 3.36, [
      ['Ground egusi', 'Food & groceries', 2000, 'kg'],
    ]);
    const me = (await call('buyer', 'get', '/me')).body.user;
    await db.query(
      "INSERT INTO diet_profiles(user_id,allergies,intolerances,avoid,patterns,consented_at,updated_at) VALUES($1,ARRAY['shellfish'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],now(),now())",
      [me.id],
    );
    const ask = { text: 'I want to make egusi for 6', latitude: 6.59, longitude: 3.34 };
    const full = (await call('buyer', 'post', '/errands/plan', { ...ask, avoid: ['stockfish'] }))
      .body;
    const crayfish = full.items.find((i: any) => i.name === 'Ground crayfish');
    expect(crayfish.diet).toMatchObject({ status: 'AVOID' });
    expect(crayfish.diet.reason).toContain('allergy');
    expect(crayfish.listing).toBeNull();
    const stockfish = full.items.find((i: any) => i.name.startsWith('Stockfish'));
    expect(stockfish.diet).toEqual({ status: 'AVOID', reason: 'You said no stockfish' });
    expect(full.missing).not.toContain('Ground crayfish');
    expect(full.budget).toBeNull();
    const egusiShop = (p: any) =>
      p.items.find((i: any) => i.name === 'Ground egusi').listing.business_name;
    expect(egusiShop(full)).toBe('Mama Ngozi Foodstuff');
    // A budget a little under the full price swaps to cheaper egusi from the second shop.
    const fit = (
      await call('buyer', 'post', '/errands/plan', {
        ...ask,
        avoid: ['stockfish'],
        budget_kobo: full.total_kobo - 50000,
      })
    ).body;
    expect(egusiShop(fit)).toBe('Iya Bisi');
    expect(fit.budget.cheaper_swaps).toBeGreaterThan(0);
    expect(fit.total_kobo).toBeLessThan(full.total_kobo);
    // A budget far too small says how many people it would feed.
    const tight = (await call('buyer', 'post', '/errands/plan', { ...ask, budget_kobo: 1000000 }))
      .body;
    expect(tight.budget.over_by_kobo).toBeGreaterThan(0);
    expect(tight.budget.fits_servings).toBeLessThan(6);
  });
  it('buys a portion of loose goods and ignores products that only share a word', async () => {
    await foodShop('seller', 'Oyingbo Soup Ingredients', 6.6, 3.35, [
      ['Ground ogbono', 'Food & groceries', 9000, 'kg'],
      ['Ground crayfish', 'Food & groceries', 12000, 'kg'],
      ['Pepper soup spice', 'Food & groceries', 600, 'pack'],
      ['Vegetable oil', 'Food & groceries', 3200, 'litre'],
      ['Seasoning cubes', 'Food & groceries', 1500, 'pack'],
    ]);
    const plan = (
      await call('buyer', 'post', '/errands/plan', {
        text: 'I want to make ogbono soup for 2',
        latitude: 6.59,
        longitude: 3.34,
      })
    ).body;
    const item = (name: string) => plan.items.find((i: any) => i.name.startsWith(name));
    // Scotch bonnet isn't pepper soup spice; palm oil isn't vegetable oil.
    expect(item('Scotch bonnet').listing).toBeNull();
    expect(item('Palm oil').listing).toBeNull();
    // 2 people need about 0.1 kg of ogbono: priced as that part of a kilo.
    const ogbono = item('Ground ogbono');
    expect(ogbono).toMatchObject({ quantity: 1, portion: 0.1, line_kobo: 90000 });
    expect(item('Ground crayfish').line_kobo).toBe(120000);
    const placed = (
      await call('buyer', 'post', '/errands', {
        text: 'I want to make ogbono soup for 2',
        dropoff: { latitude: 6.59, longitude: 3.34 },
        dropoff_address: '12 Office Close, Ikeja, Lagos',
        deliver_at: new Date(Date.now() + 4 * 3600000).toISOString(),
        items: [
          { listing_id: ogbono.listing.id, quantity: 1, portion: 0.1 },
          { listing_id: item('Seasoning cubes').listing.id, quantity: 1 },
        ],
      })
    ).body;
    expect(placed.orders[0].total_kobo).toBe(90000 + 150000);
    const [line] = await db.query(
      "SELECT * FROM booking_lines WHERE booking_id=$1 AND title='Ground ogbono'",
      [placed.orders[0].booking_id],
    );
    expect(line).toMatchObject({ unit: '0.1 kg', quantity: 1, price_kobo: 90000 });
    // A part of something sold by the pack is refused.
    const bad = await call('buyer', 'post', '/errands', {
      text: 'cubes',
      dropoff: { latitude: 6.59, longitude: 3.34 },
      dropoff_address: '12 Office Close, Ikeja, Lagos',
      deliver_at: new Date(Date.now() + 4 * 3600000).toISOString(),
      items: [{ listing_id: item('Seasoning cubes').listing.id, quantity: 1, portion: 0.5 }],
    });
    expect(bad.body.error.code).toBe('PORTION_NOT_ALLOWED');
  });
  it('sends one rider to every shop of an errand and picks the single-cube option', async () => {
    const a = await foodShop('seller', 'Oyingbo Soup Ingredients', 6.6, 3.35, [
      ['Ground ogbono', 'Food & groceries', 9000, 'kg'],
      ['Maggi cubes', 'Food & groceries', 1500, 'pack'],
    ]);
    // The cube listing also sells single cubes.
    const [primary] = await db.query('SELECT * FROM listing_variants WHERE listing_id=$1', [
      a['Maggi cubes'],
    ]);
    await db.query(
      "INSERT INTO listing_variants(id,listing_id,name,unit,price_kobo,stock) VALUES($1,$2,'1 cube','piece',7500,200)",
      [randomUUID(), primary.listing_id],
    );
    await foodShop('other', 'Mushin Meat and Fish', 6.605, 3.355, [
      ['Beef', 'Food & groceries', 6500, 'kg'],
    ]);
    const ask = { text: 'I want to make ogbono soup for 2', latitude: 6.59, longitude: 3.34 };
    const plan = (await call('buyer', 'post', '/errands/plan', ask)).body;
    const cubes = plan.items.find((i: any) => i.name === 'Seasoning cubes');
    expect(cubes).toMatchObject({ quantity: 2, line_kobo: 15000 });
    expect(cubes.listing).toMatchObject({ unit: 'piece', title: 'Maggi cubes · 1 cube' });
    // Two shops: the second is priced as an extra stop, not a second full trip.
    expect(plan.sellers).toHaveLength(2);
    const [full, stop] = [...plan.sellers].sort(
      (x: any, y: any) => y.delivery_kobo - x.delivery_kobo,
    );
    expect(stop.delivery_kobo).toBeLessThan(full.delivery_kobo);
    const placed = (
      await call('buyer', 'post', '/errands', {
        text: ask.text,
        dropoff: { latitude: 6.59, longitude: 3.34 },
        dropoff_address: '12 Office Close, Ikeja, Lagos',
        deliver_at: new Date(Date.now() + 4 * 3600000).toISOString(),
        items: plan.items
          .filter((i: any) => i.listing)
          .map((i: any) => ({
            listing_id: i.listing.id,
            variant_id: i.listing.variant_id,
            quantity: i.portion ? 1 : i.quantity,
            ...(i.portion ? { portion: i.portion } : {}),
          })),
      })
    ).body;
    expect(placed.orders).toHaveLength(2);
    const [line] = await db.query("SELECT * FROM booking_lines WHERE title='Maggi cubes · 1 cube'");
    expect(line).toMatchObject({ unit: 'piece', quantity: 2, price_kobo: 7500 });
    const bookingOf = (seller: string) =>
      placed.orders.find((o: any) => o.seller_id === seller).booking_id;
    await call('seller', 'post', `/bookings/${bookingOf('seller')}/accept`, {});
    await call('other', 'post', `/bookings/${bookingOf('other')}/accept`, {});
    const [lead] = await db.query('SELECT * FROM deliveries WHERE booking_id=$1', [
      bookingOf('seller'),
    ]);
    const [extra] = await db.query('SELECT * FROM deliveries WHERE booking_id=$1', [
      bookingOf('other'),
    ]);
    expect(lead.trip_lead_id).toBeNull();
    expect(extra.trip_lead_id).toBe(lead.id);
    expect(Number(extra.fare_kobo)).toBeLessThan(Number(lead.fare_kobo));
    // Only the lead is offered; taking it brings the other shop along.
    await call('admin', 'post', '/drivers', {
      vehicle_type: 'motorcycle',
      plate_number: 'lag-888-xy',
      licence_number: 'ABC12399',
      city: 'Lagos',
    });
    await call('admin', 'post', '/admin/drivers/admin/review', {
      status: 'APPROVED',
      reason: 'Checked',
    });
    await call('admin', 'put', '/drivers/me/status', {
      online: true,
      latitude: 6.6,
      longitude: 3.35,
    });
    await db.query('UPDATE deliveries SET scheduled_at=NULL WHERE id = ANY($1)', [
      [lead.id, extra.id],
    ]);
    const jobs = (await call('admin', 'get', '/drivers/me/jobs')).body;
    expect(jobs.open.map((j: any) => j.id)).toEqual([lead.id]);
    expect((await call('admin', 'post', `/deliveries/${extra.id}/claim`, {})).body.error.code).toBe(
      'PART_OF_TRIP',
    );
    expect((await call('admin', 'post', `/deliveries/${lead.id}/claim`, {})).status).toBe(200);
    const [after] = await db.query('SELECT status,driver_id FROM deliveries WHERE id=$1', [
      extra.id,
    ]);
    expect(after).toEqual({ status: 'ASSIGNED', driver_id: 'admin' });
    // If the first shop's part is cancelled, the other becomes its own trip at a normal fare.
    await call('buyer', 'post', `/bookings/${bookingOf('seller')}/cancel`, {});
    const [promoted] = await db.query('SELECT * FROM deliveries WHERE id=$1', [extra.id]);
    expect(promoted.trip_lead_id).toBeNull();
    expect(Number(promoted.fare_kobo)).toBeGreaterThan(Number(extra.fare_kobo));
  });
  it('reads explicit items with quantities', async () => {
    await foodShop('seller', 'Ikeja Poultry', 6.6, 3.35, [
      ['Eggs crate', 'Livestock', 5000, 'crate'],
    ]);
    const plan = (
      await call('buyer', 'post', '/errands/plan', {
        text: '2 crates of eggs and some tomatoes',
        latitude: 6.59,
        longitude: 3.34,
      })
    ).body;
    const eggs = plan.items.find((i: any) => /egg/i.test(i.name));
    expect(eggs).toMatchObject({ needed_quantity: 2, quantity: 2, line_kobo: 1000000 });
    expect(plan.missing.some((m: string) => /tomato/i.test(m))).toBe(true);
  });
});
describe('request with a location and quotes', () => {
  it('alerts sellers near the chosen spot and lets the buyer order at the quoted price', async () => {
    const egg = async (actor: 'seller' | 'other', name: string, lat: number, lng: number) => {
      await call(actor, 'post', '/sellers', {
        business_name: name,
        business_type: 'farm',
        city: 'Lagos',
        area: 'Ikeja',
        address: 'PRIVATE 4 Poultry Close',
      });
      await call('admin', 'post', `/admin/sellers/${actor}/review`, {
        status: 'APPROVED',
        reason: 'Checked',
      });
      await db.query('UPDATE sellers SET latitude=$1,longitude=$2 WHERE user_id=$3', [
        lat,
        lng,
        actor,
      ]);
      return (
        await call(actor, 'post', '/listings', {
          title: 'Eggs (crate of 30)',
          description: 'Fresh farm eggs, crate of 30',
          category: 'Livestock',
          unit: 'crate',
          price_kobo: 500000,
          stock: 100,
        })
      ).body.id as string;
    };
    const near = await egg('seller', 'Ikeja Poultry', 6.6, 3.35);
    await egg('other', 'Abuja Farms', 9.07, 7.4);
    const req = (
      await call('buyer', 'post', '/product-requests', {
        text: 'crates of eggs',
        quantity: 20,
        unit: 'crates',
        budget_kobo: 9500000,
        needed_by: '2026-12-01',
        latitude: 6.59,
        longitude: 3.34,
        area: 'Ikeja',
        radius_km: 10,
      })
    ).body;
    expect(req.sellers.map((x: any) => x.seller_id)).toEqual(['seller']);
    const [n] = await db.query(
      "SELECT title,body FROM notifications WHERE user_id='seller' AND kind='request'",
    );
    expect(n.title).toBe('Wanted near Ikeja: 20 crates of eggs');
    expect(n.body).toMatch(/Budget ₦95,000\. Needed by 2026-12-01\. About 2 km from you\./);
    expect(
      (await db.query("SELECT 1 FROM notifications WHERE user_id='other' AND kind='request'"))
        .length,
    ).toBe(0);
    const seen = (await call('seller', 'get', '/sellers/me/product-requests')).body[0];
    expect(seen).toMatchObject({
      quantity: 20,
      unit: 'crates',
      budget_kobo: 9500000,
      area: 'Ikeja',
    });
    await call('seller', 'post', `/product-requests/${req.id}/offer`, {
      listing_id: near,
      price_kobo: 450000,
      quantity: 30,
    });
    const offer = (await call('buyer', 'get', '/product-requests/mine')).body[0].offers[0];
    expect(offer).toMatchObject({ price_kobo: 450000, listed_price_kobo: 500000, quoted: true });
    const b = (
      await call('buyer', 'post', '/bookings', {
        listing_id: near,
        quantity: 20,
        request_offer_id: offer.id,
      })
    ).body;
    expect(b).toMatchObject({ price_kobo: 450000, total_kobo: 9000000 });
    // Someone else can't use the quote.
    expect(
      (
        await call('other', 'post', '/bookings', {
          listing_id: near,
          quantity: 1,
          request_offer_id: offer.id,
        })
      ).body.error.code,
    ).toBe('QUOTE_UNAVAILABLE');
  });
});
describe('offers and group buying', () => {
  async function shop(
    actor: 'seller' | 'other',
    name: string,
    title: string,
    naira: number,
    category = 'Livestock',
  ) {
    await call(actor, 'post', '/sellers', {
      business_name: name,
      business_type: 'market_stall',
      city: 'Lagos',
      area: 'Oko Oba',
      address: 'PRIVATE 9 Abattoir Road',
    });
    await call('admin', 'post', `/admin/sellers/${actor}/review`, {
      status: 'APPROVED',
      reason: 'Checked',
    });
    const r = await call(actor, 'post', '/listings', {
      title,
      description: `${title}, fresh from the market`,
      category,
      unit: 'piece',
      price_kobo: naira * 100,
      stock: 20,
    });
    await db.query(
      "UPDATE listing_price_history SET from_at=from_at-interval '14 days' WHERE listing_id=$1",
      [r.body.id],
    );
    return r.body.id as string;
  }
  it('shows only genuine deals with stock left, and ends a deal when its stock is gone', async () => {
    const goat = await shop('seller', 'Oko Oba Meats', 'Whole goat', 90000);
    await call('seller', 'post', `/listings/${goat}/sale`, {
      price_kobo: 8000000,
      kind: 'TODAY',
      deal_stock: 2,
    });
    const offers = (await call('buyer', 'get', '/offers')).body;
    expect(offers.today[0]).toMatchObject({
      title: 'Whole goat',
      off_pct: 11,
      left: 2,
      kind: 'TODAY',
    });
    expect(offers.fresh.map((o: any) => o.id)).toContain(goat);
    // Can't order more than the deal has.
    expect(
      (await call('buyer', 'post', '/bookings', { listing_id: goat, quantity: 3 })).body.error.code,
    ).toBe('DEAL_LIMIT');
    const b = (await call('buyer', 'post', '/bookings', { listing_id: goat, quantity: 2 })).body;
    await call('seller', 'post', `/bookings/${b.id}/accept`, {});
    const [l] = await db.query(
      'SELECT price_kobo,was_price_kobo,deal_stock_left FROM listings WHERE id=$1',
      [goat],
    );
    expect(l).toEqual({ price_kobo: 9000000, was_price_kobo: null, deal_stock_left: null });
    expect((await call('buyer', 'get', '/offers')).body.today).toEqual([]);
  });
  it('shares a goat between three people with an Ahia-funded discount, and refunds if declined', async () => {
    const goat = await shop('seller', 'Oko Oba Meats', 'Whole goat', 90000);
    for (const u of ['buyer', 'other', 'admin'])
      await call(u as any, 'post', '/wallet/demo-fund', { amount_kobo: 10000000 });
    // Someone searched for goat recently: they hear about the group.
    await call('other', 'get', '/search?q=goat meat');
    const g = (
      await call('buyer', 'post', '/group-buys', {
        listing_id: goat,
        shares: 3,
        note: 'Sharing for Sallah',
      })
    ).body;
    // 3 people: 2% off ₦90,000 = ₦88,200, so ₦29,400 each.
    expect(g).toMatchObject({
      shares: 3,
      taken: 1,
      spots_left: 2,
      discount_pct: 2,
      share_price_kobo: 2940000,
      status: 'OPEN',
    });
    const [heard] = await db.query(
      "SELECT title FROM notifications WHERE user_id='other' AND kind='group_buy'",
    );
    expect(heard.title).toBe('Share Whole goat and save 2%');
    expect((await call('other', 'get', '/group-buys')).body.open[0].id).toBe(g.id);
    // Searching for something to share finds the goat and its seller, with the open group.
    const found = (await call('other', 'get', '/group-buys/search?q=goat')).body;
    expect(found[0]).toMatchObject({
      listing_id: goat,
      business_name: 'Oko Oba Meats',
      open_groups: 1,
    });
    expect(found[0].reason).toBeTruthy();
    expect((await call('seller', 'get', '/group-buys/search?q=goat')).body).toEqual([]);
    expect((await call('seller', 'post', `/group-buys/${g.id}/join`, {})).body.error.code).toBe(
      'OWN_LISTING',
    );
    await call('buyer', 'post', `/group-buys/${g.id}/invite`, { contact: 'admin@test.com' });
    await call('other', 'post', `/group-buys/${g.id}/join`, {});
    const full = (await call('admin', 'post', `/group-buys/${g.id}/join`, {})).body;
    expect(full.status).toBe('ORDERED');
    const [order] = await db.query('SELECT * FROM bookings WHERE group_buy_id=$1', [g.id]);
    expect(order).toMatchObject({ buyer_id: 'buyer', total_kobo: 9000000, status: 'REQUESTED' });
    // Seller accepts: paid from the shares plus Ahia's ₦1,800 discount.
    await call('seller', 'post', `/bookings/${order.id}/accept`, {});
    const [paid] = await db.query('SELECT paid FROM bookings WHERE id=$1', [order.id]);
    expect(paid.paid).toBe(true);
    const [escrow] = await db.query(
      "SELECT SUM(amount_kobo)::int AS n FROM ledger WHERE account='escrow' AND owner_id=$1",
      [order.id],
    );
    expect(escrow.n).toBe(9000000);
    // Cancelled after acceptance: everyone gets their share back, Ahia gets its discount back.
    await call('buyer', 'post', `/bookings/${order.id}/cancel`, {});
    for (const u of ['buyer', 'other', 'admin'])
      expect((await call(u as any, 'get', '/wallet')).body.balance_kobo).toBe(10000000);
    expect(await ledgerBalances()).toBe(0);
  });
  it('refunds everyone when a group doesn’t fill, or the starter leaves', async () => {
    const goat = await shop('seller', 'Oko Oba Meats', 'Whole goat', 90000);
    for (const u of ['buyer', 'other'])
      await call(u as any, 'post', '/wallet/demo-fund', { amount_kobo: 10000000 });
    const g = (await call('buyer', 'post', '/group-buys', { listing_id: goat, shares: 4 })).body;
    expect(g.discount_pct).toBe(3);
    await call('other', 'post', `/group-buys/${g.id}/join`, {});
    await call('other', 'post', `/group-buys/${g.id}/leave`, {});
    expect((await call('other', 'get', '/wallet')).body.balance_kobo).toBe(10000000);
    await db.query("UPDATE group_buys SET expires_at=now()-interval '1 minute' WHERE id=$1", [
      g.id,
    ]);
    const { expireGroupBuys } = await import('../src/services/group-buy.service.js');
    await expireGroupBuys(db);
    expect((await call('buyer', 'get', '/wallet')).body.balance_kobo).toBe(10000000);
    expect((await call('buyer', 'get', `/group-buys/${g.id}`)).body.status).toBe('EXPIRED');
    expect(await ledgerBalances()).toBe(0);
  });
});
describe('fraud controls', () => {
  const simulated = () => createApp(db, { ...c, payments: false, demo: true });
  const as = (app_: any, actor: string, method: 'get' | 'post', path: string, body?: any) => {
    const r = request(app_)
      [method](`/v1${path}`)
      .set('Authorization', `Bearer token-${actor}`)
      .set('Idempotency-Key', randomUUID());
    return body === undefined ? r : r.send(body);
  };
  /** A wallet top-up by card, credited `hoursAgo` hours ago. */
  async function cardTopUp(user: string, kobo: number, hoursAgo = 0) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO funding(id,user_id,provider,amount_kobo,status,purpose,credited_at) VALUES($1,$2,'paystack',$3,'SUCCESSFUL','wallet',now()-make_interval(hours=>$4))",
      [id, user, kobo, hoursAgo],
    );
    await db.query(
      "INSERT INTO ledger(id,txn_id,account,owner_id,amount_kobo,reference) VALUES($1,$3,'wallet',$4,$5,$6),($2,$3,'provider_clearing',NULL,$7,$6)",
      [randomUUID(), randomUUID(), randomUUID(), user, kobo, id, -kobo],
    );
  }
  async function bankAccount(app_: any, user: string, number = '0123456789') {
    return as(app_, user, 'post', '/payouts/accounts', {
      transaction_pin: PIN,
      bank_code: '058',
      account_number: number,
    });
  }
  it('holds card top-ups, checks the bank name, applies limits and cool-downs', async () => {
    const sim = simulated();
    await cardTopUp('buyer', 3000000);
    await bankAccount(sim, 'buyer');
    await db.query("UPDATE users SET created_at=now()-interval '30 days' WHERE id='buyer'");
    // Simulated banks name the account after the user, so this one matches.
    const withdraw = (kobo: number) =>
      as(sim, 'buyer', 'post', '/payouts', {
        transaction_pin: PIN,
        amount_kobo: kobo,
        source: 'wallet',
      });
    let r = await withdraw(200000);
    expect(r.body.error.code).toBe('FUNDS_ON_HOLD');
    const summary = (await as(sim, 'buyer', 'get', '/payouts')).body;
    expect(summary.held_wallet_kobo).toBe(3000000);
    expect(summary.limits).toMatchObject({ level: 'BASIC', daily_limit_kobo: 10000000 });
    await db.query("UPDATE funding SET credited_at=now()-interval '3 days'");
    r = await withdraw(200000);
    expect(r.status).toBe(200);
    // Over the basic daily limit (₦100,000 incl. what was already asked for today).
    await cardTopUp('buyer', 20000000, 100);
    await db.query("UPDATE payouts SET status='PAID'");
    expect((await withdraw(9900000)).body.error.code).toBe('DAILY_LIMIT');
    // A bank account in someone else's name is blocked until staff allow it.
    await db.query(
      "UPDATE payout_accounts SET name_match=FALSE,account_name='Somebody Else' WHERE user_id='buyer'",
    );
    expect((await withdraw(100000)).body.error.code).toBe('NAME_MISMATCH');
    const [acct] = await db.query(
      "SELECT id FROM payout_accounts WHERE user_id='buyer' AND active",
    );
    await call('admin', 'post', `/admin/payout-accounts/${acct.id}/allow`, {
      reason: 'Joint account, checked',
    });
    expect((await withdraw(100000)).status).toBe(200);
    // Changing the bank account pauses withdrawals for a day and alerts the owner.
    await db.query("UPDATE payouts SET status='PAID'");
    await bankAccount(sim, 'buyer', '0123456780');
    expect((await withdraw(100000)).body.error.code).toBe('MONEY_LOCKED');
    const [alert] = await db.query(
      "SELECT title FROM notifications WHERE user_id='buyer' AND kind='security' AND title LIKE 'Withdrawals paused%'",
    );
    expect(alert).toBeTruthy();
  });
  it('needs two different staff for large payouts and stops frozen accounts', async () => {
    const sim = simulated();
    await cardTopUp('buyer', 3000000, 100);
    await db.query(
      "UPDATE users SET created_at=now()-interval '30 days',bvn_verified_at=now() WHERE id='buyer'",
    );
    await db.query('UPDATE settings SET payout_dual_approval_kobo=1000000');
    await bankAccount(sim, 'buyer');
    const p = (
      await as(sim, 'buyer', 'post', '/payouts', {
        transaction_pin: PIN,
        amount_kobo: 2000000,
        source: 'wallet',
      })
    ).body;
    const first = await as(sim, 'admin', 'post', `/admin/payouts/${p.id}/approve`);
    expect(first.body).toMatchObject({ status: 'REQUESTED', needs_second_approval: true });
    expect((await as(sim, 'admin', 'post', `/admin/payouts/${p.id}/approve`)).body.error.code).toBe(
      'SECOND_APPROVER_REQUIRED',
    );
    await db.query("UPDATE users SET admin=TRUE,staff_role='finance' WHERE id='other'");
    expect((await as(sim, 'other', 'post', `/admin/payouts/${p.id}/approve`)).body.status).toBe(
      'PAID',
    );
    await db.query('UPDATE settings SET payout_dual_approval_kobo=50000000');
    // Frozen: no withdrawals and no new orders until staff unfreeze.
    await call('admin', 'post', '/admin/users/buyer/freeze', {
      reason: 'Chargeback investigation',
    });
    expect(
      (
        await as(sim, 'buyer', 'post', '/payouts', {
          transaction_pin: PIN,
          amount_kobo: 100000,
          source: 'wallet',
        })
      ).body.error.code,
    ).toBe('ACCOUNT_FROZEN');
    const listing = await setup(10);
    expect(
      (await call('buyer', 'post', '/bookings', { listing_id: listing, quantity: 1 })).body.error
        .code,
    ).toBe('ACCOUNT_FROZEN');
    await call('admin', 'post', '/admin/users/buyer/unfreeze', {
      reason: 'Resolved with the bank',
    });
    expect(
      (await call('buyer', 'post', '/bookings', { listing_id: listing, quantity: 1 })).status,
    ).toBe(200);
  });
  it('flags linked devices and off-app payment requests for the risk queue', async () => {
    const listing = await setup(10);
    const device = 'device-1234567890';
    for (const actor of ['buyer', 'seller'])
      await request(app)
        .get('/v1/me')
        .set('Authorization', `Bearer token-${actor}`)
        .set('X-Device-Id', device);
    await new Promise((r) => setTimeout(r, 300));
    const conv = (await call('buyer', 'post', '/conversations', { listing_id: listing })).body;
    const m = await call('buyer', 'post', `/conversations/${conv.id}/messages`, {
      body: 'Abeg send the money to my opay 8012345678 make we do am outside',
    });
    expect(m.body.warning).toMatch(/Only pay inside Ahia/);
    const fine = await call('buyer', 'post', `/conversations/${conv.id}/messages`, {
      body: 'Is it fresh?',
    });
    expect(fine.body.warning).toBeNull();
    await call('buyer', 'post', '/bookings', { listing_id: listing, quantity: 1 });
    const flags = (await call('admin', 'get', '/admin/risk')).body;
    const kinds = flags.map((f: any) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['SHARED_DEVICE', 'SELF_DEALING']));
    const selfDealing = flags.find((f: any) => f.kind === 'SELF_DEALING');
    expect(selfDealing.related.id).toBe('seller');
    expect(
      (
        await call('admin', 'post', `/admin/risk/${selfDealing.id}/clear`, {
          note: 'Family business, fine',
        })
      ).status,
    ).toBe(200);
    expect((await call('admin', 'get', '/admin/risk?status=CLEARED')).body[0].note).toBe(
      'Family business, fine',
    );
    expect((await call('buyer', 'get', '/admin/risk')).status).toBe(403);
  });
  it('verifies a BVN through Flutterwave and raises limits; flags a name mismatch', async () => {
    await db.query("UPDATE users SET name='Ada Okafor' WHERE id='buyer'");
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) => {
        calls++;
        expect(init.headers.Authorization).toBe('Bearer FLWSECK_TEST');
        if (init.method === 'POST')
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { url: 'https://consent.example/abc', reference: 'REF1234567890123456789012' },
            }),
          );
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              status: 'COMPLETED',
              reference: 'REF1234567890123456789012',
              bvn_data: {
                firstName: 'Ada',
                middleName: 'Chioma',
                surname: 'Okafor',
                nin: '12345678901',
                watchlisted: 'NO',
                dateOfBirth: '1990-02-01',
              },
            },
          }),
        );
      }),
    );
    const started = (
      await call('buyer', 'post', '/me/kyc/bvn', {
        bvn: '12345678901',
        first_name: 'Ada',
        last_name: 'Okafor',
      })
    ).body;
    expect(started).toMatchObject({
      status: 'PENDING',
      consent_url: 'https://consent.example/abc',
      bvn_last4: '8901',
    });
    const done = (await call('buyer', 'post', `/me/kyc/bvn/${started.id}/refresh`, {})).body;
    expect(done).toMatchObject({ status: 'VERIFIED', name: 'Ada Chioma Okafor' });
    expect(calls).toBe(2);
    expect((await call('buyer', 'get', '/me/kyc')).body).toMatchObject({
      bvn_verified: true,
      verified_name: 'Ada Chioma Okafor',
    });
    expect((await call('buyer', 'get', '/payouts')).body.limits.level).toBe('VERIFIED');
    // Someone else's BVN (Flutterwave's sandbox person) is a mismatch and a high-risk flag.
    const sim = simulated();
    const other = (
      await as(sim, 'other', 'post', '/me/kyc/bvn', {
        bvn: '22222223883',
        first_name: 'Ada',
        last_name: 'Okafor',
      })
    ).body;
    expect(other.status).toBe('MISMATCH');
    const flags = (await call('admin', 'get', '/admin/risk')).body;
    expect(flags.find((f: any) => f.kind === 'BVN_NAME_MISMATCH')).toMatchObject({
      severity: 'HIGH',
    });
  });
  it('limits new riders and pay on delivery, blocks linked riders and records refusals', async () => {
    const { b, quote } = await readyForDeliveryFraud();
    // The rider shares a device with the seller: they can't take the job.
    await db.query(
      "INSERT INTO user_devices(user_id,device_id) VALUES('other','shared-dev-1'),('seller','shared-dev-1')",
    );
    const d = await call('buyer', 'post', `/bookings/${b}/delivery`, {
      vehicle_type: 'motorcycle',
      dropoff: { latitude: 6.6, longitude: 3.36 },
      dropoff_address: '14 Allen Avenue, Ikeja',
      expected_fare_kobo: quote.fare_kobo,
      pay_on_delivery: true,
    });
    expect(d.status).toBe(200);
    expect((await call('other', 'post', `/deliveries/${d.body.id}/claim`)).body.error.code).toBe(
      'CONFLICT',
    );
    await db.query('DELETE FROM user_devices');
    // A big order is beyond a new rider.
    await db.query('UPDATE bookings SET total_kobo=6000000 WHERE id=$1', [b]);
    expect((await call('other', 'post', `/deliveries/${d.body.id}/claim`)).body.error.code).toBe(
      'RIDER_LIMIT',
    );
    await db.query('UPDATE bookings SET total_kobo=200000 WHERE id=$1', [b]);
    await call('other', 'post', `/deliveries/${d.body.id}/claim`);
    // Evidence is required to check the goods.
    expect(
      (await call('other', 'post', `/deliveries/${d.body.id}/check`, {})).body.error.code,
    ).toBe('VALIDATION_ERROR');
    await call('other', 'post', '/wallet/demo-fund', { amount_kobo: 500000 });
    const url = `https://example.com/evidence/${randomUUID()}.webp`;
    await db.query('INSERT INTO media(id,owner_id,url,thumbnail_url) VALUES($1,$2,$3,$3)', [
      randomUUID(),
      'other',
      url,
    ]);
    const checked = await call('other', 'post', `/deliveries/${d.body.id}/check`, {
      photo_url: url,
      latitude: 6.55,
      longitude: 3.35,
    });
    expect(checked.body.check_photo_url).toBe(url);
    const [{ pickup_pin }] = await db.query('SELECT pickup_pin FROM deliveries WHERE id=$1', [
      d.body.id,
    ]);
    await call('seller', 'post', `/deliveries/${d.body.id}/handover`, { pin: pickup_pin });
    // At the door the buyer won't pay: refusals are counted and flagged.
    expect((await call('other', 'post', `/deliveries/${d.body.id}/refused`, {})).status).toBe(200);
    const [buyer] = await db.query("SELECT pod_refusals FROM users WHERE id='buyer'");
    expect(buyer.pod_refusals).toBe(1);
    await db.query("UPDATE users SET pod_refusals=2 WHERE id='buyer'");
    const flags = (await call('admin', 'get', '/admin/risk')).body;
    expect(flags.some((f: any) => f.kind === 'POD_REFUSED')).toBe(true);
  });
});
describe('transaction PIN and photo checks', () => {
  it('needs the transaction PIN to withdraw or change bank details, and locks after 5 misses', async () => {
    expect((await call('buyer', 'get', '/me/transaction-pin')).body).toEqual({
      set: true,
      locked_until: null,
    });
    const withdraw = (pin?: string) =>
      call('buyer', 'post', '/payouts', {
        amount_kobo: 100000,
        source: 'wallet',
        ...(pin ? { transaction_pin: pin } : {}),
      });
    expect((await withdraw()).body.error.code).toBe('TRANSACTION_PIN_MISSING');
    expect((await withdraw('1111')).body.error.code).toBe('INVALID_TRANSACTION_PIN');
    for (let i = 0; i < 3; i++) await withdraw('1111');
    expect((await withdraw('1111')).body.error.code).toBe('TRANSACTION_PIN_LOCKED');
    // Locked even with the right PIN.
    expect((await withdraw(PIN)).body.error.code).toBe('TRANSACTION_PIN_LOCKED');
    // The account password resets the PIN and the lock.
    await db.query("UPDATE users SET password_hash=$1 WHERE id='buyer'", [
      bcrypt.hashSync('correct-horse-123', 4),
    ]);
    expect(
      (await call('buyer', 'put', '/me/transaction-pin', { pin: '7391', password: 'nope' })).body
        .error.code,
    ).toBe('INVALID_PASSWORD');
    expect(
      (
        await call('buyer', 'put', '/me/transaction-pin', {
          pin: '7391',
          password: 'correct-horse-123',
        })
      ).body.set,
    ).toBe(true);
    expect((await withdraw('7391')).body.error?.code).not.toMatch(/TRANSACTION_PIN/);
    // Changing it with the current PIN works too; an easy PIN is refused.
    expect(
      (await call('buyer', 'put', '/me/transaction-pin', { pin: '0000', current_pin: '7391' }))
        .status,
    ).toBe(400);
    expect(
      (await call('buyer', 'put', '/me/transaction-pin', { pin: '5170', current_pin: '7391' }))
        .status,
    ).toBe(200);
    // Without a PIN, money can't leave the account.
    await db.query("UPDATE users SET transaction_pin_hash=NULL WHERE id='buyer'");
    expect((await withdraw('5170')).body.error.code).toBe('TRANSACTION_PIN_REQUIRED');
    expect((await call('buyer', 'get', '/me')).body.transaction_pin_set).toBe(false);
  });
  it('approves sellers and riders only with a selfie (and a rider licence photo) on file', async () => {
    await call('other', 'post', '/drivers', {
      vehicle_type: 'motorcycle',
      plate_number: 'lag-555-xy',
      licence_number: 'ABC12345',
      city: 'Lagos',
    });
    await db.query("DELETE FROM seller_documents WHERE id='drivers_licence-driver-other'");
    const review = await call('admin', 'post', '/admin/drivers/other/review', {
      status: 'APPROVED',
      reason: 'Looks fine',
    });
    expect(review.body.error.code).toBe('PHOTO_VERIFICATION_REQUIRED');
    expect(review.body.error.message).toMatch(/drivers licence/);
    await db.query("DELETE FROM seller_documents WHERE id='selfie-seller-seller'");
    expect(
      (
        await call('admin', 'post', '/admin/sellers/seller/review', {
          status: 'APPROVED',
          reason: 'Looks fine',
        })
      ).body.error.code,
    ).toBe('PHOTO_VERIFICATION_REQUIRED');
  });
});
describe('verified businesses', () => {
  it('verifies a business after a document review, shows the badge, suspends and expires it', async () => {
    const listing = await setup(10);
    const details = {
      full_name: 'Ada Okafor',
      home_address: '4 Palm Close, Ikorodu, Lagos',
      latitude: 6.62,
      longitude: 3.51,
      id_method: 'NIN',
      nin: '12345678901',
      legal_name: 'Ada Farms Limited',
      registration_number: 'RC 1234567',
    };
    const doc = (id: string, kind: string) =>
      db.query(
        `INSERT INTO seller_documents(id,seller_id,subject,kind,filename,mime_type,storage_provider,storage_key,status) VALUES($1,'seller','seller',$2,'f.webp','image/webp','local','docs/'||$1,'PENDING')`,
        [id, kind],
      );
    // Start without the selfie every test seller is given.
    await db.query("DELETE FROM seller_documents WHERE id='selfie-seller-seller'");
    // Location, a selfie and an ID (NIN card or BVN) are all needed.
    expect(
      (
        await call('seller', 'post', '/sellers/me/verification', {
          ...details,
          latitude: undefined,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('seller', 'post', '/sellers/me/verification', details)).body.error.code,
    ).toBe('SELFIE_REQUIRED');
    await doc('doc-selfie', 'selfie');
    expect(
      (await call('seller', 'post', '/sellers/me/verification', details)).body.error.code,
    ).toBe('ID_REQUIRED');
    expect(
      (await call('seller', 'post', '/sellers/me/verification', { ...details, id_method: 'BVN' }))
        .status,
    ).toBe(400);
    await doc('doc-1', 'government_id');
    expect((await call('seller', 'post', '/sellers/me/verification', details)).body).toEqual({
      status: 'PENDING',
    });
    expect(
      (await call('seller', 'post', '/sellers/me/verification', details)).body.error.code,
    ).toBe('VERIFICATION_IN_PROGRESS');
    // The seller sees only the last digits of their NIN; reviewers see it in full.
    const pending = (await call('seller', 'get', '/sellers/me/verification')).body;
    expect(pending.details.nin).toBe('•••••••8901');
    expect(pending).toMatchObject({ has_selfie: true, has_id_card: true });
    // A document that is pending or accepted can't be uploaded again; "other" can.
    const upload = (kind: string) =>
      request(app)
        .post('/v1/sellers/me/documents')
        .set('Authorization', 'Bearer token-seller')
        .field('kind', kind)
        .attach('file', Buffer.from('%PDF-1.4 test'), {
          filename: 'd.pdf',
          contentType: 'application/pdf',
        });
    expect((await upload('selfie')).body.error.code).toBe('DOCUMENT_ALREADY_SUBMITTED');
    expect((await upload('other')).status).toBe(201);
    // Finance staff can't review businesses; operations can.
    await db.query("UPDATE users SET staff_role='finance' WHERE id='admin'");
    expect((await call('admin', 'get', '/admin/verifications')).status).toBe(403);
    await db.query("UPDATE users SET staff_role='operations' WHERE id='admin'");
    const queue = (await call('admin', 'get', '/admin/verifications')).body;
    expect(queue[0]).toMatchObject({ seller_id: 'seller', verification_status: 'PENDING' });
    expect(queue[0].verification_details).toMatchObject({
      full_name: 'Ada Okafor',
      nin: '12345678901',
      id_method: 'NIN',
      contact_person: 'Ada Okafor',
    });
    expect(queue[0].documents.map((d: any) => d.kind)).toContain('selfie');
    expect(
      (
        await call('admin', 'post', '/admin/verifications/seller', {
          status: 'SUSPENDED',
          note: 'Trying to suspend a pending application.',
        })
      ).body.error.code,
    ).toBe('INVALID_TRANSITION');
    await call('admin', 'post', '/admin/verifications/seller', {
      status: 'VERIFIED',
      note: 'CAC certificate matches; phone and location confirmed.',
      valid_months: 12,
    });
    const found = (await call('buyer', 'get', '/search')).body.items.find(
      (l: any) => l.id === listing,
    );
    expect(found.seller_verified).toBe(true);
    expect((await call('buyer', 'get', '/sellers/seller')).body.verified).toBe(true);
    const nearby = (await call('buyer', 'get', '/nearby-sellers?lat=6.6&lng=3.5')).body;
    expect(nearby[0]).toMatchObject({ seller_id: 'seller', verified: true, products: 1 });
    const settings = (await call('buyer', 'get', '/settings')).body;
    expect(settings.catalog.commission_rates).toEqual({});
    const mine = (await call('seller', 'get', '/sellers/me/verification')).body;
    expect(mine.status).toBe('VERIFIED');
    expect(mine.history.map((h: any) => h.status)).toEqual(['VERIFIED', 'PENDING']);
    // Paying for promotion never changes verification; suspension removes the badge.
    await call('admin', 'post', '/admin/verifications/seller', {
      status: 'SUSPENDED',
      note: 'Complaints about counterfeit goods are under review.',
    });
    expect((await call('buyer', 'get', '/sellers/seller')).body.verified).toBe(false);
    await call('admin', 'post', '/admin/verifications/seller', {
      status: 'VERIFIED',
      note: 'Review closed; seller cleared after checks.',
    });
    await db.query(
      "UPDATE sellers SET verification_expires_at=now()-interval '1 day' WHERE user_id='seller'",
    );
    expect((await call('seller', 'get', '/sellers/me/verification')).body.status).toBe('EXPIRED');
    const history = (await call('admin', 'get', '/admin/verifications/seller/history')).body;
    expect(history[0]).toMatchObject({ status: 'EXPIRED' });
    expect(history.find((h: any) => h.status === 'SUSPENDED').actor_name).toBe('admin');
  });
});

describe('commission rules and revenue features', () => {
  it('uses category commission, honours the owner switch and shows the fee to the seller', async () => {
    const listing = await setup(20);
    await call('admin', 'put', '/admin/catalogue', {
      name: 'Vegetables',
      active: true,
      commission_bps: 200,
    });
    const reduced = await call('buyer', 'post', '/bookings', { listing_id: listing, quantity: 2 });
    expect(reduced.body).toMatchObject({ commission_bps: 200, commission_kobo: 4000 });
    const switches = (await call('admin', 'get', '/admin/revenue/switches')).body;
    await call('admin', 'put', '/admin/revenue/switches', {
      ...switches,
      transaction_commission: false,
    });
    const free = await call('other', 'post', '/bookings', { listing_id: listing, quantity: 1 });
    expect(free.body).toMatchObject({ commission_bps: 0, commission_kobo: 0 });
    await call('admin', 'put', '/admin/revenue/switches', { ...switches });
  });

  it('sells packages, featured shops and local adverts, and reports income by stream', async () => {
    const sale = await completedSale();
    const [{ listing_id: listing }] = await db.query(
      'SELECT listing_id FROM bookings WHERE id=$1',
      [sale],
    );
    // Packages are admin-priced; make them affordable from this seller's ₦1,900 proceeds.
    const packages = (await call('seller', 'get', '/promotion-packages?kind=PRODUCT')).body;
    expect(packages.map((p: any) => p.days)).toEqual([7, 14, 30]);
    await call('admin', 'put', '/admin/promotion-packages/pkg-product-7', {
      kind: 'PRODUCT',
      name: '7-day boost',
      days: 7,
      price_kobo: 50000,
    });
    await call('admin', 'put', '/admin/promotion-packages/pkg-seller-7', {
      kind: 'SELLER',
      name: 'Featured shop, 7 days',
      days: 7,
      price_kobo: 70000,
    });
    const promoted = await call('seller', 'post', `/listings/${listing}/promote`, {
      package_id: 'pkg-product-7',
    });
    expect(promoted.body).toMatchObject({ days: 7, fee_kobo: 50000, package_id: 'pkg-product-7' });
    const featured = await call('seller', 'post', '/sellers/me/featured', {
      package_id: 'pkg-seller-7',
    });
    expect(featured.body).toMatchObject({ ends_in_days: 7, fee_kobo: 70000 });
    expect(
      (await call('seller', 'post', '/sellers/me/featured', { package_id: 'pkg-seller-7' })).body
        .error.code,
    ).toBe('ALREADY_FEATURED');
    const rail = (await call('buyer', 'get', '/featured-sellers?state=Lagos')).body;
    expect(rail[0]).toMatchObject({ seller_id: 'seller', verified: false });
    expect((await call('seller', 'get', '/sellers/me/featured')).body[0].running).toBe(true);

    // An advertiser who doesn't sell on Ahia pays by transfer; staff record it.
    const ad = await call('admin', 'post', '/admin/ads', {
      advertiser: 'Lagos Supermarket',
      title: 'Weekend groceries 10% off',
      body: 'Visit our Ikeja store this weekend.',
      link_url: 'https://example.com/offer',
      states: ['Lagos'],
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      price_kobo: 2000000,
    });
    expect(
      (await call('admin', 'post', `/admin/ads/${ad.body.id}/status`, { status: 'ACTIVE' })).body
        .error.code,
    ).toBe('NOT_PAID');
    expect(
      (
        await call('admin', 'post', `/admin/ads/${ad.body.id}/payments`, {
          amount_kobo: 3000000,
          reference: 'TRF-001',
        })
      ).body.error.code,
    ).toBe('OVERPAYMENT');
    await call('admin', 'post', `/admin/ads/${ad.body.id}/payments`, {
      amount_kobo: 2000000,
      reference: 'TRF-001',
    });
    await call('admin', 'post', `/admin/ads/${ad.body.id}/status`, { status: 'ACTIVE' });
    expect((await call('buyer', 'get', '/ads?state=Abuja')).body).toEqual([]);
    const served = (await call('buyer', 'get', '/ads?state=Lagos')).body;
    expect(served[0]).toMatchObject({ title: 'Weekend groceries 10% off', label: 'Advertisement' });
    expect((await call('buyer', 'post', `/ads/${ad.body.id}/click`)).body.link_url).toBe(
      'https://example.com/offer',
    );
    const ads = (await call('admin', 'get', '/admin/ads')).body;
    expect(ads[0]).toMatchObject({ impressions: 1, clicks: 1, live: true, click_rate: 100 });
    // Owners can pause a paid feature everywhere.
    const switches = (await call('admin', 'get', '/admin/revenue/switches')).body;
    await call('admin', 'put', '/admin/revenue/switches', { ...switches, local_ads: false });
    expect((await call('buyer', 'get', '/ads?state=Lagos')).body).toEqual([]);
    await call('admin', 'put', '/admin/revenue/switches', switches);

    // Stopping a featured shop refunds unused whole days.
    const stop = await call('admin', 'post', `/admin/featured-sellers/${featured.body.id}/cancel`, {
      reason: 'Seller asked to stop',
    });
    expect(stop.body.refund_kobo).toBe(60000);

    const report = (await call('admin', 'get', '/admin/revenue/report')).body;
    const stream = (k: string) => report.streams.find((s: any) => s.stream === k)?.amount_kobo;
    expect(stream('transaction_commission')).toBe(10000);
    expect(stream('sponsored_products')).toBe(50000);
    expect(stream('featured_sellers')).toBe(10000);
    expect(stream('local_ads')).toBe(2000000);
    const [ledgerTotal] = await db.query(
      "SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM ledger WHERE account='platform_revenue'",
    );
    expect(report.total_kobo).toBe(Number(ledgerTotal.n));
    expect(report.orders.completed).toBe(1);
  });

  it('applies a delivery partner company’s agreed rate to its riders', async () => {
    const partner = await call('admin', 'post', '/admin/delivery-partners', {
      name: 'Swift Logistics',
      commission_bps: 1500,
      states: ['Lagos'],
    });
    await db.query(
      "INSERT INTO drivers(user_id,vehicle_type,plate_number,licence_number,city,status) VALUES('other','motorcycle','LAG-123','LIC-1','Lagos','APPROVED')",
    );
    expect(
      (
        await call('admin', 'post', `/admin/delivery-partners/${partner.body.id}/drivers`, {
          driver_id: 'other',
        })
      ).status,
    ).toBe(200);
    const list = (await call('admin', 'get', '/admin/delivery-partners')).body;
    expect(list[0]).toMatchObject({ name: 'Swift Logistics', drivers: 1, commission_bps: 1500 });
    expect(list[0].riders[0].driver_id).toBe('other');
    await call('admin', 'post', `/admin/delivery-partners/${partner.body.id}/drivers`, {
      driver_id: 'other',
      remove: true,
    });
    expect((await call('admin', 'get', '/admin/delivery-partners')).body[0].drivers).toBe(0);
  });
});

describe('complaint case management', () => {
  it('keeps a shared timeline, internal notes, assignment and a snapshot of the order', async () => {
    const sale = await completedSale();
    const opened = await call('buyer', 'post', `/bookings/${sale}/dispute`, {
      reason_code: 'DAMAGED',
      description: 'Half of the tomatoes were crushed when I opened the basket.',
    });
    const id = opened.body.id;
    let timeline = (await call('buyer', 'get', `/disputes/${id}/timeline`)).body;
    expect(timeline).toMatchObject({ priority: 'HIGH', status: 'OPEN' });
    expect(timeline.snapshot).toMatchObject({
      business_name: 'Ada’s Farm',
      title: 'Fresh tomatoes',
    });
    expect(timeline.notes[0]).toMatchObject({ kind: 'SYSTEM', author_role: 'system' });
    await call('seller', 'post', `/disputes/${id}/messages`, {
      body: 'Sorry about that. I can replace the crushed ones tomorrow.',
    });
    expect(
      (await call('other', 'post', `/disputes/${id}/messages`, { body: 'hello' })).status,
    ).toBe(404);
    // Staff: assign, internal note, and an update both parties see.
    const staff = (await call('admin', 'get', '/admin/disputes/assignees')).body;
    expect(staff.map((s: any) => s.id)).toContain('admin');
    await call('admin', 'post', `/admin/disputes/${id}/assign`, {
      staff_id: 'admin',
      priority: 'URGENT',
    });
    await call('admin', 'post', `/admin/disputes/${id}/notes`, {
      body: 'Seller has a history of good ratings; propose replacement.',
      internal: true,
    });
    await call('admin', 'post', `/admin/disputes/${id}/notes`, {
      body: 'We have asked the seller to replace the damaged tomatoes.',
      internal: false,
    });
    timeline = (await call('buyer', 'get', `/disputes/${id}/timeline`)).body;
    expect(timeline.notes.map((n: any) => n.kind)).toEqual(['SYSTEM', 'MESSAGE', 'UPDATE']);
    expect(timeline.notes[2].author_name).toBe('Ahia support');
    expect(timeline.assigned_name).toBe('admin');
    const staffView = (await call('admin', 'get', `/disputes/${id}/timeline`)).body;
    expect(staffView.notes.filter((n: any) => n.kind === 'INTERNAL')).toHaveLength(2);
    const mine = (await call('admin', 'get', '/admin/disputes/queue?view=MINE')).body;
    expect(mine[0]).toMatchObject({ id, priority: 'URGENT', business_name: 'Ada’s Farm' });
    expect((await call('admin', 'get', '/admin/disputes/queue?view=UNASSIGNED')).body).toEqual([]);
    await call('admin', 'post', `/admin/disputes/${id}/resolve`, {
      resolution: 'Seller replaced the damaged tomatoes.',
      refund_kobo: 0,
    });
    timeline = (await call('seller', 'get', `/disputes/${id}/timeline`)).body;
    expect(timeline.notes.at(-1).body).toMatch(/^Case resolved: Seller replaced/);
    expect(
      (await call('buyer', 'post', `/disputes/${id}/messages`, { body: 'Thanks!' })).body.error
        .code,
    ).toBe('CASE_CLOSED');
  });
});

describe('growth modules', () => {
  it('counts story views and likes', async () => {
    const listing = await setup(10);
    await db.query("UPDATE sellers SET state='Lagos',lga='Ikorodu' WHERE user_id='seller'");
    await db.query(
      `INSERT INTO local_statuses(id,seller_id,listing_id,caption,media_url,thumbnail_url,expires_at)
       VALUES('st-1','seller',$1,'Fresh today','https://example.com/a.webp','https://example.com/a-thumb.webp',now()+interval '1 day')`,
      [listing],
    );
    await db.query(
      "INSERT INTO local_status_events(status_id,viewer_key,views,sponsored) VALUES('st-1','v1',3,false),('st-1','v2',2,false)",
    );
    const feed = () => call('buyer', 'get', '/local-status?state=Lagos&lga=Ikorodu');
    expect((await feed()).body.items[0]).toMatchObject({
      view_count: 5,
      like_count: 0,
      liked: false,
    });
    expect((await call('buyer', 'post', '/local-status/st-1/like', { liked: true })).body).toEqual({
      liked: true,
      like_count: 1,
    });
    await call('other', 'post', '/local-status/st-1/like', { liked: true });
    expect((await feed()).body.items[0]).toMatchObject({ like_count: 2, liked: true });
    await call('buyer', 'post', '/local-status/st-1/like', { liked: false });
    expect((await feed()).body.items[0]).toMatchObject({ like_count: 1, liked: false });
  });

  it('lets only the seller delete their status, and hides it from the feed', async () => {
    const listing = await setup(10);
    await db.query("UPDATE sellers SET state='Lagos',lga='Ikorodu' WHERE user_id='seller'");
    await db.query(
      `INSERT INTO local_statuses(id,seller_id,listing_id,caption,media_url,thumbnail_url,expires_at)
       VALUES('st-del','seller',$1,'Fresh today','https://example.com/a.webp','https://example.com/a-thumb.webp',now()+interval '1 day')`,
      [listing],
    );
    const feed = () => call('buyer', 'get', '/local-status?state=Lagos&lga=Ikorodu');
    expect((await feed()).body.items).toHaveLength(1);
    expect((await call('buyer', 'delete', '/local-status/st-del')).status).toBe(404);
    expect((await call('seller', 'delete', '/local-status/st-del')).body).toEqual({ ok: true });
    expect((await feed()).body.items).toHaveLength(0);
    expect((await call('seller', 'delete', '/local-status/st-del')).status).toBe(404);
    // The product stays listed.
    const [l] = await db.query('SELECT status FROM listings WHERE id=$1', [listing]);
    expect(l.status).toBe('ACTIVE');
  });

  it('shares a plan with family as viewer or editor', async () => {
    const plan = await call('buyer', 'post', '/plans', { template: 'groceries', people: 3 });
    const id = plan.body.id;
    expect(
      (await call('buyer', 'post', `/plans/${id}/members`, { contact: 'nobody@test.com' })).body
        .error.code,
    ).toBe('USER_NOT_FOUND');
    await call('buyer', 'post', `/plans/${id}/members`, {
      contact: 'other@test.com',
      role: 'VIEWER',
    });
    const shared = (await call('other', 'get', '/plans')).body;
    expect(shared[0]).toMatchObject({ id, access: 'VIEWER', owner_name: 'buyer' });
    const detail = (await call('other', 'get', `/plans/${id}`)).body;
    expect(
      (await call('other', 'post', `/plans/${id}/items`, { name: 'Soap' })).body.error.code,
    ).toBe('PLAN_READ_ONLY');
    await call('buyer', 'post', `/plans/${id}/members`, {
      contact: 'other@test.com',
      role: 'EDITOR',
    });
    expect((await call('other', 'post', `/plans/${id}/items`, { name: 'Soap' })).status).toBe(200);
    expect(
      (
        await call('other', 'patch', `/plans/${id}/items/${detail.items[0].id}`, {
          status: 'OWNED',
        })
      ).status,
    ).toBe(200);
    expect((await call('other', 'delete', `/plans/${id}`)).body.error.code).toBe('PLAN_READ_ONLY');
    const members = (await call('other', 'get', `/plans/${id}/members`)).body;
    expect(members).toMatchObject({ you: 'EDITOR', owner: { user_id: 'buyer' } });
    expect((await call('seller', 'get', `/plans/${id}`)).status).toBe(404);
    // A member can leave; afterwards the plan is gone from their list.
    await call('other', 'delete', `/plans/${id}/members/other`);
    expect((await call('other', 'get', '/plans')).body).toEqual([]);
  });

  it('lets staff edit planner templates, recipes and ingredients', async () => {
    const content = (await call('admin', 'get', '/admin/planner/content')).body;
    const jollof = content.recipes.find((r: any) => r.key === 'jollof-rice');
    await call('admin', 'put', '/admin/planner/content/INGREDIENT/zobo_leaves', {
      data: {
        name: 'Zobo leaves',
        unit: 'kg',
        price: 3000,
        category: 'Food & groceries',
        keywords: 'zobo hibiscus',
      },
    });
    expect(
      (
        await call('admin', 'put', '/admin/planner/content/RECIPE/zobo', {
          data: {
            key: 'zobo',
            name: 'Zobo drink',
            description: 'Hibiscus drink.',
            time: 30,
            meals: ['LUNCH'],
            per_serving: { unknown_thing: 1 },
            steps: ['Boil'],
          },
        })
      ).body.error.code,
    ).toBe('UNKNOWN_INGREDIENT');
    await call('admin', 'put', '/admin/planner/content/RECIPE/zobo', {
      data: {
        key: 'zobo',
        name: 'Zobo drink',
        description: 'Hibiscus drink.',
        time: 30,
        meals: ['LUNCH'],
        per_serving: { zobo_leaves: 0.05, sugar: 0.02 },
        steps: ['Boil the leaves', 'Sweeten and chill'],
      },
    });
    await call('admin', 'put', '/admin/planner/content/RECIPE/jollof-rice', {
      data: { ...jollof.data, name: 'Party jollof rice' },
    });
    await call('admin', 'put', '/admin/planner/content/TEMPLATE/wedding', { active: false });
    const recipes = (await call('buyer', 'get', '/planner/recipes')).body;
    expect(recipes.find((r: any) => r.key === 'zobo').name).toBe('Zobo drink');
    expect(recipes.find((r: any) => r.key === 'jollof-rice').name).toBe('Party jollof rice');
    const templates = (await call('buyer', 'get', '/planner/templates')).body.map(
      (t: any) => t.key,
    );
    expect(templates).not.toContain('wedding');
    await call('admin', 'delete', '/admin/planner/content/TEMPLATE/wedding');
    await call('admin', 'delete', '/admin/planner/content/RECIPE/jollof-rice');
    expect(
      (await call('buyer', 'get', '/planner/templates')).body.map((t: any) => t.key),
    ).toContain('wedding');
    await db.query('DELETE FROM planner_content');
    await call('admin', 'delete', '/admin/planner/content/RECIPE/zobo');
  });

  it('uploads advert images and targets adverts by the buyer’s location', async () => {
    const ad = await call('admin', 'post', '/admin/ads', {
      advertiser: 'Kano Grains',
      title: 'Millet by the bag',
      states: ['Kano'],
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000).toISOString(),
      price_kobo: 0,
    });
    const png = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#26408f' },
    })
      .png()
      .toBuffer();
    const up = await request(app)
      .post(`/v1/admin/ads/${ad.body.id}/image`)
      .set('Authorization', 'Bearer token-admin')
      .attach('image', png, { filename: 'ad.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.image_url).toMatch(/\/media\/.+\.webp$/);
    await call('admin', 'post', `/admin/ads/${ad.body.id}/status`, { status: 'ACTIVE' });
    expect((await call('buyer', 'get', '/ads?lat=6.5&lng=3.4')).body).toEqual([]); // Lagos
    const kano = (await call('buyer', 'get', '/ads?lat=12.0&lng=8.5')).body;
    expect(kano[0]).toMatchObject({ title: 'Millet by the bag', image_url: up.body.image_url });
  });

  it('sells seller plans from proceeds, gates premium tools and activates paid memberships', async () => {
    const sale = await completedSale();
    const [{ listing_id: listing }] = await db.query(
      'SELECT listing_id FROM bookings WHERE id=$1',
      [sale],
    );
    const assist = {
      title: 'fresh tomatoes',
      category: 'Vegetables',
      unit: 'kg',
      price_kobo: 100000,
    };
    expect(
      (await call('seller', 'post', '/sellers/me/ai/listing-assist', assist)).body.error.code,
    ).toBe('UPGRADE_REQUIRED');
    const plans = (await call('seller', 'get', '/subscription-plans?audience=SELLER')).body;
    expect(plans.map((p: any) => p.id)).toEqual(['seller-pro', 'seller-business']);
    expect(
      (await call('seller', 'post', '/me/subscriptions', { plan_id: 'seller-business' })).body.error
        .code,
    ).toBe('INSUFFICIENT_PROCEEDS');
    await call('admin', 'put', '/admin/subscription-plans/seller-business', {
      audience: 'SELLER',
      name: 'Business',
      price_kobo: 100000,
      period_days: 30,
      features: {
        insights: true,
        ai_assistant: true,
        business_report: true,
        bulk_import: true,
        team_seats: 2,
        api_access: true,
      },
    });
    const sub = await call('seller', 'post', '/me/subscriptions', { plan_id: 'seller-business' });
    expect(sub.body.status).toBe('ACTIVE');
    const help = (await call('seller', 'post', '/sellers/me/ai/listing-assist', assist)).body;
    expect(help).toMatchObject({ title: 'Fresh tomatoes', source: 'rules', price: null });
    expect(help.tips.length).toBeGreaterThan(1);
    const report = (await call('seller', 'get', '/sellers/me/business-report')).body;
    expect(report.sales).toMatchObject({ completed: 1, gross_kobo: 200000 });
    const insights = (
      await call('seller', 'get', '/sellers/me/market-insights?category=Vegetables')
    ).body;
    expect(insights).toMatchObject({ sellers: 1, price: null }); // too few sellers to show prices
    const research = (await call('admin', 'get', '/admin/market-reports')).body;
    expect(research.rows[0]).toMatchObject({
      category: 'Vegetables',
      suppressed: true,
      median_price_kobo: null,
    });
    // Enterprise: bulk upload and team seats.
    const imported = await call('seller', 'post', '/sellers/me/listings/import', {
      items: [
        {
          title: 'Green peppers',
          description: 'Fresh green peppers',
          category: 'Vegetables',
          unit: 'kg',
          price_kobo: 150000,
          stock: 20,
        },
        {
          title: 'Carrots',
          description: 'Sweet carrots from Jos',
          category: 'Vegetables',
          unit: 'kg',
          price_kobo: 120000,
          stock: 15,
        },
      ],
    });
    expect(imported.body.created).toBe(2);
    await call('seller', 'post', '/sellers/me/team', {
      contact: 'other@test.com',
      role: 'MANAGER',
    });
    expect((await call('seller', 'get', '/sellers/me/team')).body).toMatchObject({ seats: 2 });
    // Buyer membership: paid by transfer, then activated by staff (counted as revenue).
    const member = await call('buyer', 'post', '/me/subscriptions', { plan_id: 'ahia-plus' });
    expect(member.body.status).toBe('PENDING_PAYMENT');
    await call('admin', 'post', `/admin/subscriptions/${member.body.id}/activate`, {
      reference: 'TRF-PLUS-1',
    });
    const mine = (await call('buyer', 'get', '/me/subscriptions')).body;
    expect(mine.subscriptions[0]).toMatchObject({ status: 'ACTIVE', plan_id: 'ahia-plus' });
    const income = (await call('admin', 'get', '/admin/revenue/report')).body;
    expect(income.streams.find((s: any) => s.stream === 'subscriptions').amount_kobo).toBe(
      100000 + 200000,
    );
    await call('seller', 'post', `/me/subscriptions/${sub.body.id}/cancel`);
    expect((await call('seller', 'get', '/sellers/me/business-report')).body.error.code).toBe(
      'UPGRADE_REQUIRED',
    );
    expect(listing).toBeTruthy();
  });

  it('runs a B2B request for quotes from request to award', async () => {
    await setup(10);
    const rfq = await call('buyer', 'post', '/rfqs', {
      business_name: 'Mama Put Kitchen',
      title: 'Tomatoes for our restaurant',
      category: 'Vegetables',
      quantity: 200,
      unit: 'kg',
      state: 'Lagos',
      budget_kobo: 30000000,
    });
    const open = (await call('seller', 'get', '/rfqs/open')).body;
    expect(open[0]).toMatchObject({ id: rfq.body.id, matches_my_shop: true, my_quote: null });
    await call('seller', 'post', `/rfqs/${rfq.body.id}/quotes`, {
      total_kobo: 25000000,
      delivery_days: 2,
      note: 'Weekly supply possible',
    });
    const detail = (await call('buyer', 'get', `/rfqs/${rfq.body.id}`)).body;
    expect(detail.quotes[0]).toMatchObject({ business_name: 'Ada’s Farm', total_kobo: 25000000 });
    expect((await call('other', 'get', `/rfqs/${rfq.body.id}`)).status).toBe(404);
    const award = await call(
      'buyer',
      'post',
      `/rfqs/${rfq.body.id}/quotes/${detail.quotes[0].id}/accept`,
    );
    expect(award.body.seller_id).toBe('seller');
    expect((await call('buyer', 'get', '/rfqs/mine')).body[0].status).toBe('AWARDED');
    const second = await call('buyer', 'post', '/rfqs', {
      title: 'Onions monthly',
      category: 'Vegetables',
      quantity: 5,
      unit: 'bag',
    });
    expect((await call('buyer', 'post', `/rfqs/${second.body.id}/close`)).status).toBe(200);
  });

  it('gives Business sellers API keys, a partner API and signed webhooks', async () => {
    const listing = await setup(10);
    expect(
      (await call('seller', 'post', '/sellers/me/api-keys', { name: 'POS' })).body.error.code,
    ).toBe('UPGRADE_REQUIRED');
    await db.query(
      "INSERT INTO subscriptions(id,plan_id,user_id,status,starts_at,ends_at) VALUES('sub-b','seller-business','seller','ACTIVE',now(),now()+interval '30 days')",
    );
    const key = await call('seller', 'post', '/sellers/me/api-keys', {
      name: 'POS',
      scopes: ['listings:read', 'listings:write', 'orders:read'],
    });
    expect(key.body.key).toMatch(/^ahia_/);
    expect((await request(app).get('/v1/partner/listings')).status).toBe(401);
    const api = (path: string) => request(app).get(`/v1${path}`).set('X-Api-Key', key.body.key);
    const listings = await api('/partner/listings');
    expect(listings.body[0]).toMatchObject({ id: listing, title: 'Fresh tomatoes' });
    const patch = await request(app)
      .patch(`/v1/partner/listings/${listing}`)
      .set('X-Api-Key', key.body.key)
      .send({ stock: 42, price_kobo: 110000 });
    expect(patch.status).toBe(200);
    const [v] = await db.query(
      'SELECT stock,price_kobo FROM listing_variants WHERE listing_id=$1 AND is_primary',
      [listing],
    );
    expect(v).toMatchObject({ stock: 42, price_kobo: 110000 });
    const hook = await call('seller', 'post', '/sellers/me/webhooks', {
      url: 'https://partner.example/hooks',
    });
    expect(hook.body.secret).toMatch(/^whsec_/);
    await call('buyer', 'post', '/bookings', { listing_id: listing, quantity: 1 });
    const sent: any[] = [];
    const fake = (async (url: string, init: any) => {
      sent.push({ url, ...init });
      return new Response('ok');
    }) as unknown as typeof fetch;
    expect(await deliverPartnerWebhooks(db, fake)).toBe(1);
    const body = JSON.parse(sent[0].body);
    expect(body).toMatchObject({
      event: 'order.created',
      data: { listing_id: listing, status: 'REQUESTED' },
    });
    const signature = createHmac('sha256', hook.body.secret).update(sent[0].body).digest('hex');
    expect(sent[0].headers['x-ahia-signature']).toBe(signature);
    expect((await api('/partner/orders')).body[0].status).toBe('REQUESTED');
    const integrations = (await call('admin', 'get', '/admin/integrations')).body;
    expect(integrations.providers.find((p: any) => p.kind === 'ai')).toMatchObject({
      provider: 'rules',
      connected: false,
    });
    expect(integrations.partner_api.active_keys).toBe(1);
    const listed = (await call('seller', 'get', '/sellers/me/integrations')).body;
    await call('seller', 'delete', `/sellers/me/api-keys/${listed.keys[0].id}`);
    await call('seller', 'delete', `/sellers/me/webhooks/${listed.webhooks[0].id}`);
    expect((await api('/partner/listings')).status).toBe(401);
  });

  it('lets team members work on the shop within their role', async () => {
    const listing = await setup(10);
    const asTeam = (method: 'get' | 'post' | 'patch', path: string, body?: any) => {
      const r = request(app)
        [method](`/v1${path}`)
        .set('Authorization', 'Bearer token-other')
        .set('X-Act-As-Seller', 'seller')
        .set('Idempotency-Key', randomUUID());
      return body === undefined ? r : r.send(body);
    };
    expect((await asTeam('get', '/me')).body.error.code).toBe('NOT_ON_TEAM');
    await db.query(
      "INSERT INTO subscriptions(id,plan_id,user_id,status,starts_at,ends_at) VALUES('sub-team','seller-business','seller','ACTIVE',now(),now()+interval '30 days')",
    );
    await call('seller', 'post', '/sellers/me/team', { contact: 'other@test.com', role: 'STAFF' });
    expect((await call('other', 'get', '/me/teams')).body[0]).toMatchObject({
      seller_id: 'seller',
      role: 'STAFF',
      business_name: 'Ada’s Farm',
    });
    const me = (await asTeam('get', '/me')).body;
    expect(me.user).toMatchObject({
      id: 'seller',
      admin: false,
      acting_member: { id: 'other', role: 'STAFF' },
    });
    expect(me.seller.business_name).toBe('Ada’s Farm');
    // Staff can add products and handle orders for the shop.
    const created = await asTeam('post', '/listings', {
      title: 'Ripe plantain',
      description: 'Sweet ripe plantain from the farm',
      category: 'Fruit',
      unit: 'piece',
      price_kobo: 50000,
      stock: 30,
    });
    expect(created.status).toBe(200);
    const [row] = await db.query('SELECT seller_id FROM listings WHERE id=$1', [created.body.id]);
    expect(row.seller_id).toBe('seller');
    const order = await book(listing);
    expect((await asTeam('post', `/bookings/${order}/accept`)).status).toBe(200);
    // Money, promotions, cancellations and the team stay with the owner (or a manager).
    expect((await asTeam('get', '/payouts')).body.error.code).toBe('TEAM_ROLE_FORBIDDEN');
    expect(
      (await asTeam('post', `/listings/${listing}/promote`, { package_id: 'pkg-product-7' })).body
        .error.code,
    ).toBe('TEAM_ROLE_FORBIDDEN');
    expect(
      (await asTeam('post', `/bookings/${order}/cancel`, { reason: 'Out of stock today' })).body
        .error.code,
    ).toBe('TEAM_ROLE_FORBIDDEN');
    expect((await asTeam('get', '/sellers/me/team')).body.error.code).toBe('TEAM_ROLE_FORBIDDEN');
    // The owner sees what the team changed.
    const team = (await call('seller', 'get', '/sellers/me/team')).body;
    expect(team.activity.map((a: any) => a.path)).toEqual(
      expect.arrayContaining(['/listings', `/bookings/${order}/accept`]),
    );
    expect(team.activity.every((a: any) => a.member_name === 'other')).toBe(true);
    // Without a plan with team seats, or once removed, access stops.
    await db.query("UPDATE subscriptions SET status='CANCELLED' WHERE id='sub-team'");
    expect((await asTeam('get', '/me')).body.error.code).toBe('TEAM_PLAN_REQUIRED');
    await db.query("UPDATE subscriptions SET status='ACTIVE' WHERE id='sub-team'");
    await call('seller', 'delete', '/sellers/me/team/other');
    expect((await asTeam('get', '/me')).body.error.code).toBe('NOT_ON_TEAM');
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
    // 12 km × ₦500 = ₦6,000
    expect(quote.body.fare_kobo).toBe(600000);
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
describe('staff sign-in codes', () => {
  it('lets support issue a fresh code for a waiting sign-up, never for a password reset', async () => {
    const reg = await request(app).post('/v1/auth/register').send({
      name: 'Code Person',
      email: 'stuck@test.com',
      phone: '+2348091112222',
      password: 'correct-horse-123',
      transaction_pin: '4826',
    });
    expect(reg.status).toBe(202);
    const emailed = latestCode();
    expect((await call('buyer', 'get', '/admin/sign-in-codes')).status).toBe(403);
    const list = await call('admin', 'get', '/admin/sign-in-codes?email=stuck');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      email: 'stuck@test.com',
      name: 'Code Person',
      purpose: 'register',
    });
    expect(JSON.stringify(list.body)).not.toContain('code_hash');
    const issued = await call(
      'admin',
      'post',
      `/admin/sign-in-codes/${reg.body.challenge_id}/issue`,
    );
    expect(issued.status).toBe(200);
    expect(issued.body.code).toMatch(/^\d{6}$/);
    const [log] = await db.query("SELECT * FROM audit WHERE action='auth.issue_code'");
    expect(log.entity_id).toBe(reg.body.challenge_id);
    if (issued.body.code !== emailed)
      expect(
        (
          await request(app)
            .post('/v1/auth/otp/verify')
            .send({ challenge_id: reg.body.challenge_id, code: emailed })
        ).status,
      ).toBe(400);
    const ok = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: reg.body.challenge_id, code: issued.body.code });
    expect(ok.status).toBe(200);
    expect((await call('admin', 'get', '/admin/sign-in-codes?email=stuck')).body).toHaveLength(0);
    // Password resets need only an email, so staff can never issue those codes.
    await db.query("UPDATE otp_challenges SET sent_at=now()-interval '2 minutes'");
    const reset = await request(app)
      .post('/v1/auth/password/forgot')
      .send({ email: 'stuck@test.com' });
    expect(reset.status).toBe(202);
    expect(
      (await call('admin', 'post', `/admin/sign-in-codes/${reset.body.challenge_id}/issue`)).status,
    ).toBe(404);
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
      await outside.publish('ahia:user-sync', 'buyer');
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
