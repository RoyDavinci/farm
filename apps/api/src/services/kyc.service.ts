import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { Database, Query } from '../database/client.js';
import { AppError, ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { storage } from '../lib/storage.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';
import { flag, namesAgree } from './risk.service.js';

/**
 * BVN verification through Flutterwave (their consent flow):
 * 1. POST /v3/bvn/verifications with the BVN and name → a consent page URL and a reference;
 * 2. the customer approves on the NIBSS page, then comes back to the app;
 * 3. GET /v3/bvn/verifications/{reference} (or the "bvn.completed" webhook) returns the record.
 * We then check the BVN name against the account, compare the NIN if the seller gave one, note a
 * watch-list hit, and keep the BVN photo with the person's private documents for staff to compare
 * with their selfie. Flutterwave has no NIN lookup or liveness check, so those stay manual.
 * Needs BVN access switched on by Flutterwave (hi@flutterwavego.com).
 */

export const bvnInput = z.object({
  bvn: z.string().regex(/^\d{11}$/, 'A BVN is 11 digits.'),
  first_name: z.string().trim().min(2).max(60),
  last_name: z.string().trim().min(2).max(60),
});

const FLW = 'https://api.flutterwave.com/v3/bvn/verifications';

async function flw(c: Config, url: string, body?: object) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${c.flutterwave}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(503, 'KYC_UNAVAILABLE', 'Identity checks are temporarily unavailable.');
  }
  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.status !== 'success')
    throw new AppError(
      res.status >= 500 ? 503 : 400,
      'KYC_FAILED',
      data?.message ? `Flutterwave: ${data.message}` : 'The BVN check could not be started.',
    );
  return data.data;
}

/** "Simulated" mode for development and tests, using Flutterwave's sandbox BVN names. */
function simulatedRecord(bvn: string, first: string, last: string) {
  const sandbox = ['22222223883', '22123456789'].includes(bvn);
  return {
    status: 'COMPLETED',
    bvn_data: {
      bvn,
      firstName: sandbox ? 'Nibby' : first,
      surname: sandbox ? 'Certifier' : last,
      middleName: '',
      dateOfBirth: '1990-01-01',
      nin: '12345678901',
      watchlisted: bvn.startsWith('999') ? 'YES' : 'NO',
      faceImage: null,
    },
  };
}

const mode = (c: Config) =>
  c.flutterwave && c.payments ? 'flutterwave' : c.demo ? 'simulated' : null;

/** Applies a completed BVN record to the check and the account. */
export async function settleBvn(q: Query, c: Config, check: any, record: any) {
  const b = record?.bvn_data;
  if (!b || check.status !== 'PENDING') return;
  const [u] = await q.query(
    `SELECT u.id,u.name,s.verification_details->>'full_name' AS full_name,s.verification_details->>'nin' AS nin,
       EXISTS(SELECT 1 FROM sellers WHERE user_id=u.id) AS seller,EXISTS(SELECT 1 FROM drivers WHERE user_id=u.id) AS driver
     FROM users u LEFT JOIN sellers s ON s.user_id=u.id WHERE u.id=$1`,
    [check.user_id],
  );
  const first = String(b.firstName ?? '').trim();
  const middle = String(b.middleName ?? '').trim();
  const last = String(b.surname ?? b.lastName ?? '').trim();
  const bvnName = [first, middle, last].filter(Boolean).join(' ');
  const match = namesAgree(bvnName, u.name, u.full_name);
  const watchlisted = /^(yes|true|1)$/i.test(String(b.watchlisted ?? ''));
  const ninMatch = u.nin && b.nin ? String(u.nin) === String(b.nin) : null;
  const status = match ? 'VERIFIED' : 'MISMATCH';
  await q.query(
    `UPDATE kyc_checks SET status=$1,first_name=$2,middle_name=$3,last_name=$4,date_of_birth=$5,nin_match=$6,
       watchlisted=$7,reason=$8,updated_at=now() WHERE id=$9`,
    [
      status,
      first,
      middle || null,
      last,
      b.dateOfBirth ?? null,
      ninMatch,
      watchlisted,
      match ? null : `BVN name “${bvnName}” doesn’t match the account name.`,
      check.id,
    ],
  );
  if (match)
    await q.query('UPDATE users SET bvn_verified_at=now(),verified_name=$1 WHERE id=$2', [
      bvnName,
      u.id,
    ]);
  else
    await flag(
      q,
      u.id,
      'BVN_NAME_MISMATCH',
      `BVN belongs to “${bvnName}”, not “${u.name}”.`,
      'HIGH',
    );
  if (watchlisted)
    await flag(q, u.id, 'BVN_WATCHLISTED', 'The BVN is on the banks’ watch-list.', 'HIGH');
  if (ninMatch === false)
    await flag(
      q,
      u.id,
      'NIN_MISMATCH',
      'The NIN given doesn’t match the one on the BVN record.',
      'HIGH',
    );
  // The BVN photo goes with the person's private documents for staff to compare with the selfie.
  if (b.faceImage && (u.seller || u.driver)) {
    try {
      const bytes = await sharp(Buffer.from(String(b.faceImage), 'base64'))
        .resize(800, 800, { fit: 'inside' })
        .webp({ quality: 85 })
        .toBuffer();
      const id = randomUUID();
      const key = `seller-documents/${u.id}/${id}.webp`;
      const store = storage(c);
      await store.put(key, bytes, 'image/webp', true);
      await q.query(
        "INSERT INTO seller_documents(id,seller_id,kind,filename,mime_type,storage_provider,storage_key,subject,status,review_note) VALUES($1,$2,'bvn_photo',$3,'image/webp',$4,$5,$6,'ACCEPTED','Photo from the BVN record (Flutterwave).')",
        [
          id,
          u.id,
          `bvn-photo-${id.slice(0, 8)}.webp`,
          store.provider(true),
          key,
          u.seller ? 'seller' : 'driver',
        ],
      );
    } catch {
      // A bad image doesn't undo the check; staff can still compare names.
    }
  }
  await audit(q, null, 'kyc.bvn_' + status.toLowerCase(), check.id, { user_id: u.id });
  await notify(
    q,
    u.id,
    'security',
    match ? 'BVN verified' : 'BVN check didn’t match',
    match
      ? 'Your identity is confirmed. Your withdrawal limits are now higher.'
      : 'The name on that BVN doesn’t match your account. Our team will review it.',
  );
}

