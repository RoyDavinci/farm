import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { notify } from './communications.service.js';

export const verificationApplyInput = z.object({
  legal_name: z.string().trim().min(2).max(160),
  /** CAC registration number, when the business is registered. */
  registration_number: z.string().trim().max(40).default(''),
  contact_person: z.string().trim().min(2).max(120),
  contact_phone: z.string().trim().min(7).max(20),
  business_address: z.string().trim().min(5).max(300),
  operating_states: z.array(z.string().trim().min(2).max(40)).max(37).default([]),
});
export const verificationDecisionInput = z.object({
  status: z.enum(['VERIFIED', 'REJECTED', 'INFO_REQUESTED', 'SUSPENDED']),
  note: z.string().trim().min(10).max(1000),
  /** How long a verification lasts before it must be renewed. */
  valid_months: z.number().int().min(1).max(36).default(12),
});

/** SQL for "this seller is verified right now" (expired verifications don't count). */
export const verifiedSql = (alias = 's') =>
  `(${alias}.verification_status='VERIFIED' AND ${alias}.verification_expires_at>now())`;

export const VERIFICATION_MEANS =
  'Verified means Ahia checked this business’s identity, contact details and location. It is not a guarantee that every product is genuine or defect-free, and it cannot be bought.';

/** Marks verifications past their review date as EXPIRED, with a history entry. */
export async function expireVerifications(q: Query) {
  const rows = await q.query(
    "UPDATE sellers SET verification_status='EXPIRED' WHERE verification_status='VERIFIED' AND verification_expires_at<=now() RETURNING user_id",
  );
  for (const r of rows)
    await q.query(
      "INSERT INTO verification_events(id,seller_id,status,note) VALUES($1,$2,'EXPIRED','Verification reached its review date.')",
      [randomUUID(), r.user_id],
    );
  return rows.length;
}

/**
 * Business verification: an identity and location review by staff, separate from seller approval
 * and from anything a seller pays for. Statuses: PENDING → VERIFIED / REJECTED / INFO_REQUESTED;
 * VERIFIED → SUSPENDED or EXPIRED (after the review date).
 */
