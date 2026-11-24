import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config/index.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

/**
 * Text messages (one-time codes for phone-only accounts).
 *   SMS_MODE=termii  sends through Termii (TERMII_API_KEY, TERMII_SENDER_ID)
 *   SMS_MODE=file    writes each message to DATA_DIR/sms (development and tests)
 *   SMS_MODE=off     no text messages: phone-only accounts get the minimal check instead
 *                    (no code; money can't leave the account until the phone or BVN is verified)
 */
export function smsSender(c: Config) {
  const mode = c.smsMode;
  const available = mode === 'file' || (mode === 'termii' && !!c.termiiApiKey);
  return {
    available,
    async send(to: string, text: string) {
      if (!available)
        throw new AppError(503, 'SMS_UNAVAILABLE', 'Text messages are not available yet.');
      if (mode === 'file') {
        const folder = join(c.dataDir, 'sms');
        await mkdir(folder, { recursive: true, mode: 0o700 });
        await writeFile(
          join(folder, `${Date.now()}-${randomUUID()}.txt`),
          `To: ${to}\n\n${text}\n`,
          {
            mode: 0o600,
          },
        );
        return;
      }
      try {
        const r = await fetch('https://api.ng.termii.com/api/sms/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: c.termiiApiKey,
            to: to.replace(/^\+/, ''),
            from: c.termiiSenderId || 'Ahia',
            sms: text,
            type: 'plain',
            channel: 'dnd',
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
      } catch (e) {
        // Never log the message: it holds a one-time code.
        logger.warn('sms delivery failed', { error: (e as Error).message });
        throw new AppError(
          503,
          'SMS_DELIVERY_FAILED',
          'We could not send the text. Please try again.',
        );
      }
    },
  };
}

/** "0803 123 4567", "2348031234567" or "+234 803 123 4567" → "+2348031234567". */
export function normalPhone(raw: string) {
  const v = String(raw || '').replace(/[\s()-]/g, '');
  if (/^0\d{10}$/.test(v)) return `+234${v.slice(1)}`;
  if (/^234\d{10}$/.test(v)) return `+${v}`;
  return v;
}
