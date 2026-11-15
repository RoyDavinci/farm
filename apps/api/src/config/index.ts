import { productionProblems, readEnv } from './env.js';

const env = readEnv();
const production = env.NODE_ENV === 'production';
const problems = productionProblems(env);
if (problems.length)
  throw new Error(`Refusing to start in production:\n  ${problems.join('\n  ')}`);

const returnUrl =
  env.PAYMENT_CALLBACK_URL || env.PAYMENT_RETURN_URL || `${env.PUBLIC_API_URL}/v1/payments/return`;

/** Typed application configuration, built once from the validated environment. */
export const config = {
  env: env.NODE_ENV,
  production,
  port: env.PORT,
  host: env.HOST,
  trustProxy: env.TRUST_PROXY,
  runWorkers: env.RUN_WORKERS,
  redisUrl: env.REDIS_URL,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
  authRateLimit: env.AUTH_RATE_LIMIT,
  shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  databaseUrl: env.DATABASE_URL,
  dataDir: env.DATA_DIR,
  origins: [
    ...env.CORS_ORIGINS.split(','),
    ...[env.CORS_ALLOWED_HOSTS, env.CORS_ALLOWED_HOSTS_ADMIN, env.CORS_ALLOWED_HOSTS_WEB]
      .join(',')
      .split(',')
      .map((h) => (h.trim() ? `https://${h.trim()}` : '')),
  ]
    .map((o) => o.trim())
    .filter(Boolean),
  gitCommit: env.GIT_COMMIT,
  publicApiUrl: env.PUBLIC_API_URL,
  uploadDir: env.UPLOAD_DIR,
  // Payments
  payments: env.PAYMENTS_ENABLED,
  // Simulated money is never available in production, whatever the flag says.
  demo: !production && env.ALLOW_DEMO_FUNDING,
  paystack: env.PAYSTACK_SECRET_KEY,
  flutterwave: env.FLUTTERWAVE_SECRET_KEY,
  flutterwaveWebhook: env.FLUTTERWAVE_WEBHOOK_SECRET,
  flutterwaveWebhookMode: env.FLUTTERWAVE_WEBHOOK_MODE,
  fallbackProvider: env.PAYMENTS_FALLBACK_PROVIDER.toLowerCase(),
  returnUrl,
  flutterwaveReturnUrl: env.FLUTTERWAVE_CALLBACK_URL || returnUrl,
  payoutKey: env.PAYOUT_ENCRYPTION_KEY || (production ? '' : env.OTP_SECRET || 'development-only'),
  payoutProvider: env.PAYOUT_PROVIDER.toLowerCase(),
  // Email & codes
  otpSecret: env.OTP_SECRET || (production ? '' : 'development-only-change-in-production'),
  mailMode: env.MAIL_MODE || (production ? 'smtp' : 'file'),
  mailFrom: env.MAIL_FROM,
  smtpHost: env.SMTP_HOST,
  smtpPort: env.SMTP_PORT,
  smtpSecure: env.SMTP_SECURE,
  smtpUser: env.SMTP_USER,
  smtpPassword: env.SMTP_PASSWORD,
  // Maps, storage, push
  mapboxToken: env.MAPBOX_PUBLIC_TOKEN || env.MAPBOX_SERVER_TOKEN,
  permanentGeocoding: env.MAPBOX_PERMANENT_GEOCODING,
  storageProvider: env.STORAGE_PROVIDER || 'local',
  recordsStorageProvider: env.RECORDS_STORAGE_PROVIDER || env.STORAGE_PROVIDER || 'local',
  s3Bucket: env.S3_BUCKET,
  recordsBucket: env.RECORDS_S3_BUCKET || env.S3_BUCKET,
  s3Region: env.AWS_REGION,
  s3Prefix: env.S3_PREFIX,
  s3Endpoint: env.S3_ENDPOINT,
  pushEnabled: env.PUSH_ENABLED,
  expoPushToken: env.EXPO_ACCESS_TOKEN,
};
export type Config = typeof config;
