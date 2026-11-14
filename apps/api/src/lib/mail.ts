import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import type { Config } from '../config/index.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';
export function mailer(c: Config) {
  const smtp = c.mailMode === 'smtp';
  const transport = nodemailer.createTransport(
    smtp
      ? {
          host: c.smtpHost,
          port: c.smtpPort,
          secure: c.smtpSecure,
          requireTLS: !c.smtpSecure,
          auth: c.smtpUser ? { user: c.smtpUser, pass: c.smtpPassword } : undefined,
          connectionTimeout: 10000,
          socketTimeout: 15000,
        }
      : { streamTransport: true, buffer: true, newline: 'unix' },
  );
  return {
    async send(to: string, subject: string, text: string) {
      if (smtp && (!c.smtpHost || !c.mailFrom))
        throw new AppError(
          503,
          'EMAIL_NOT_CONFIGURED',
          'Email delivery is not configured. Please contact support.',
        );
      if (!smtp && c.production)
        throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Production requires SMTP email delivery.');
      try {
        const result = await transport.sendMail({
          from: c.mailFrom || 'Farmers Market <no-reply@farmers.market>',
          to,
          subject,
          text,
        });
        if (!smtp) {
          const folder = join(c.dataDir, 'mail');
          await mkdir(folder, { recursive: true, mode: 0o700 });
          await writeFile(join(folder, `${Date.now()}-${randomUUID()}.eml`), result.message, {
            mode: 0o600,
          });
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        // Never log transport credentials, complete email contents, or OTPs.
        logger.warn('email delivery failed', {
          errorCode: (e as { code?: string }).code || 'MAIL_ERROR',
        });
        throw new AppError(
          503,
          'EMAIL_DELIVERY_FAILED',
          'We could not send your email. Please try again shortly.',
        );
      }
    },
  };
}
