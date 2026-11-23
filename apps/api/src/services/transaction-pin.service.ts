import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { lockMoney, securityAlert } from './risk.service.js';

/** A 4-digit transaction PIN. Obvious PINs (1234, 0000…) are refused. */
export const transactionPin = z
  .string()
  .regex(/^\d{4}$/, 'Your transaction PIN is 4 digits.')
  .refine(
    (p) =>
      !/^(\d)\1{3}$/.test(p) &&
      !['0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876', '4321'].includes(p),
    'Choose a PIN that is harder to guess.',
  );
export const hashPin = (pin: string) => bcrypt.hash(pin, 10);

const MAX_FAILURES = 5;
const LOCK_MINUTES = 30;

/**
 * Checks the user's transaction PIN before money leaves their account (withdrawals, bank changes).
 * A wrong PIN returns `{ error }` rather than throwing, so the caller's transaction commits the
 * attempt counter (return it from the handler); five wrong PINs lock money movement for 30 minutes.
 */
export async function checkTransactionPin(q: Query, userId: string, pin: unknown) {
  const [u] = await q.query(
    'SELECT transaction_pin_hash,transaction_pin_failures,transaction_pin_locked_until FROM users WHERE id=$1',
    [userId],
  );
  ensure(
    u?.transaction_pin_hash,
    409,
    'TRANSACTION_PIN_REQUIRED',
    'Set a transaction PIN in Wallet before withdrawing or changing bank details.',
  );
  ensure(
    !u.transaction_pin_locked_until || new Date(u.transaction_pin_locked_until) <= new Date(),
    429,
    'TRANSACTION_PIN_LOCKED',
    `Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes, or reset your PIN with your password.`,
  );
  const given = typeof pin === 'string' ? pin : '';
  ensure(
    /^\d{4}$/.test(given),
    400,
    'TRANSACTION_PIN_MISSING',
    'Enter your 4-digit transaction PIN.',
  );
  if (await bcrypt.compare(given, u.transaction_pin_hash)) {
    if (u.transaction_pin_failures)
      await q.query('UPDATE users SET transaction_pin_failures=0 WHERE id=$1', [userId]);
    return null;
  }
  const failures = u.transaction_pin_failures + 1;
  const locked = failures >= MAX_FAILURES;
  await q.query(
    'UPDATE users SET transaction_pin_failures=$1,transaction_pin_locked_until=$2 WHERE id=$3',
    [locked ? 0 : failures, locked ? new Date(Date.now() + LOCK_MINUTES * 60000) : null, userId],
  );
  await audit(q, userId, 'transaction_pin.failed', userId, { failures });
  const left = MAX_FAILURES - failures;
  return {
    error: locked
      ? {
          status: 429,
          code: 'TRANSACTION_PIN_LOCKED',
          message: `Too many wrong PINs. Withdrawals are locked for ${LOCK_MINUTES} minutes.`,
        }
      : {
          status: 400,
          code: 'INVALID_TRANSACTION_PIN',
          message: `That PIN is incorrect. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
        },
  };
}

/** Setting and changing the transaction PIN. */
export function createTransactionPinService(deps: AppDeps) {
  const { db } = deps;
  async function getTransactionPin(user: any, _input: RequestInput) {
    const [u] = await db.query(
      'SELECT transaction_pin_hash IS NOT NULL AS set,transaction_pin_locked_until AS locked_until FROM users WHERE id=$1',
      [user.id],
    );
    const locked = u.locked_until && new Date(u.locked_until) > new Date();
    return { set: u.set, locked_until: locked ? u.locked_until : null };
  }
  /**
   * Sets the PIN. The first PIN, and a forgotten one, needs the account password; a change can use
   * the current PIN instead.
   */
  async function setTransactionPin(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({
        pin: transactionPin,
        password: z.string().max(100).optional(),
        current_pin: z.string().max(4).optional(),
      })
      .parse(input.body);
    const [u] = await q.query('SELECT password_hash,transaction_pin_hash FROM users WHERE id=$1', [
      user.id,
    ]);
    if (d.password) {
      ensure(
        await bcrypt.compare(d.password, u.password_hash),
        400,
        'INVALID_PASSWORD',
        'That password is incorrect.',
      );
    } else {
      ensure(
        u.transaction_pin_hash && d.current_pin,
        400,
        'PASSWORD_REQUIRED',
        'Enter your account password to set your transaction PIN.',
      );
      const wrong = await checkTransactionPin(q, user.id, d.current_pin);
      if (wrong) return wrong;
    }
    await q.query(
      'UPDATE users SET transaction_pin_hash=$1,transaction_pin_failures=0,transaction_pin_locked_until=NULL WHERE id=$2',
      [await hashPin(d.pin), user.id],
    );
    await audit(
      q,
      user.id,
      u.transaction_pin_hash ? 'transaction_pin.change' : 'transaction_pin.set',
      user.id,
    );
    // Resetting a PIN with the password is what someone with a stolen password would do.
    if (u.transaction_pin_hash && d.password)
      await lockMoney(q, user.id, 24, 'transaction PIN reset');
    else if (u.transaction_pin_hash)
      await securityAlert(
        q,
        user.id,
        'Transaction PIN changed',
        'Your transaction PIN was changed. If this wasn’t you, contact support now.',
      );
    return { set: true, locked_until: null };
  }
  return { getTransactionPin, setTransactionPin };
}
