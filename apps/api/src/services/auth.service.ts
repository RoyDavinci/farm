import bcrypt from 'bcryptjs';
import { hashPin, transactionPin } from './transaction-pin.service.js';
import { lockMoney } from './risk.service.js';
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
import { logger } from '../lib/logger.js';
import { audit } from './audit.service.js';
import type { RequestInput } from '../lib/http.js';
import { mailer } from '../lib/mail.js';
import { normalPhone, smsSender } from '../lib/sms.js';
import { hashSecret } from './transaction-pin.service.js';
import { codeEmail, noAccountEmail, type Email } from '../lib/email-templates.js';
import type { AppDeps } from '../types/deps.js';
export const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface AuthenticatedUser {
  id: string;
  name: string;
  /** Null for accounts opened with a phone number only. */
  email: string | null;
  phone: string;
  admin: boolean;
  staff_role: import('./staff.service.js').StaffRole | null;
  email_verified_at: Date | null;
  /** Short public ID for transfers and referrals. */
  ahia_id: string;
}
type UserIdentity = Pick<
  import('../generated/prisma/client.js').User,
  'id' | 'name' | 'email' | 'phone' | 'admin' | 'staff_role' | 'email_verified_at' | 'ahia_id'
>;
export const publicUser = (u: UserIdentity): AuthenticatedUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  admin: u.admin,
  staff_role: u.admin ? (u.staff_role as AuthenticatedUser['staff_role']) : null,
  email_verified_at: u.email_verified_at,
  ahia_id: u.ahia_id,
});
export const email = z.string().trim().toLowerCase().pipe(z.email());
export const password = z.string().min(10).max(100);
export const profile = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .transform(normalPhone)
    .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a phone number like 08031234567.')),
});

