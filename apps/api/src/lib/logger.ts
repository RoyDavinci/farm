import winston from 'winston';
const SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'password_hash',
  'token',
  'refresh_token',
  'account_number',
  'code',
  'pin',
  'otp',
  'secret',
]);

/** Replaces secrets and one-time codes anywhere in a log entry. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : scrub(v, depth + 1),
    ]),
  );
}
const redact = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (SECRET_KEYS.has(key.toLowerCase())) info[key] = '[redacted]';
    else if (key !== 'level' && key !== 'message') info[key] = scrub(info[key]);
  }
  return info;
});

const production = process.env.NODE_ENV === 'production';

/**
 * Application logger. Production writes one JSON object per line to stdout for a log shipper
 * (Datadog, Grafana Loki, CloudWatch…); development prints readable coloured lines.
 * LOG_LEVEL controls verbosity (error, warn, info, http, debug).
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info'),
  defaultMeta: { service: process.env.SERVICE_NAME || 'ahia-api' },
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    redact(),
    winston.format.timestamp(),
    production
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, service: _s, ...meta }) => {
            const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level} ${message}${extra}`;
          }),
        ),
  ),
  transports: [new winston.transports.Console()],
  exitOnError: false,
});
