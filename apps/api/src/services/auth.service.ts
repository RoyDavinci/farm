import bcrypt from 'bcryptjs';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { mailer } from '../lib/mail.js';
import type { AppDeps } from '../types/deps.js';
export const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  admin: boolean;
  staff_role: import('./staff.service.js').StaffRole | null;
  email_verified_at: Date | null;
}
type UserIdentity = Pick<
  import('../generated/prisma/client.js').User,
  'id' | 'name' | 'email' | 'phone' | 'admin' | 'staff_role' | 'email_verified_at'
>;
export const publicUser = (u: UserIdentity): AuthenticatedUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  admin: u.admin,
  staff_role: u.admin ? (u.staff_role as AuthenticatedUser['staff_role']) : null,
  email_verified_at: u.email_verified_at,
});
export const email = z.string().trim().toLowerCase().pipe(z.email());
export const password = z.string().min(10).max(100);
export const profile = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Use international phone format, e.g. +2348012345678'),
});

/** Business logic for auth requests. HTTP-free: callers pass plain input. */
export function createAuthService(deps: AppDeps) {
  const { db, config: c } = deps;
  const mail = mailer(c);
  const digest = (id: string, code: string) =>
    createHmac('sha256', c.otpSecret).update(`${id}:${code}`).digest('hex');
  const codeMessage = (purpose: string, code: string) =>
    `Your Farmers Market ${purpose === 'reset' ? 'password reset' : purpose === 'register' ? 'email verification' : 'sign-in'} code is ${code}.\n\nIt expires in 10 minutes and can only be used once. Do not share it. If you did not request this, ignore this email.\n\nFarmers Market`;
  async function challenge(to: string, purpose: string, uid: string | null, payload: object = {}) {
    const cid = randomUUID(),
      code = String(randomInt(100000, 1000000));
    await db.transaction(async (q) => {
      // A transaction-scoped lock serializes requests for an address across API instances.
      await q.query('SELECT 1 FROM pg_advisory_xact_lock(hashtext($1))', [to]);
      const [recent] = await q.query(
        "SELECT COUNT(*)::int AS n,MAX(sent_at) AS last FROM otp_challenges WHERE email=$1 AND created_at>now()-interval '1 hour'",
        [to],
      );
      ensure(
        recent.n < 8,
        429,
        'OTP_RATE_LIMIT',
        'Too many codes requested. Please try again later.',
      );
      ensure(
        !recent.last || Date.now() - new Date(recent.last).getTime() >= 60000,
        429,
        'OTP_COOLDOWN',
        'Please wait one minute before requesting another code.',
      );
      await q.query(
        'UPDATE otp_challenges SET consumed_at=now() WHERE email=$1 AND purpose=$2 AND consumed_at IS NULL',
        [to, purpose],
      );
      await q.query(
        'INSERT INTO otp_challenges(id,email,purpose,user_id,payload,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          cid,
          to,
          purpose,
          uid,
          JSON.stringify(payload),
          digest(cid, code),
          new Date(Date.now() + 10 * 60000),
        ],
      );
      // No challenge is committed if delivery fails.
      await mail.send(to, 'Your Farmers Market verification code', codeMessage(purpose, code));
    });
    return {
      challenge_id: cid,
      email: to,
      expires_in: 600,
      resend_after: 60,
      delivery: c.mailMode === 'smtp' ? 'email' : 'development_file',
    };
  }
  async function session(q: Query, uid: string, device: string) {
    const token = randomBytes(32).toString('hex'),
      refresh = randomBytes(40).toString('hex');
    await q.query(
      'INSERT INTO sessions(token_hash,user_id,expires_at,id,refresh_hash,refresh_expires_at,device_label) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        tokenHash(token),
        uid,
        new Date(Date.now() + 30 * 60000),
        randomUUID(),
        tokenHash(refresh),
        new Date(Date.now() + 30 * 86400000),
        device.slice(0, 160),
      ],
    );
    return { token, refresh_token: refresh, expires_in: 1800 };
  }
  async function resendCode(user: any, input: RequestInput) {
    const { challenge_id } = z.object({ challenge_id: z.uuid() }).parse(input.body);
    const result = await db.transaction(async (q) => {
      const [otp] = await q.query('SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE', [
        challenge_id,
      ]);
      ensure(
        otp &&
          !otp.consumed_at &&
          new Date(otp.expires_at).getTime() > Date.now() &&
          otp.attempts < 5,
        400,
        'OTP_EXPIRED',
        'This code request has expired. Please start again.',
      );
      ensure(
        Date.now() - new Date(otp.sent_at).getTime() >= 60000,
        429,
        'OTP_COOLDOWN',
        'Please wait one minute before requesting another code.',
      );
      ensure(
        otp.send_count < 3,
        429,
        'OTP_RATE_LIMIT',
        'Please start again after this code expires.',
      );
      const code = String(randomInt(100000, 1000000));
      await q.query(
        'UPDATE otp_challenges SET code_hash=$1,sent_at=now(),send_count=send_count+1 WHERE id=$2',
        [digest(otp.id, code), otp.id],
      );
      await mail.send(
        otp.email,
        'Your Farmers Market verification code',
        codeMessage(otp.purpose, code),
      );
      return { ok: true, resend_after: 60 };
    });
    return result;
  }
  /** Starts registration: validates details and emails a verification code (no account yet). */
  async function register(input: RequestInput) {
    const d = profile.extend({ email, password }).parse(input.body);
    const [existing] = await db.query('SELECT id FROM users WHERE email=$1 OR phone=$2', [
      d.email,
      d.phone,
    ]);
    ensure(!existing, 409, 'ACCOUNT_EXISTS', 'An account with this email or phone already exists.');
    const password_hash = await bcrypt.hash(d.password, 12);
    return await challenge(d.email, 'register', null, {
      name: d.name,
      phone: d.phone,
      password_hash,
    });
  }
  /** Checks the password and emails a sign-in code. */
  async function login(input: RequestInput) {
    const d = z.object({ email, password }).parse(input.body);
    const [u] = await db.query('SELECT * FROM users WHERE email=$1', [d.email]);
    // Always perform a password check to avoid a fast account-existence probe.
    const valid = await bcrypt.compare(
      d.password,
      u?.password_hash || '$2b$12$EHmYpW4vYwX4zEvSSVDH.eRVHWH8nE4uNOBk0XjMS0Z1c1xbiL5aK',
    );
    ensure(
      u && valid && u.status === 'ACTIVE',
      401,
      'INVALID_CREDENTIALS',
      'Email or password is incorrect, or the account is unavailable.',
    );
    return await challenge(u.email, 'login', u.id);
  }
  /** Emails a password-reset code (also for unknown addresses, to avoid account probing). */
  async function forgotPassword(input: RequestInput) {
    const d = z.object({ email }).parse(input.body);
    const [u] = await db.query("SELECT * FROM users WHERE email=$1 AND status='ACTIVE'", [d.email]);
    // Unknown addresses get a challenge with no user. Verification can never reset an account.
    return await challenge(d.email, 'reset', u?.id || null);
  }
  /** Completes registration, sign-in or password reset with an emailed code. */
  async function verifyCode(input: RequestInput) {
    const d = z
      .object({
        challenge_id: z.uuid(),
        code: z.string().regex(/^\d{6}$/),
        new_password: password.optional(),
      })
      .parse(input.body);
    const result = await db.transaction(async (q) => {
      const [otp] = await q.query('SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE', [
        d.challenge_id,
      ]);
      ensure(
        otp &&
          !otp.consumed_at &&
          new Date(otp.expires_at).getTime() > Date.now() &&
          otp.attempts < 5,
        400,
        'OTP_EXPIRED',
        'Your code has expired or was already used. Please start again.',
      );
      const supplied = Buffer.from(digest(otp.id, d.code)),
        expected = Buffer.from(otp.code_hash);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        await q.query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1', [otp.id]);
        return {
          error: {
            status: 400,
            code: 'INVALID_OTP',
            message:
              otp.attempts >= 4
                ? 'Too many incorrect codes. Please start again.'
                : 'That code is incorrect. Please check your email.',
          },
        };
      }
      if (otp.purpose === 'reset') {
        ensure(d.new_password, 400, 'PASSWORD_REQUIRED', 'Enter your new password.');
        if (otp.user_id) {
          await q.query(
            'UPDATE users SET password_hash=$1,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$2',
            [await bcrypt.hash(d.new_password, 12), otp.user_id],
          );
          await q.query('DELETE FROM sessions WHERE user_id=$1', [otp.user_id]);
        }
        await q.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [otp.id]);
        return { ok: true, password_reset: true };
      }
      let u: any;
      if (otp.purpose === 'register') {
        [u] = await q.query(
          'INSERT INTO users(id,name,email,phone,password_hash,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING *',
          [randomUUID(), otp.payload.name, otp.email, otp.payload.phone, otp.payload.password_hash],
        );
      } else {
        [u] = await q.query(
          "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1 AND status='ACTIVE' RETURNING *",
          [otp.user_id],
        );
      }
      ensure(u, 401, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable.');
      await q.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [otp.id]);
      return {
        user: publicUser(u),
        ...(await session(q, u.id, input.header('User-Agent') || 'Unknown device')),
      };
    });
    return result;
  }
  /** Rotates the refresh token; reuse of a consumed token revokes the session. */
  async function refreshSession(input: RequestInput) {
    const { refresh_token } = z
      .object({ refresh_token: z.string().min(40).max(100) })
      .parse(input.body);
    const h = tokenHash(refresh_token);
    const result = await db.transaction(async (q) => {
      const [s] = await q.query(
        "SELECT s.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.refresh_hash=$1 AND s.refresh_expires_at>now() AND u.status='ACTIVE' FOR UPDATE OF s",
        [h],
      );
      if (!s) {
        const [reused] = await q.query(
          'SELECT session_id FROM consumed_refresh_tokens WHERE token_hash=$1',
          [h],
        );
        if (reused) await q.query('DELETE FROM sessions WHERE id=$1', [reused.session_id]);
        return {
          error: { status: 401, code: 'SESSION_EXPIRED', message: 'Please sign in again.' },
        };
      }
      const token = randomBytes(32).toString('hex'),
        refresh = randomBytes(40).toString('hex');
      await q.query(
        'INSERT INTO consumed_refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)',
        [h, s.id, s.refresh_expires_at],
      );
      await q.query(
        'UPDATE sessions SET token_hash=$1,refresh_hash=$2,expires_at=$3,last_seen_at=now() WHERE id=$4',
        [tokenHash(token), tokenHash(refresh), new Date(Date.now() + 30 * 60000), s.id],
      );
      return { token, refresh_token: refresh, expires_in: 1800 };
    });
    return result;
  }
  return { resendCode, register, login, forgotPassword, verifyCode, refreshSession };
}
