// Guided payment acceptance test against a deployed environment (staging) in provider TEST mode.
//   npm run acceptance:payments -- --api https://<api-host>
// It drives the real API and pauses where a person must act: emailed sign-in codes, paying with a
// test card in the provider's checkout, and choosing a test bank account. Results are written to
// docs/acceptance/payments-<date>.md. Never point this at production keys.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const next = process.argv[i + 1];
  args[arg.slice(2)] = next === undefined || next.startsWith('--') ? true : (i++, next);
}
if (!args.api) {
  console.error('Usage: npm run acceptance:payments -- --api https://<api-host> [--amount 1000]');
  process.exit(2);
}
const API = `${String(args.api).replace(/\/$/, '')}/v1`;
const AMOUNT_KOBO = Math.round(Number(args.amount || 1000) * 100);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(`${q} `);
const results = [];
const record = (step, status, detail = '') => {
  results.push({ step, status, detail });
  console.log(`${status.padEnd(5)} ${step}${detail ? ` — ${detail}` : ''}`);
};
const naira = (kobo) => `₦${(Number(kobo) / 100).toLocaleString()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `${method} ${path}: ${res.status} ${data.error?.code || ''} ${data.error?.message || ''}`,
    );
  return data;
}

async function signIn(role) {
  const email = await ask(`${role} account email:`);
  const password = await ask(`${role} password:`);
  const challenge = await call(null, 'POST', '/auth/login', { email, password });
  const code = await ask(`Code emailed to ${email}:`);
  const session = await call(null, 'POST', '/auth/otp/verify', {
    challenge_id: challenge.challenge_id,
    code,
  });
  console.log(`Signed in as ${session.user.name}.`);
  return { token: session.token, user: session.user };
}

async function topUp(buyer, provider) {
  const before = (await call(buyer.token, 'GET', '/wallet')).balance_kobo;
  const checkout = await call(buyer.token, 'POST', '/wallet/fund', {
    provider,
    amount_kobo: AMOUNT_KOBO,
  });
  record(
    `${provider}: checkout created`,
    'PASS',
    `${checkout.reference}${checkout.fallback_used ? ' (fallback provider used)' : ''}`,
  );
  console.log(
    `\nOpen and pay ${naira(AMOUNT_KOBO)} with a ${provider} TEST card:\n  ${checkout.checkout_url}`,
  );
  console.log(
    provider === 'paystack'
      ? '  Test cards: https://paystack.com/docs/payments/test-payments'
      : '  Test cards: https://developer.flutterwave.com/docs/test-cards',
  );
  await ask('Press Enter once the checkout says the payment succeeded…');
  // Webhook path first: the provider calls the API, which verifies and credits.
  let status = '';
  for (let i = 0; i < 18 && status !== 'SUCCESSFUL'; i++) {
    const wallet = await call(buyer.token, 'GET', '/wallet');
    status = wallet.funding.find((f) => f.id === checkout.reference)?.status || '';
    if (status !== 'SUCCESSFUL') await sleep(5000);
  }
  if (status === 'SUCCESSFUL') record(`${provider}: credited by webhook`, 'PASS');
  else {
    record(
      `${provider}: credited by webhook`,
      'FAIL',
      `status ${status || 'unknown'} after 90 s — check the webhook URL and secret`,
    );
    await call(buyer.token, 'POST', `/wallet/funding/${checkout.reference}/verify`).then(
      () => record(`${provider}: credited by manual verify`, 'PASS'),
      (e) => record(`${provider}: credited by manual verify`, 'FAIL', e.message),
    );
  }
  const after = (await call(buyer.token, 'GET', '/wallet')).balance_kobo;
  record(
    `${provider}: exact amount credited`,
    after - before === AMOUNT_KOBO ? 'PASS' : 'FAIL',
    `${naira(after - before)}`,
  );
  await call(buyer.token, 'POST', `/wallet/funding/${checkout.reference}/verify`).catch(() => {});
  const replay = (await call(buyer.token, 'GET', '/wallet')).balance_kobo;
  record(
    `${provider}: second verify does not credit again`,
    replay === after ? 'PASS' : 'FAIL',
    naira(replay - after),
  );
}

async function earnProceeds(buyer, seller) {
  const listings = await call(buyer.token, 'GET', `/sellers/${seller.user.id}/listings`);
  const listing = listings.find(
    (l) => l.in_stock && l.variants?.some((v) => v.active && v.stock >= v.min_quantity),
  );
  if (!listing)
    return record('purchase for seller proceeds', 'SKIP', 'the seller has no listing in stock');
  const variant = listing.variants.find((v) => v.active && v.stock >= v.min_quantity);
  const booking = await call(buyer.token, 'POST', '/bookings', {
    listing_id: listing.id,
    variant_id: variant.id,
    quantity: variant.min_quantity,
  });
  await call(seller.token, 'POST', `/bookings/${booking.id}/accept`, {});
  await call(buyer.token, 'POST', `/bookings/${booking.id}/pay`, {});
  await call(seller.token, 'POST', `/bookings/${booking.id}/ready`, {});
  const { pickup_code } = await call(buyer.token, 'GET', `/bookings/${booking.id}`);
  await call(seller.token, 'POST', `/bookings/${booking.id}/pickup`, { code: pickup_code });
  record(
    'purchase paid from wallet and collected',
    'PASS',
    `${listing.title}, ${naira(booking.total_kobo)}`,
  );
}

async function payout(seller, admin) {
  const summary = await call(seller.token, 'GET', '/payouts');
  if (summary.mode !== 'provider')
    return record('payout', 'SKIP', `payout mode is ${summary.mode}`);
  if (summary.available_kobo < summary.min_kobo)
    return record(
      'payout',
      'SKIP',
      `only ${naira(summary.available_kobo)} available (minimum ${naira(summary.min_kobo)})`,
    );
  const { banks, provider } = await call(seller.token, 'GET', '/payouts/banks');
  console.log(`\nPayouts use ${provider}. Use one of ${provider}'s documented TEST bank accounts.`);
  const query = (await ask('Bank name to search for:')).toLowerCase();
  const matches = banks.filter((b) => b.name.toLowerCase().includes(query)).slice(0, 8);
  matches.forEach((b, i) => console.log(`  ${i + 1}. ${b.name} (${b.code})`));
  const bank = matches[Number(await ask('Choose a number:')) - 1];
  const account_number = await ask('10-digit test account number:');
  const resolved = await call(seller.token, 'POST', '/payouts/accounts/resolve', {
    bank_code: bank.code,
    account_number,
  });
  record('bank account name confirmed by provider', 'PASS', resolved.account_name);
  await call(seller.token, 'POST', '/payouts/accounts', { bank_code: bank.code, account_number });
  const request = await call(seller.token, 'POST', '/payouts', { amount_kobo: summary.min_kobo });
  record('payout requested; funds held', 'PASS', naira(request.amount_kobo));
  const approved = await call(admin.token, 'POST', `/admin/payouts/${request.id}/approve`, {});
  record(
    'payout approved; transfer sent to provider',
    approved.status === 'FAILED' ? 'FAIL' : 'PASS',
    approved.status,
  );
  let status = approved.status;
  for (let i = 0; i < 36 && status === 'PROCESSING'; i++) {
    await sleep(5000);
    status = (await call(admin.token, 'GET', '/admin/payouts')).find(
      (p) => p.id === request.id,
    )?.status;
  }
  if (status === 'PROCESSING') {
    status = (await call(admin.token, 'POST', `/admin/payouts/${request.id}/recheck`, {})).status;
    record('payout settled after manual recheck', status === 'PAID' ? 'PASS' : 'FAIL', status);
  } else record('payout settled (transfer webhook)', status === 'PAID' ? 'PASS' : 'FAIL', status);
}

