// Post-deploy smoke test for a deployed environment.
//   node scripts/smoke.mjs --api https://ahia-api.onrender.com \
//     [--admin https://…] [--web https://…] [--commit <sha>] [--wait 900] [--allow-demo]
// Staging must use real provider (test-mode) payments; --allow-demo is for local checks.
// With --commit it first waits (up to --wait seconds) until /health reports that commit.
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const next = process.argv[i + 1];
  // A flag followed by nothing or by another flag is a boolean switch.
  args[arg.slice(2)] = next === undefined || next.startsWith('--') ? true : (i++, next);
}
if (!args.api) {
  console.error(
    'Usage: node scripts/smoke.mjs --api <url> [--admin <url>] [--web <url>] [--commit <sha>]',
  );
  process.exit(2);
}
const api = args.api.replace(/\/$/, '');
const failures = [];
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`ok    ${label}`);
  } catch (err) {
    failures.push(label);
    console.log(`FAIL  ${label}: ${err.message}`);
  }
};
const get = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  return { res, body: await res.text() };
};

if (args.commit) {
  const deadline = Date.now() + Number(args.wait || 900) * 1000;
  let version = '';
  while (Date.now() < deadline) {
    version = await get(`${api}/health`)
      .then(({ body }) => JSON.parse(body).version)
      .catch(() => '');
    if (version === args.commit) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
  await check(`deployed commit is ${args.commit.slice(0, 7)}`, async () => {
    if (version !== args.commit) throw new Error(`still running ${version || 'unknown'}`);
  });
}
await check('API /health/ready', async () => {
  const { res, body } = await get(`${api}/health/ready`);
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 200)}`);
});
await check('public settings endpoint', async () => {
  const { res, body } = await get(`${api}/v1/settings`);
  const settings = JSON.parse(body);
  if (!res.ok || (settings.payment_mode === 'demo' && !args['allow-demo']))
    throw new Error(`${res.status} payment_mode=${settings.payment_mode}`);
});
await check('protected endpoints require sign-in', async () => {
  const { res } = await get(`${api}/v1/wallet`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});
for (const [name, url] of [
  ['admin', args.admin],
  ['web', args.web],
]) {
  if (!url) continue;
  const origin = new URL(url).origin;
  await check(`${name} site loads`, async () => {
    const { res, body } = await get(url);
    if (!res.ok || (!body.includes('<div id="root"') && !body.includes('id="root"')))
      throw new Error(`${res.status}`);
  });
  await check(`${name} origin allowed by CORS`, async () => {
    const { res } = await get(`${api}/v1/settings`, { headers: { Origin: origin } });
    if (res.headers.get('access-control-allow-origin') !== origin)
      throw new Error('origin not allowed');
  });
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nStaging looks healthy.');
