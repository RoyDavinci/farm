import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));
const str = (fallback = '') =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v));

/** Every environment variable the API reads, with types and defaults. */
export const envSchema = z.object({
  VOICE_CALLS_ENABLED: bool(false),
  VOICE_STUN_URL: str(),
  VOICE_TURN_URL: str(),
  VOICE_TURN_SECRET: str(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: str('0.0.0.0'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  RUN_WORKERS: bool(true),
  // Shared rate limits and realtime events across instances. Optional for a single instance.
  REDIS_URL: str(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(25),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  DATABASE_URL: str(),
  DATA_DIR: str('.data/ahia'),
  // Local defaults; in production list only https:// origins (or use CORS_ALLOWED_HOSTS).
  CORS_ORIGINS: z.string().optional(),
  /** Hostnames (no scheme) allowed as https:// origins; Render injects the static sites' hosts. */
  CORS_ALLOWED_HOSTS: str(),
  CORS_ALLOWED_HOSTS_ADMIN: str(),
  CORS_ALLOWED_HOSTS_WEB: str(),
  // Render sets RENDER_EXTERNAL_URL for web services.
  PUBLIC_API_URL: z.string().optional(),
  /** Public web app address, used for “Open Ahia” buttons in emails (optional). */
  PUBLIC_WEB_URL: str(),
  RENDER_EXTERNAL_URL: str(),
  /** Deployed commit, reported by /health (Render sets RENDER_GIT_COMMIT). */
  GIT_COMMIT: str(),
  RENDER_GIT_COMMIT: str(),
  UPLOAD_DIR: str('.data/uploads'),
  // Payments
  // Launch preset: core marketplace, booking and delivery only. FEATURE_<NAME> overrides one switch
  // (names in config/features.ts).
  PILOT_MODE: bool(false),
  PAYMENTS_ENABLED: bool(false),
  ALLOW_DEMO_FUNDING: bool(false),
  PAYSTACK_SECRET_KEY: str(),
  FLUTTERWAVE_SECRET_KEY: str(),
  FLUTTERWAVE_WEBHOOK_SECRET: str(),
  FLUTTERWAVE_WEBHOOK_MODE: z.enum(['hmac', 'legacy']).default('hmac'),
  PAYMENTS_FALLBACK_PROVIDER: str(),
  PAYMENT_CALLBACK_URL: str(),
  PAYMENT_RETURN_URL: str(),
  FLUTTERWAVE_CALLBACK_URL: str(),
  PAYOUT_ENCRYPTION_KEY: str(),
  PAYOUT_PROVIDER: str(),
  // Email & one-time codes
  OTP_SECRET: str(),
  MAIL_MODE: z.enum(['smtp', 'file', '']).optional(),
  MAIL_FROM: str(),
  SMTP_HOST: str(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: str(),
  SMTP_PASSWORD: str(),
  // Maps, storage, push
  MAPBOX_PUBLIC_TOKEN: str(),
  MAPBOX_SERVER_TOKEN: str(),
  MAPBOX_PERMANENT_GEOCODING: bool(false),
  STORAGE_PROVIDER: z.enum(['local', 's3', '']).optional(),
  RECORDS_STORAGE_PROVIDER: z.enum(['local', 's3', '']).optional(),
  S3_BUCKET: str(),
  RECORDS_S3_BUCKET: str(),
  AWS_REGION: str('us-east-1'),
  S3_PREFIX: str('ahia'),
  /** S3-compatible endpoint, e.g. Cloudflare R2: https://<account>.r2.cloudflarestorage.com */
  S3_ENDPOINT: str(),
  PUSH_ENABLED: bool(true),
  EXPO_ACCESS_TOKEN: str(),
});
type ParsedEnv = z.infer<typeof envSchema>;
/** Parsed environment with defaults that depend on other values filled in. */
export type Env = Omit<ParsedEnv, 'CORS_ORIGINS' | 'PUBLIC_API_URL'> & {
  CORS_ORIGINS: string;
  PUBLIC_API_URL: string;
};
const LOCAL_ORIGINS = 'http://localhost:5173,http://localhost:8081,http://localhost:8095';

/** Parses process.env, printing every problem at once instead of failing on the first. */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const env = parsed.data;
  return {
    ...env,
    // Local browser origins only outside production; production lists its https origins.
    CORS_ORIGINS: env.CORS_ORIGINS ?? (env.NODE_ENV === 'production' ? '' : LOCAL_ORIGINS),
    // Render provides the service URL and deployed commit.
    PUBLIC_API_URL: env.PUBLIC_API_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:4000',
    GIT_COMMIT: env.GIT_COMMIT || env.RENDER_GIT_COMMIT,
  };
}

/** Settings that must be real in production. Returns human-readable problems. */
export function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL must point to managed PostgreSQL.');
  if (env.OTP_SECRET.length < 32)
    problems.push('OTP_SECRET must be at least 32 random characters.');
  if (env.PAYOUT_ENCRYPTION_KEY.length < 32)
    problems.push('PAYOUT_ENCRYPTION_KEY must be at least 32 random characters.');
  if ((env.MAIL_MODE || 'smtp') !== 'smtp' || !env.SMTP_HOST || !env.MAIL_FROM)
    problems.push('SMTP_HOST and MAIL_FROM are required; production always sends real email.');
  if (!env.PUBLIC_API_URL.startsWith('https://'))
    problems.push('PUBLIC_API_URL must be the public https:// address of the API.');
  if (
    env.CORS_ORIGINS.split(',')
      .filter((o) => o.trim())
      .some((o) => !o.trim().startsWith('https://'))
  )
    problems.push('CORS_ORIGINS must list only https:// web origins.');
  return problems;
}
