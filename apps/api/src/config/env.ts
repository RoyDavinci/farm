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
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: str('0.0.0.0'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  RUN_WORKERS: bool(true),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(25),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  DATABASE_URL: str(),
  DATA_DIR: str('.data/farmers-market'),
  CORS_ORIGINS: str('http://localhost:5173,http://localhost:8081,http://localhost:8095'),
  PUBLIC_API_URL: str('http://localhost:4000'),
  UPLOAD_DIR: str('.data/uploads'),
  // Payments
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
  S3_PREFIX: str('farmers-market'),
  PUSH_ENABLED: bool(true),
  EXPO_ACCESS_TOKEN: str(),
});
export type Env = z.infer<typeof envSchema>;

/** Parses process.env, printing every problem at once instead of failing on the first. */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return parsed.data;
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
  if (env.CORS_ORIGINS.split(',').some((o) => !o.trim().startsWith('https://')))
    problems.push('CORS_ORIGINS must list only https:// web origins.');
  return problems;
}