export function createBusinessVerificationService(deps: AppDeps) {
  const { db } = deps;

  async function history(sellerId: string, withActors: boolean) {
    return db.query(
      `SELECT e.id,e.status,e.note,e.created_at${withActors ? ',u.name AS actor_name' : ''}
       FROM verification_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.seller_id=$1 ORDER BY e.created_at DESC LIMIT 50`,
      [sellerId],
    );
  }

  async function getMyVerification(user: any, _input?: RequestInput) {
    await expireVerifications(db);
    const [s] = await db.query(
      'SELECT status,verification_status,verification_details,verified_at,verification_expires_at FROM sellers WHERE user_id=$1',
      [user.id],
    );
    ensure(s, 404, 'NOT_A_SELLER', 'Register as a seller first.');
    const [docs] = await db.query(
      "SELECT COUNT(*) FILTER (WHERE status<>'REJECTED')::int AS usable,COUNT(*)::int AS total FROM seller_documents WHERE seller_id=$1 AND subject='seller'",
      [user.id],
    );
    return {
      status: s.verification_status,
      details: s.verification_details,
      verified_at: s.verified_at,
      expires_at: s.verification_expires_at,
      documents: docs.usable,
      history: await history(user.id, false),
      requirements: [
        'Your registered or trading business name and the person responsible',
        'A phone number we can call to confirm',
        'Your business address (it stays private)',
        'At least one document uploaded under Account → Documents: business registration (CAC), the owner’s government ID, or proof of address',
      ],
      means: VERIFICATION_MEANS,
    };
  }

  async function applyForVerification(q: Query, user: any, input: RequestInput) {
    const d = verificationApplyInput.parse(input.body);
    await expireVerifications(q);
    const [s] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [user.id]);
    ensure(
      s?.status === 'APPROVED',
      403,
      'SELLER_NOT_APPROVED',
      'Approved sellers can apply for verification.',
    );
    const renewSoon =
      s.verification_status === 'VERIFIED' &&
      new Date(s.verification_expires_at).getTime() - Date.now() < 30 * 86400000;
    ensure(
      !['PENDING', 'SUSPENDED'].includes(s.verification_status) &&
        (s.verification_status !== 'VERIFIED' || renewSoon),
      409,
      'VERIFICATION_IN_PROGRESS',
      s.verification_status === 'SUSPENDED'
        ? 'Your verification is suspended. Contact support to review it.'
        : s.verification_status === 'PENDING'
          ? 'Your application is already being reviewed.'
          : 'You are already verified. You can renew in the last 30 days.',
    );
    const [docs] = await q.query(
      "SELECT COUNT(*)::int AS n FROM seller_documents WHERE seller_id=$1 AND subject='seller' AND status<>'REJECTED'",
      [user.id],
    );
    ensure(
      docs.n > 0,
      400,
      'DOCUMENTS_REQUIRED',
      'Upload at least one document first: CAC certificate, owner ID or a recent utility bill.',
    );
    await q.query(
      "UPDATE sellers SET verification_status='PENDING',verification_details=$1 WHERE user_id=$2",
      [JSON.stringify({ ...d, submitted_at: new Date().toISOString() }), user.id],
    );
    await q.query(
      "INSERT INTO verification_events(id,seller_id,status,note,actor_id) VALUES($1,$2,'PENDING','Application submitted.',$2)",
      [randomUUID(), user.id],
    );
    await audit(q, user.id, 'verification.apply', user.id, { legal_name: d.legal_name });
    return { status: 'PENDING' as const };
  }

  async function listVerifications(_user: any, input: RequestInput) {
    await expireVerifications(db);
    const { status } = z
      .object({
        status: z
          .enum(['QUEUE', 'ALL', 'VERIFIED', 'SUSPENDED', 'EXPIRED', 'REJECTED'])
          .default('QUEUE'),
      })
      .parse(input.query);
    const rows = await db.query(
      `SELECT s.user_id AS seller_id,s.business_name,s.business_type,s.city,s.area,s.state,s.lga,s.status AS seller_status,
         s.verification_status,s.verification_details,s.verified_at,s.verification_expires_at,u.email,u.phone,
         (SELECT json_agg(json_build_object('id',d.id,'kind',d.kind,'status',d.status,'filename',d.filename) ORDER BY d.created_at)
            FROM seller_documents d WHERE d.seller_id=s.user_id AND d.subject='seller') AS documents,
         (SELECT MAX(e.created_at) FROM verification_events e WHERE e.seller_id=s.user_id) AS last_event_at
       FROM sellers s JOIN users u ON u.id=s.user_id
       WHERE s.verification_status<>'NONE' AND (
         ($1='QUEUE' AND s.verification_status IN ('PENDING','INFO_REQUESTED')) OR $1='ALL' OR s.verification_status=$1)
       ORDER BY (s.verification_status='PENDING') DESC,last_event_at DESC NULLS LAST LIMIT 200`,
      [status],
    );
    return rows.map((r: any) => ({ ...r, documents: r.documents || [] }));
  }

  async function verificationHistory(_user: any, input: RequestInput) {
    return history(input.params.sellerId, true);
  }

  async function decideVerification(q: Query, user: any, input: RequestInput) {
    const d = verificationDecisionInput.parse(input.body);
    const [s] = await q.query('SELECT * FROM sellers WHERE user_id=$1 FOR UPDATE', [
      input.params.sellerId,
    ]);
    ensure(s, 404, 'NOT_FOUND', 'Seller not found.');
    const allowed: Record<string, string[]> = {
      VERIFIED: ['PENDING', 'INFO_REQUESTED', 'SUSPENDED', 'EXPIRED'],
      REJECTED: ['PENDING', 'INFO_REQUESTED'],
      INFO_REQUESTED: ['PENDING'],
      SUSPENDED: ['VERIFIED'],
    };
    ensure(
      allowed[d.status].includes(s.verification_status),
      409,
      'INVALID_TRANSITION',
      `A ${s.verification_status.toLowerCase().replace('_', ' ')} business can’t be marked ${d.status.toLowerCase().replace('_', ' ')}.`,
    );
    if (d.status === 'VERIFIED')
      await q.query(
        "UPDATE sellers SET verification_status='VERIFIED',verified_at=now(),verification_expires_at=now()+$1::int*interval '1 month',verification_reviewed_by=$2 WHERE user_id=$3",
        [d.valid_months, user.id, s.user_id],
      );
    else
      await q.query(
        'UPDATE sellers SET verification_status=$1,verification_reviewed_by=$2 WHERE user_id=$3',
        [d.status, user.id, s.user_id],
      );
    await q.query(
      'INSERT INTO verification_events(id,seller_id,status,note,actor_id) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), s.user_id, d.status, d.note, user.id],
    );
    await audit(q, user.id, `verification.${d.status.toLowerCase()}`, s.user_id, d);
    const message: Record<string, string> = {
      VERIFIED: `Your business is now verified for ${d.valid_months} months. Buyers will see the Verified badge.`,
      REJECTED: `We couldn’t verify your business: ${d.note}`,
      INFO_REQUESTED: `We need more information to verify your business: ${d.note}`,
      SUSPENDED: `Your Verified badge is suspended: ${d.note}`,
    };
    await notify(q, s.user_id, 'verification', 'Business verification', message[d.status]);
    return { ok: true };
  }

  /** Sellers near the buyer (approximate public pins), verified and featured flagged. */
  async function nearbySellers(user: any, input: RequestInput) {
    const d = z
      .object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        q: z.string().trim().max(80).optional(),
      })
      .parse(input.query);
    const point = d.lat != null && d.lng != null;
    const qParam = point ? '$4' : '$2';
    const distance = point
      ? '6371*acos(LEAST(1.0,GREATEST(-1.0,sin(radians($2::float8))*sin(radians(s.public_latitude))+cos(radians($2::float8))*cos(radians(s.public_latitude))*cos(radians(s.public_longitude-$3::float8)))))'
      : 'NULL::float8';
    const rows = await db.query(
      `SELECT s.user_id AS seller_id,s.business_name,s.business_type,s.area,s.city,s.state,${verifiedSql()} AS verified,
         EXISTS(SELECT 1 FROM featured_sellers f WHERE f.seller_id=s.user_id AND f.status='ACTIVE' AND f.ends_at>now()) AS featured,
         COALESCE((SELECT ROUND(AVG(r.score),1)::float8 FROM ratings r WHERE r.seller_id=s.user_id),0) AS rating_avg,
         (SELECT COUNT(*)::int FROM ratings r WHERE r.seller_id=s.user_id) AS rating_count,
         (SELECT COUNT(*)::int FROM listings l WHERE l.seller_id=s.user_id AND l.status='ACTIVE') AS products,
         (SELECT COALESCE(m.thumbnail_url,l.image_url) FROM listings l LEFT JOIN media m ON m.url=l.image_url
            WHERE l.seller_id=s.user_id AND l.status='ACTIVE' AND l.image_url IS NOT NULL ORDER BY l.created_at DESC LIMIT 1) AS image_url,
         ${distance} AS distance_km
       FROM sellers s WHERE s.status='APPROVED' AND s.user_id<>$1
         AND (${qParam}::text='' OR s.business_name ILIKE '%'||${qParam}||'%' OR s.area ILIKE '%'||${qParam}||'%' OR s.city ILIKE '%'||${qParam}||'%')
         AND EXISTS(SELECT 1 FROM listings l WHERE l.seller_id=s.user_id AND l.status='ACTIVE')
       ORDER BY ${point ? 'distance_km NULLS LAST,' : ''}${verifiedSql()} DESC,rating_avg DESC LIMIT 60`,
      point ? [user.id, d.lat, d.lng, d.q ?? ''] : [user.id, d.q ?? ''],
    );
    return rows.map((r: any) => ({
      ...r,
      distance_km: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
    }));
  }

  return {
    nearbySellers,
    getMyVerification,
    applyForVerification,
    listVerifications,
    verificationHistory,
    decideVerification,
  };
}