try {
  const settings = await call(null, 'GET', '/settings');
  if (settings.payment_mode !== 'provider') {
    record('server uses provider payments', 'FAIL', `payment_mode is ${settings.payment_mode}`);
    throw new Error('Enable PAYMENTS_ENABLED and provider TEST keys on the server first.');
  }
  record('server uses provider payments', 'PASS', settings.providers.join(', '));
  console.log(
    '\nSign in with three test accounts: a buyer, an approved seller with stock, and finance/owner staff.',
  );
  const buyer = await signIn('Buyer');
  const seller = await signIn('Seller');
  const admin = await signIn('Staff (finance or owner)');
  for (const provider of settings.providers) await topUp(buyer, provider);
  await earnProceeds(buyer, seller);
  await payout(seller, admin);
} catch (err) {
  record('run aborted', 'FAIL', err.message);
} finally {
  rl.close();
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync('docs/acceptance', { recursive: true });
  const file = `docs/acceptance/payments-${date}.md`;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  writeFileSync(
    file,
    `# Payment acceptance — ${date}\n\nAPI: ${API}\nAmount: ${naira(AMOUNT_KOBO)} per top-up\nResult: ${failed ? `${failed} failed` : 'all passed'}\n\n| Step | Result | Detail |\n| --- | --- | --- |\n${results.map((r) => `| ${r.step} | ${r.status} | ${r.detail.replaceAll('|', '/')} |`).join('\n')}\n`,
  );
  console.log(`\nReport: ${file}`);
  process.exitCode = failed ? 1 : 0;
}
