import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
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
  return { resendCode };
}