/** Business logic for auth requests. HTTP-free: callers pass plain input. */
export function createAuthService(deps: AppDeps) {
  const { db, config: c } = deps;
  const mail = mailer(c);
  const sms = smsSender(c);
  const smsCode = (purpose: string, code: string) =>
    `${code} is your Ahia ${purpose === 'register' ? 'sign-up' : purpose === 'reset' ? 'password reset' : 'sign-in'} code. It expires in 10 minutes. Never share it with anyone, not even Ahia staff.`;
  const deliver = (channel: string, to: string, purpose: string, code: string) =>
    channel === 'sms'
      ? sms.send(to, smsCode(purpose, code))
      : mail.send(to, codeEmail(purpose, code));
  const digest = (id: string, code: string) =>
    createHmac('sha256', c.otpSecret).update(`${id}:${code}`).digest('hex');
  async function challenge(
    to: string,
    purpose: string,
    uid: string | null,
    payload: object = {},
    email?: Email,
    channel: 'email' | 'sms' = 'email',
  ) {
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
        'INSERT INTO otp_challenges(id,email,purpose,user_id,payload,code_hash,expires_at,channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          cid,
          to,
          purpose,
          uid,
          JSON.stringify(payload),
          digest(cid, code),
          new Date(Date.now() + 10 * 60000),
          channel,
        ],
      );
      // No challenge is committed if delivery fails.
      if (email) await mail.send(to, email);
      else await deliver(channel, to, purpose, code);
    });
    return {
      challenge_id: cid,
      // Where the code went: an email address, or a phone number for a text.
      email: to,
      channel,
      expires_in: 600,
      resend_after: 60,
      delivery:
        channel === 'sms'
          ? c.smsMode === 'termii'
            ? 'sms'
            : 'development_file'
          : c.mailMode === 'smtp'
            ? 'email'
            : 'development_file',
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
  const TRUST_DAYS = 90;
  /** Remembers this device so signing in again from it skips the emailed code. */
  async function trustDevice(q: Query, uid: string, label: string) {
    const deviceToken = randomBytes(32).toString('hex');
    await q.query(
      'INSERT INTO trusted_devices(id,user_id,token_hash,label,expires_at) VALUES($1,$2,$3,$4,$5)',
      [
        randomUUID(),
        uid,
        tokenHash(deviceToken),
        label.slice(0, 160),
        new Date(Date.now() + TRUST_DAYS * 86400000),
      ],
    );
    return deviceToken;
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
      await deliver(otp.channel, otp.email, otp.purpose, code);
      return { ok: true, resend_after: 60 };
    });
    return result;
  }
  /** Starts registration: validates details and emails a verification code (no account yet). */
  async function register(input: RequestInput) {
    const d = profile
      .extend({
        /** Optional: people without email sign up with their phone number alone. */
        email: z.preprocess((v) => (v === '' || v == null ? undefined : v), email.optional()),
        password,
        transaction_pin: transactionPin.optional(),
        /** The inviter's Ahia ID, from a referral link (?ref=…) or typed in. */
        referral_code: z
          .string()
          .trim()
          .max(14)
          .transform((v) => {
            const d = v.toUpperCase().replace(/[^0-9A-Z]/g, '');
            return /^AH\d{8}$/.test(d) ? `AH-${d.slice(2)}` : v.toUpperCase();
          })
          .optional(),
      })
      .parse(input.body);
    let referredBy: string | null = null;
    if (d.referral_code) {
      const [r] = await db.query("SELECT id FROM users WHERE ahia_id=$1 AND status='ACTIVE'", [
        d.referral_code,
      ]);
      ensure(
        r,
        400,
        'REFERRAL_INVALID',
        'This invite code isn’t valid. Check it, or leave it empty.',
      );
      referredBy = r.id;
    }
    const [existing] = await db.query('SELECT id FROM users WHERE email=$1 OR phone=$2', [
      d.email ?? null,
      d.phone,
    ]);
    ensure(
      !existing,
      409,
      'ACCOUNT_EXISTS',
      d.email
        ? 'An account with this email or phone already exists.'
        : 'An account with this phone number already exists. Sign in instead.',
    );
    const password_hash = await bcrypt.hash(d.password, 12);
    const payload = {
      name: d.name,
      phone: d.phone,
      password_hash,
      transaction_pin_hash: d.transaction_pin ? await hashPin(d.transaction_pin) : null,
      referred_by: referredBy,
    };
    if (d.email) return await challenge(d.email, 'register', null, payload);
    if (sms.available) return await challenge(d.phone, 'register', null, payload, undefined, 'sms');
    // No text messages yet: the minimal check. The account opens now; money can't leave it until
    // the phone (by text, once available) or BVN is verified.
    return await db.transaction(async (q) => {
      const [u] = await q.query(
        'INSERT INTO users(id,name,email,phone,password_hash,transaction_pin_hash,referred_by) VALUES($1,$2,NULL,$3,$4,$5,$6) RETURNING *',
        [
          randomUUID(),
          payload.name,
          payload.phone,
          payload.password_hash,
          payload.transaction_pin_hash,
          payload.referred_by,
        ],
      );
      await audit(q, u.id, 'auth.register_phone_minimal', u.id);
      const device = input.header('User-Agent') || 'Unknown device';
      return {
        user: publicUser(u as UserIdentity),
        ...(await session(q, u.id, device)),
        device_token: await trustDevice(q, u.id, device),
        verification: 'minimal' as const,
      };
    });
  }
  /**
   * Checks the password, then emails a sign-in code, unless the request comes from a device that
   * already completed a code for this account (it sends its device token): then it signs in.
   */
  async function login(input: RequestInput) {
    const d = z
      .object({
        /** An email address or a phone number ("login"; "email" still works). */
        login: z.string().trim().max(200).optional(),
        email: z.string().trim().max(200).optional(),
        phone: z.string().trim().max(30).optional(),
        password: z.string().max(100),
        device_token: z.string().min(40).max(100).optional(),
      })
      .parse(input.body);
    const id = d.login || d.email || d.phone || '';
    const byEmail = id.includes('@');
    const [u] = await db.query(`SELECT * FROM users WHERE ${byEmail ? 'email' : 'phone'}=$1`, [
      byEmail ? id.toLowerCase() : normalPhone(id),
    ]);
    // Always perform a password check to avoid a fast account-existence probe.
    const valid = await bcrypt.compare(
      d.password,
      u?.password_hash || '$2b$12$EHmYpW4vYwX4zEvSSVDH.eRVHWH8nE4uNOBk0XjMS0Z1c1xbiL5aK',
    );
    ensure(
      u && valid && u.status === 'ACTIVE',
      401,
      'INVALID_CREDENTIALS',
      'Email/phone or password is incorrect, or the account is unavailable.',
    );
    if (d.device_token) {
      const signedIn = await db.transaction(async (q) => {
        const [device] = await q.query(
          "UPDATE trusted_devices SET last_used_at=now(),expires_at=now()+interval '90 days' WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING id",
          [tokenHash(d.device_token!), u.id],
        );
        if (!device) return null;
        return {
          user: publicUser(u as UserIdentity),
          trusted_device: true as const,
          ...(await session(q, u.id, input.header('User-Agent') || 'Unknown device')),
        };
      });
      if (signedIn) return signedIn;
    }
    // A new device: a code by email, or by text for phone-only accounts.
    if (u.email) return await challenge(u.email, 'login', u.id);
    if (sms.available) return await challenge(u.phone, 'login', u.id, {}, undefined, 'sms');
    // Phone-only and no text messages yet (the minimal check): the password signs in, and
    // withdrawals pause for a day as with any new-device sign-in.
    return await db.transaction(async (q) => {
      const device = input.header('User-Agent') || 'Unknown device';
      await lockMoney(q, u.id, 24, `sign-in from a new device (${device.slice(0, 60)})`);
      return {
        user: publicUser(u as UserIdentity),
        ...(await session(q, u.id, device)),
        device_token: await trustDevice(q, u.id, device),
      };
    });
  }
  /** Sends a password-reset code by email, or by text for a phone number (when texts work). */
  async function forgotPassword(input: RequestInput) {
    const d = z
      .object({
        login: z.string().trim().max(200).optional(),
        email: z.string().trim().max(200).optional(),
      })
      .parse(input.body);
    const id = (d.login || d.email || '').trim();
    if (!id.includes('@')) {
      const phone = normalPhone(id);
      ensure(
        /^\+[1-9]\d{7,14}$/.test(phone),
        400,
        'INVALID_LOGIN',
        'Enter your email address or phone number.',
      );
      const [u] = await db.query("SELECT * FROM users WHERE phone=$1 AND status='ACTIVE'", [phone]);
      if (u?.email) return await challenge(u.email, 'reset', u.id);
      ensure(
        sms.available,
        503,
        'SMS_UNAVAILABLE',
        'Resetting a password by text isn’t available yet. Contact Ahia support to reset it.',
      );
      return await challenge(phone, 'reset', u?.id || null, {}, undefined, 'sms');
    }
    const mail_ = email.parse(id);
    const [u] = await db.query("SELECT * FROM users WHERE email=$1 AND status='ACTIVE'", [mail_]);
    // Unknown addresses get the same response (so the form can't be used to find accounts), but
    // their email explains that no account uses the address instead of sending a useless code.
    return await challenge(
      mail_,
      'reset',
      u?.id || null,
      {},
      u ? undefined : noAccountEmail(mail_),
    );
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
                : `That code is incorrect. Please check your ${otp.channel === 'sms' ? 'text messages' : 'email'}.`,
          },
        };
      }
      if (otp.purpose === 'reset') {
        ensure(d.new_password, 400, 'PASSWORD_REQUIRED', 'Enter your new password.');
        if (!otp.user_id) {
          await q.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [otp.id]);
          return {
            error: {
              status: 404,
              code: 'NO_ACCOUNT',
              message: 'There’s no Ahia account for this email. Create an account first.',
            },
          };
        }
        {
          await q.query(
            'UPDATE users SET password_hash=$1,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$2',
            [await bcrypt.hash(d.new_password, 12), otp.user_id],
          );
          await q.query('DELETE FROM sessions WHERE user_id=$1', [otp.user_id]);
          await q.query('DELETE FROM trusted_devices WHERE user_id=$1', [otp.user_id]);
          // A new password also turns off fingerprint sign-in on every phone.
          await q.query(
            "UPDATE biometric_keys SET revoked_at=now() WHERE user_id=$1 AND purpose='LOGIN' AND revoked_at IS NULL",
            [otp.user_id],
          );
          await lockMoney(q, otp.user_id, 24, 'password reset');
        }
        await q.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [otp.id]);
        return { ok: true, password_reset: true };
      }
      let u: any;
      if (otp.purpose === 'register') {
        const bySms = otp.channel === 'sms';
        [u] = await q.query(
          `INSERT INTO users(id,name,email,phone,password_hash,transaction_pin_hash,referred_by,${bySms ? 'phone_verified_at' : 'email_verified_at'}) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *`,
          [
            randomUUID(),
            otp.payload.name,
            bySms ? null : otp.email,
            otp.payload.phone,
            otp.payload.password_hash,
            otp.payload.transaction_pin_hash ?? null,
            otp.payload.referred_by ?? null,
          ],
        );
      } else {
        [u] = await q.query(
          otp.channel === 'sms'
            ? "UPDATE users SET phone_verified_at=COALESCE(phone_verified_at,now()) WHERE id=$1 AND status='ACTIVE' RETURNING *"
            : "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1 AND status='ACTIVE' RETURNING *",
          [otp.user_id],
        );
        // A code is only asked for on a device we don't know: tell the owner and pause withdrawals
        // for a day, the window in which a stolen account is usually emptied.
        if (u)
          await lockMoney(
            q,
            u.id,
            24,
            `sign-in from a new device (${(input.header('User-Agent') || 'unknown device').slice(0, 60)})`,
          );
      }
      ensure(u, 401, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable.');
      await q.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [otp.id]);
      const device = input.header('User-Agent') || 'Unknown device';
      return {
        user: publicUser(u),
        ...(await session(q, u.id, device)),
        // Sent with later sign-ins from this device so they skip the code.
        device_token: await trustDevice(q, u.id, device),
      };
    });
    return result;
  }
  /**
   * Fingerprint sign-in (phone app). Turning it on needs the account password; the phone keeps a
   * key behind its fingerprint and sends it here to sign in. A new password turns it off.
   */
  async function addLoginKey(q: Query, user: any, input: RequestInput) {
    const d = z
      .object({ password: z.string().max(100), device_name: z.string().trim().max(60).optional() })
      .parse(input.body);
    const [u] = await q.query('SELECT password_hash FROM users WHERE id=$1', [user.id]);
    ensure(
      await bcrypt.compare(d.password, u.password_hash),
      400,
      'INVALID_PASSWORD',
      'That password is incorrect.',
    );
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    await q.query(
      "INSERT INTO biometric_keys(id,user_id,secret_hash,device_name,purpose) VALUES($1,$2,$3,$4,'LOGIN')",
      [id, user.id, hashSecret(secret), d.device_name ?? null],
    );
    await audit(q, user.id, 'auth.login_key_add', id);
    return { id, key: `login:${id}.${secret}` };
  }
  async function removeLoginKey(q: Query, user: any, input: RequestInput) {
    await q.query(
      "UPDATE biometric_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND purpose='LOGIN'",
      [input.params.id, user.id],
    );
    return { ok: true as const };
  }
  async function biometricSignIn(input: RequestInput) {
    const d = z.object({ key: z.string().max(200) }).parse(input.body);
    const [keyId, secret] = d.key.replace(/^login:/, '').split('.');
    return db.transaction(async (q) => {
      const [k] = await q.query(
        `SELECT k.id,k.secret_hash,k.user_id FROM biometric_keys k JOIN users u ON u.id=k.user_id
         WHERE k.id=$1 AND k.purpose='LOGIN' AND k.revoked_at IS NULL AND u.status='ACTIVE'`,
        [keyId ?? ''],
      );
      ensure(
        k && secret && k.secret_hash === hashSecret(secret),
        401,
        'BIOMETRIC_INVALID',
        'Fingerprint sign-in is off for this phone. Sign in with your password, then turn it on again.',
      );
      await q.query('UPDATE biometric_keys SET last_used_at=now() WHERE id=$1', [keyId]);
      const [u] = await q.query('SELECT * FROM users WHERE id=$1', [k.user_id]);
      return {
        user: publicUser(u as UserIdentity),
        ...(await session(q, u.id, input.header('User-Agent') || 'Unknown device')),
      };
    });
  }
  /**
   * The app couldn't reach Ahia (no response at all) and is telling us afterwards, once it can.
   * Those requests leave no trace on the server otherwise, so this is how "it doesn't work on
   * my phone" becomes something we can see: when, which call, the error the phone gave, and the
   * device. Logged only; nothing personal is sent.
   */
  async function clientReport(input: RequestInput) {
    const d = z
      .object({
        reports: z
          .array(
            z.object({
              at: z.iso.datetime({ offset: true }),
              method: z.string().max(10),
              path: z.string().max(120),
              error: z.string().max(200),
              platform: z.string().max(40).optional(),
              app_version: z.string().max(30).optional(),
            }),
          )
          .min(1)
          .max(10),
      })
      .parse(input.body);
    for (const r of d.reports)
      logger.warn('App could not reach Ahia', {
        failedAt: r.at,
        call: `${r.method} ${r.path.replace(/[?#].*$/, '')}`,
        error: r.error,
        platform: r.platform,
        appVersion: r.app_version,
        ua: String(input.header('User-Agent') ?? '').slice(0, 160),
      });
    return { ok: true as const };
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
  /**
   * Staff support: sign-ins and sign-ups waiting for an email code. Codes are stored only as
   * hashes, so staff can't read one; they issue a fresh code instead (see issueSignInCode).
   */
  async function listSignInCodes(_staff: any, input: RequestInput) {
    const search = String(input.query.email ?? '')
      .trim()
      .toLowerCase();
    const rows = await db.query(
      `SELECT o.id,o.email,o.purpose,o.attempts,o.send_count,o.created_at,o.expires_at,
         COALESCE(u.name,o.payload->>'name') AS name
       FROM otp_challenges o LEFT JOIN users u ON u.id=o.user_id
       WHERE o.consumed_at IS NULL AND o.expires_at>now() AND o.attempts<5
         AND o.purpose IN ('register','login') AND ($1='' OR o.email ILIKE '%'||$1||'%')
       ORDER BY o.created_at DESC LIMIT 50`,
      [search],
    );
    return rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      name: r.name ?? null,
      purpose: r.purpose as 'register' | 'login',
      attempts: r.attempts,
      created_at: new Date(r.created_at).toISOString(),
      expires_at: new Date(r.expires_at).toISOString(),
    }));
  }
  /**
   * Replaces a waiting challenge's code with a new one and shows it to staff once, so they can
   * pass it on (e.g. by phone) when the email doesn't arrive. Only for sign-up and sign-in:
   * a sign-in challenge exists only after the person typed the right password, so the code
   * alone can't open an account. Password-reset codes are never issued this way. Audited.
   */
  async function issueSignInCode(staff: any, input: RequestInput) {
    const id = z.uuid().parse(input.params.id);
    return db.transaction(async (q) => {
      const [otp] = await q.query('SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE', [id]);
      ensure(
        otp &&
          !otp.consumed_at &&
          new Date(otp.expires_at).getTime() > Date.now() &&
          otp.attempts < 5 &&
          ['register', 'login'].includes(otp.purpose),
        404,
        'OTP_NOT_WAITING',
        'This sign-in is no longer waiting for a code. Ask them to start again.',
      );
      const code = String(randomInt(100000, 1000000));
      await q.query('UPDATE otp_challenges SET code_hash=$1 WHERE id=$2', [
        digest(otp.id, code),
        otp.id,
      ]);
      await audit(q, staff.id, 'auth.issue_code', otp.id, {
        email: otp.email,
        purpose: otp.purpose,
      });
      return {
        code,
        email: otp.email as string,
        expires_at: new Date(otp.expires_at).toISOString(),
      };
    });
  }
  return {
    resendCode,
    register,
    login,
    forgotPassword,
    verifyCode,
    refreshSession,
    addLoginKey,
    removeLoginKey,
    biometricSignIn,
    clientReport,
    listSignInCodes,
    issueSignInCode,
  };
}
