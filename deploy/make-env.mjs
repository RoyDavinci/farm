// Creates deploy/.env.test once: secrets for the test server (git-ignored, never committed).
// Reads SMTP and payment test keys from apps/api/.env; generates database and app secrets.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.env.test');
if (existsSync(out)) {
  console.log('deploy/.env.test already exists; delete it to regenerate (this rotates secrets).');
  process.exit(0);
}
const local = Object.fromEntries(
  readFileSync(join(here, '../apps/api/.env'), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
const ip = readFileSync(join(here, 'aws-test.env'), 'utf8')
  .match(/PUBLIC_IP=(.+)/)[1]
  .trim();
const host = `${ip.replaceAll('.', '-')}.sslip.io`;
const secret = () => randomBytes(32).toString('hex');
const pg = randomBytes(18).toString('hex');
const env = {
  // Compose (server-side .env)
  HOST_SUFFIX: host,
  POSTGRES_PASSWORD: pg,
  // API and worker
  NODE_ENV: 'production',
  PILOT_MODE: 'true',
  DATABASE_URL: `postgresql://zuru:${pg}@postgres:5432/zuru`,
  REDIS_URL: 'redis://redis:6379',
  PUBLIC_API_URL: `https://api.${host}`,
  PUBLIC_WEB_URL: `https://app.${host}`,
  CORS_ORIGINS: `https://admin.${host},https://app.${host}`,
  TRUST_PROXY: '1',
  OTP_SECRET: secret(),
  PAYOUT_ENCRYPTION_KEY: secret(),
  MAIL_MODE: 'smtp',
  MAIL_FROM: local.MAIL_FROM || '',
  SMTP_HOST: local.SMTP_HOST || '',
  SMTP_PORT: local.SMTP_PORT || '465',
  SMTP_SECURE: local.SMTP_SECURE || 'true',
  SMTP_USER: local.SMTP_USER || '',
  SMTP_PASSWORD: local.SMTP_PASSWORD || '',
  PAYMENTS_ENABLED: 'true',
  ALLOW_DEMO_FUNDING: 'false',
  PAYSTACK_SECRET_KEY: local.PAYSTACK_SECRET_KEY || '',
  FLUTTERWAVE_SECRET_KEY: local.FLUTTERWAVE_SECRET_KEY || '',
  FLUTTERWAVE_WEBHOOK_SECRET: local.FLUTTERWAVE_WEBHOOK_SECRET || '',
  FLUTTERWAVE_WEBHOOK_MODE: 'legacy',
  PAYMENTS_FALLBACK_PROVIDER: 'flutterwave',
  PAYOUT_PROVIDER: 'paystack',
  STORAGE_PROVIDER: 'local',
  RECORDS_STORAGE_PROVIDER: 'local',
  MAPBOX_PUBLIC_TOKEN: local.MAPBOX_PUBLIC_TOKEN || '',
  LOG_LEVEL: 'http',
  // Voice calls through the coturn relay on this server (deploy/turnserver.conf.template).
  FEATURE_VOICE: 'true',
  VOICE_CALLS_ENABLED: 'true',
  VOICE_TURN_URL: `turn:${ip}:3478?transport=udp,turn:${ip}:3478?transport=tcp`,
  VOICE_TURN_SECRET: secret(),
};
for (const k of ['SMTP_HOST', 'MAIL_FROM', 'PAYSTACK_SECRET_KEY'])
  if (!env[k]) console.warn(`warning: ${k} is empty in apps/api/.env`);
writeFileSync(
  out,
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
  { mode: 0o600 },
);
console.log(`deploy/.env.test written for ${host}`);
