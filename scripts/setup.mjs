// One-time local setup: env files, Docker Postgres, migrations and demo accounts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const portFree = (port) =>
  new Promise((ok) => {
    const s = net.createServer().once('error', () => ok(false));
    s.once('listening', () => s.close(() => ok(true))).listen(port, '127.0.0.1');
  });
const setVar = (text, key, value) =>
  new RegExp(`^${key}=.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`)
    : `${text.trimEnd()}\n${key}=${value}\n`;

// 1. Repo-root .env holds the local Postgres password and port for docker compose.
let root = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
if (!/^POSTGRES_PASSWORD=.+$/m.test(root))
  root = setVar(root, 'POSTGRES_PASSWORD', randomBytes(16).toString('hex'));
if (!/^POSTGRES_PORT=\d+$/m.test(root))
  root = setVar(root, 'POSTGRES_PORT', (await portFree(5432)) ? '5432' : '5433');
writeFileSync('.env', root, { mode: 0o600 });
const password = /^POSTGRES_PASSWORD=(.+)$/m.exec(root)[1];
const port = /^POSTGRES_PORT=(\d+)$/m.exec(root)[1];
const url = (db) => `postgresql://farmers_market:${password}@127.0.0.1:${port}/${db}`;

// 2. App env files.
for (const folder of ['apps/api', 'apps/mobile', 'apps/admin']) {
  const target = `${folder}/.env`;
  if (!existsSync(target)) {
    writeFileSync(target, readFileSync(`${folder}/.env.example`, 'utf8'), { mode: 0o600 });
    console.log(`Created ${target}`);
  }
}
let api = readFileSync('apps/api/.env', 'utf8');
if (!/^SEED_PASSWORD=.+$/m.test(api)) api = setVar(api, 'SEED_PASSWORD', 'FarmersMarket2026!');
if (!/^OTP_SECRET=.{32,}$/m.test(api))
  api = setVar(api, 'OTP_SECRET', randomBytes(32).toString('hex'));
if (!/^PAYOUT_ENCRYPTION_KEY=.{32,}$/m.test(api))
  api = setVar(api, 'PAYOUT_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
if (!/^ALLOW_DEMO_FUNDING=true$/m.test(api) && !/^PAYMENTS_ENABLED=true$/m.test(api))
  api = setVar(api, 'ALLOW_DEMO_FUNDING', 'true');
if (!/^DATABASE_URL=postgres/m.test(api) || /CHANGE_ME/.test(api)) {
  api = setVar(api, 'DATABASE_URL', url('farmers_market'));
  api = setVar(api, 'TEST_DATABASE_URL', url('farmers_market_test'));
}
writeFileSync('apps/api/.env', api, { mode: 0o600 });

// 3. Database: start Postgres, wait until healthy, migrate, seed.
run('docker', ['compose', 'up', '-d', '--wait']);
run('docker', [
  'compose',
  'exec',
  '-T',
  'postgres',
  'sh',
  '-c',
  "psql -U farmers_market -d postgres -tc \"SELECT 1 FROM pg_database WHERE datname='farmers_market_test'\" | grep -q 1 || psql -U farmers_market -d postgres -c 'CREATE DATABASE farmers_market_test'",
]);
run('npm', ['run', 'db:migrate']);
run('npm', ['run', 'db:seed']);
console.log('\nReady. Start everything with: npm run dev');