/** Flutterwave's "bvn.completed" webhook. Returns true when it was a BVN event. */
export async function handleBvnWebhook(db: Database, c: Config, body: any) {
  if (body?.event !== 'bvn.completed') return false;
  const reference = body?.data?.reference;
  if (typeof reference !== 'string') return true;
  await db.transaction(async (q) => {
    const [check] = await q.query('SELECT * FROM kyc_checks WHERE reference=$1 FOR UPDATE', [
      reference,
    ]);
    if (check) await settleBvn(q, c, check, body.data);
  });
  return true;
}

export function createKycService(deps: AppDeps) {
  const { db, config: c } = deps;
  const view = (k: any) =>
    k && {
      id: k.id,
      status: k.status,
      consent_url: k.status === 'PENDING' ? k.consent_url : null,
      bvn_last4: k.bvn_last4,
      name: [k.first_name, k.middle_name, k.last_name].filter(Boolean).join(' ') || null,
      reason: k.reason ?? null,
      created_at: k.created_at,
    };
  async function getKyc(user: any, _input: RequestInput) {
    const [u] = await db.query('SELECT bvn_verified_at,verified_name FROM users WHERE id=$1', [
      user.id,
    ]);
    const [last] = await db.query(
      'SELECT * FROM kyc_checks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [user.id],
    );
    return {
      available: !!mode(c),
      bvn_verified: !!u.bvn_verified_at,
      verified_name: u.verified_name ?? null,
      check: view(last) ?? null,
    };
  }
  /** Starts a BVN check; returns the consent page to open, or the result straight away. */
  async function startBvn(q: Query, user: any, input: RequestInput) {
    const d = bvnInput.parse(input.body);
    const how = mode(c);
    ensure(how, 503, 'KYC_UNAVAILABLE', 'BVN checks aren’t available yet.');
    const [u] = await q.query('SELECT bvn_verified_at FROM users WHERE id=$1', [user.id]);
    ensure(!u.bvn_verified_at, 409, 'ALREADY_VERIFIED', 'Your BVN is already verified.');
    const [recent] = await q.query(
      "SELECT COUNT(*)::int AS n FROM kyc_checks WHERE user_id=$1 AND created_at>now()-interval '1 day'",
      [user.id],
    );
    ensure(recent.n < 5, 429, 'TOO_MANY_CHECKS', 'Too many BVN checks today. Try again tomorrow.');
    const id = randomUUID();
    let reference: string, url: string | null;
    if (how === 'flutterwave') {
      const started = await flw(c, FLW, {
        bvn: d.bvn,
        firstname: d.first_name,
        lastname: d.last_name,
        redirect_url: `${c.publicWebUrl || c.publicApiUrl}/?kyc=${id}`,
      });
      reference = started.reference;
      url = started.url || null;
    } else {
      reference = `SIM-${id}`;
      url = null;
    }
    const [check] = await q.query(
      'INSERT INTO kyc_checks(id,user_id,provider,reference,consent_url,bvn_last4) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [id, user.id, how, reference, url, d.bvn.slice(-4)],
    );
    // Consent already given (or simulated): the record is ready now.
    if (!url)
      await settleBvn(
        q,
        c,
        check,
        how === 'flutterwave'
          ? await flw(c, `${FLW}/${encodeURIComponent(reference)}`)
          : simulatedRecord(d.bvn, d.first_name, d.last_name),
      );
    const [fresh] = await q.query('SELECT * FROM kyc_checks WHERE id=$1', [id]);
    return view(fresh);
  }
  /** After the consent page: fetch the record if Flutterwave has it. */
  async function refreshBvn(q: Query, user: any, input: RequestInput) {
    const [check] = await q.query(
      'SELECT * FROM kyc_checks WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [input.params.id, user.id],
    );
    ensure(check, 404, 'NOT_FOUND', 'BVN check not found.');
    if (check.status === 'PENDING' && check.provider === 'flutterwave') {
      const record = await flw(c, `${FLW}/${encodeURIComponent(check.reference)}`);
      if (record?.status === 'COMPLETED' || record?.bvn_data) await settleBvn(q, c, check, record);
    }
    const [fresh] = await q.query('SELECT * FROM kyc_checks WHERE id=$1', [check.id]);
    return view(fresh);
  }
  return { getKyc, startBvn, refreshBvn };
}
