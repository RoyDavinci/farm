import { discoveryEvent } from './discovery-operations.service.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import { events } from '../lib/events.js';
import type { Database, Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import { mailer } from '../lib/mail.js';
import { notificationEmail } from '../lib/email-templates.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
export async function notify(
  q: Query,
  user: string,
  kind: string,
  title: string,
  body: string,
  booking?: string,
) {
  const nid = randomUUID();
  await q.query(
    'INSERT INTO notifications(id,user_id,kind,title,body,booking_id) VALUES($1,$2,$3,$4,$5,$6)',
    [nid, user, kind, title, body, booking || null],
  );
  await q.query('INSERT INTO notification_outbox(id,notification_id) VALUES($1,$2)', [
    randomUUID(),
    nid,
  ]);
  await q.query('INSERT INTO push_outbox(id,notification_id) VALUES($1,$2)', [randomUUID(), nid]);
  // Open apps refresh right away (only once the notification is committed and visible).
  q.afterCommit(() => events.userChanged(user));
}

interface DeliveryJob {
  job_id: string;
  attempts: number;
  email_enabled: boolean | null;
  marketing_enabled: boolean | null;
  kind: string;
  email_verified_at: Date | null;
  email: string;
  title: string;
  body: string;
}
export async function deliverNotifications(db: Database, c: Config) {
  const mail = mailer(c);
  for (let i = 0; i < 10; i++) {
    const job = await db.transaction(async (q) => {
      const [job] =
        await q.query<DeliveryJob>(`SELECT o.id AS job_id,o.attempts,n.title,n.body,n.kind,u.email,u.email_verified_at,p.email_enabled,(p.marketing_enabled AND (n.kind<>'local_digest' OR EXISTS(SELECT 1 FROM discovery_preferences dp WHERE dp.user_id=n.user_id AND dp.digest_enabled))) AS marketing_enabled
    FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id JOIN users u ON u.id=n.user_id
    LEFT JOIN notification_preferences p ON p.user_id=n.user_id
    WHERE o.status='PENDING' AND o.available_at<=now() AND (o.locked_until IS NULL OR o.locked_until<now())
    ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
      if (!job) return null;
      await q.query(
        "UPDATE notification_outbox SET locked_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",
        [job.job_id],
      );
      return job;
    });
    if (!job) break;
    try {
      if (
        job.email_enabled !== false &&
        job.email_verified_at &&
        (!['marketing', 'local_digest'].includes(job.kind) || job.marketing_enabled === true)
      )
        await mail.send(
          job.email,
          notificationEmail(job.title, job.body, c.publicWebUrl || undefined),
        );
      await db.query(
        "UPDATE notification_outbox SET status='SENT',locked_until=NULL,last_error=NULL WHERE id=$1",
        [job.job_id],
      );
    } catch {
      await db.query(
        "UPDATE notification_outbox SET status=$1,locked_until=NULL,last_error='EMAIL_DELIVERY_FAILED',available_at=$2 WHERE id=$3",
        [
          job.attempts >= 4 ? 'FAILED' : 'PENDING',
          new Date(Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts)),
          job.job_id,
        ],
      );
    }
  }
}

/** Business logic for communications requests. HTTP-free: callers pass plain input. */
export function createCommunicationsService(deps: AppDeps) {
  const { db } = deps;
  async function conversation(q: Query, cid: string, uid: string) {
    const [c] = await q.query(
      'SELECT c.*,l.title,buyer.name AS buyer_name,s.business_name FROM conversations c JOIN listings l ON l.id=c.listing_id JOIN users buyer ON buyer.id=c.buyer_id JOIN sellers s ON s.user_id=c.seller_id WHERE c.id=$1 AND (c.buyer_id=$2 OR c.seller_id=$2)',
      [cid, uid],
    );
    ensure(c, 404, 'NOT_FOUND', 'Conversation not found.');
    return c;
  }
  async function listNotifications(user: any, input: RequestInput) {
    return await db.query(
      'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
      [user.id],
    );
  }
  async function markNotificationsRead(q: Query, u: any, input: RequestInput) {
    const d = z.object({ id: z.uuid().optional() }).parse(input.body || {});
    await q.query(
      `UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL${d.id ? ' AND id=$2' : ''}`,
      d.id ? [u.id, d.id] : [u.id],
    );
    return { ok: true };
  }
  async function getNotificationPreferences(user: any, input: RequestInput) {
    const p = await db.prisma.notificationPreference.findUnique({
      where: { user_id: user.id },
      select: { email_enabled: true, push_enabled: true, marketing_enabled: true },
    });
    return p ?? { email_enabled: true, push_enabled: true, marketing_enabled: false };
  }
  async function updateNotificationPreferences(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        email_enabled: z.boolean(),
        push_enabled: z.boolean().optional(),
        marketing_enabled: z.boolean().optional(),
      })
      .parse(input.body);
    return q.prisma.notificationPreference.upsert({
      where: { user_id: u.id },
      create: {
        user_id: u.id,
        email_enabled: d.email_enabled,
        push_enabled: d.push_enabled ?? true,
        marketing_enabled: d.marketing_enabled ?? false,
      },
      update: {
        email_enabled: d.email_enabled,
        push_enabled: d.push_enabled,
        marketing_enabled: d.marketing_enabled,
      },
      select: { email_enabled: true, push_enabled: true, marketing_enabled: true },
    });
  }
  async function listConversations(user: any, input: RequestInput) {
    return await db.query(
      `SELECT c.id,c.buyer_id,c.seller_id,c.listing_id,c.created_at,l.title,buyer.name AS buyer_name,s.business_name,
 (SELECT m.body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message,
 (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>$1 AND m.created_at>CASE WHEN c.buyer_id=$1 THEN c.buyer_read_at ELSE c.seller_read_at END) AS unread,
 EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=CASE WHEN c.buyer_id=$1 THEN c.seller_id ELSE c.buyer_id END) OR (b.blocked_id=$1 AND b.blocker_id=CASE WHEN c.buyer_id=$1 THEN c.seller_id ELSE c.buyer_id END)) AS blocked,
 EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_id=$1 AND b.blocked_id=CASE WHEN c.buyer_id=$1 THEN c.seller_id ELSE c.buyer_id END) AS blocked_by_me
 FROM conversations c JOIN listings l ON l.id=c.listing_id JOIN users buyer ON buyer.id=c.buyer_id JOIN sellers s ON s.user_id=c.seller_id WHERE c.buyer_id=$1 OR c.seller_id=$1 ORDER BY c.created_at DESC LIMIT 100`,
      [user.id],
    );
  }
  async function startConversation(q: Query, u: any, input: RequestInput) {
    const d = z.object({ listing_id: z.uuid() }).parse(input.body);
    const [l] = await q.query(
      "SELECT l.* FROM listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1 AND s.status='APPROVED' AND l.status='ACTIVE'",
      [d.listing_id],
    );
    ensure(
      l && l.seller_id !== u.id,
      400,
      'INVALID_CONVERSATION',
      'Choose a listing from another approved seller.',
    );
    const [c] = await q.query(
      'INSERT INTO conversations(id,buyer_id,seller_id,listing_id) VALUES($1,$2,$3,$4) ON CONFLICT(buyer_id,seller_id,listing_id) DO UPDATE SET listing_id=EXCLUDED.listing_id RETURNING *',
      [randomUUID(), u.id, l.seller_id, l.id],
    );
    return c;
  }
  async function listMessages(user: any, input: RequestInput) {
    const c = await conversation(db, input.params.id as string, user.id);
    const cursor = z.object({ before: z.iso.datetime().optional() }).parse(input.query);
    const rows = await db.query(
      `SELECT id,sender_id,body,created_at FROM messages WHERE conversation_id=$1${cursor.before ? ' AND created_at<$2' : ''} ORDER BY created_at DESC,id DESC LIMIT 50`,
      cursor.before ? [c.id, cursor.before] : [c.id],
    );
    return {
      messages: rows.reverse(),
      peer_read_at: c.buyer_id === user.id ? c.seller_read_at : c.buyer_read_at,
      has_more: rows.length === 50,
    };
  }
  async function markConversationRead(q: Query, u: any, input: RequestInput) {
    const c = await conversation(q, input.params.id as string, u.id);
    await q.query(
      `UPDATE conversations SET ${u.id === c.buyer_id ? 'buyer_read_at' : 'seller_read_at'}=now() WHERE id=$1`,
      [c.id],
    );
    // The other participant's app shows the message as read.
    q.afterCommit(() => events.userChanged(u.id === c.buyer_id ? c.seller_id : c.buyer_id));
    return { ok: true };
  }
  async function sendMessage(q: Query, u: any, input: RequestInput) {
    const d = z.object({ body: z.string().trim().min(1).max(2000) }).parse(input.body);
    const c = await conversation(q, input.params.id as string, u.id);
    if (u.id === c.buyer_id) {
      await discoveryEvent(q, u.id, 'CONTACT', c.listing_id);
      await q.query(
        'UPDATE status_clicks SET conversation_id=$1 WHERE id=(SELECT id FROM status_clicks WHERE buyer_id=$2 AND listing_id=$3 AND expires_at>now() AND conversation_id IS NULL AND NOT EXISTS(SELECT 1 FROM status_clicks WHERE conversation_id=$1) ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE)',
        [c.id, u.id, c.listing_id],
      );
    }
    const peer = c.buyer_id === u.id ? c.seller_id : c.buyer_id;
    const [blocked] = await q.query(
      'SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',
      [u.id, peer],
    );
    ensure(
      !blocked,
      403,
      'USER_BLOCKED',
      'Messaging is unavailable because one participant has blocked the other.',
    );
    const [message] = await q.query(
      'INSERT INTO messages(id,conversation_id,sender_id,body) VALUES($1,$2,$3,$4) RETURNING *',
      [randomUUID(), c.id, u.id, d.body],
    );
    await notify(
      q,
      peer,
      'message',
      'New market message',
      `You have a new message about ${c.title || 'a listing'}. Open Zuru to read it.`,
    );
    return message;
  }
  async function listBlocks(user: any, input: RequestInput) {
    return (
      await db.prisma.userBlock.findMany({
        where: { blocker_id: user.id },
        select: { blocked_id: true, blocked: { select: { name: true } } },
      })
    ).map((b) => ({ blocked_id: b.blocked_id, name: b.blocked.name }));
  }
  async function blockUser(q: Query, u: any, input: RequestInput) {
    ensure(input.params.id !== u.id, 400, 'INVALID_BLOCK', 'You cannot block yourself.');
    const target = await q.prisma.user.findUnique({
      where: { id: String(input.params.id) },
      select: { id: true },
    });
    ensure(target, 404, 'NOT_FOUND', 'Account not found.');
    await q.prisma.userBlock.upsert({
      where: { blocker_id_blocked_id: { blocker_id: u.id, blocked_id: target.id } },
      create: { blocker_id: u.id, blocked_id: target.id },
      update: {},
    });
    return { ok: true };
  }
  async function unblockUser(q: Query, u: any, input: RequestInput) {
    await q.prisma.userBlock.deleteMany({
      where: { blocker_id: u.id, blocked_id: String(input.params.id) },
    });
    return { ok: true };
  }
  async function createReport(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        subject_type: z.enum(['listing', 'conversation', 'user']),
        subject_id: z.uuid(),
        reason: z.string().trim().min(5).max(2000),
      })
      .parse(input.body);
    if (d.subject_type === 'conversation') await conversation(q, d.subject_id, u.id);
    else {
      const [target] = await q.query(
        `SELECT ${d.subject_type === 'listing' ? 'id' : 'id'} FROM ${d.subject_type === 'listing' ? 'listings' : 'users'} WHERE id=$1`,
        [d.subject_id],
      );
      ensure(target, 404, 'NOT_FOUND', 'Reported item not found.');
    }
    const [report] = await q.query(
      'INSERT INTO reports(id,reporter_id,subject_type,subject_id,reason) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [randomUUID(), u.id, d.subject_type, d.subject_id, d.reason],
    );
    await audit(q, u.id, 'report.create', report.id);
    return report;
  }
  async function listFavourites(user: any, input: RequestInput) {
    return (
      await db.prisma.favourite.findMany({
        where: { buyer_id: user.id, seller: { status: 'APPROVED' } },
        orderBy: { created_at: 'desc' },
        select: {
          seller: { select: { user_id: true, business_name: true, city: true, area: true } },
        },
      })
    ).map((f) => f.seller);
  }
  async function addFavourite(q: Query, u: any, input: RequestInput) {
    const s = await q.prisma.seller.findFirst({
      where: { user_id: String(input.params.id), status: 'APPROVED' },
      select: { user_id: true },
    });
    ensure(s, 404, 'NOT_FOUND', 'Seller not found.');
    await q.prisma.favourite.upsert({
      where: { buyer_id_seller_id: { buyer_id: u.id, seller_id: s.user_id } },
      create: { buyer_id: u.id, seller_id: s.user_id },
      update: {},
    });
    return { ok: true };
  }
  async function removeFavourite(q: Query, u: any, input: RequestInput) {
    await q.prisma.favourite.deleteMany({
      where: { buyer_id: u.id, seller_id: String(input.params.id) },
    });
    return { ok: true };
  }
  async function getSellerProfile(user: any, input: RequestInput) {
    const [s] = await db.query(
      "SELECT s.user_id,s.business_name,s.business_type,s.city,s.area,(SELECT ROUND(AVG(score),1) FROM ratings WHERE seller_id=s.user_id) AS rating_avg,(SELECT COUNT(*)::int FROM ratings WHERE seller_id=s.user_id) AS rating_count FROM sellers s WHERE s.user_id=$1 AND s.status='APPROVED'",
      [input.params.id],
    );
    ensure(s, 404, 'NOT_FOUND', 'Seller not found.');
    const ratings = await db.query(
      'SELECT r.score,r.comment,r.created_at,u.name AS buyer_name FROM ratings r JOIN users u ON u.id=r.buyer_id WHERE r.seller_id=$1 ORDER BY r.created_at DESC LIMIT 20',
      [s.user_id],
    );
    return { ...s, ratings };
  }
  async function getRating(user: any, input: RequestInput) {
    const [b] = await db.query('SELECT id FROM bookings WHERE id=$1 AND buyer_id=$2', [
      input.params.id,
      user.id,
    ]);
    ensure(b, 404, 'NOT_FOUND', 'Booking not found.');
    const [rating] = await db.query(
      'SELECT score,comment FROM ratings WHERE booking_id=$1 AND buyer_id=$2',
      [b.id, user.id],
    );
    return rating || null;
  }
  async function rateBooking(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(1000) })
      .parse(input.body);
    const [b] = await q.query(
      "SELECT * FROM bookings WHERE id=$1 AND buyer_id=$2 AND status='COMPLETED'",
      [input.params.id, u.id],
    );
    ensure(b, 403, 'REVIEW_NOT_ALLOWED', 'Only the buyer can review a completed pickup.');
    const [existing] = await q.query('SELECT id FROM ratings WHERE booking_id=$1 AND buyer_id=$2', [
      b.id,
      u.id,
    ]);
    ensure(!existing, 409, 'ALREADY_REVIEWED', 'You already reviewed this pickup.');
    await q.query(
      'INSERT INTO ratings(id,booking_id,buyer_id,seller_id,score,comment) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), b.id, u.id, b.seller_id, d.score, d.comment],
    );
    return { ok: true };
  }
  async function listReports(user: any, input: RequestInput) {
    ensure(user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return await db.query(
      'SELECT r.*,u.name AS reporter_name FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 100',
    );
  }
  async function listEmailQueue(user: any, input: RequestInput) {
    ensure(user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return await db.query(
      'SELECT o.id,o.status,o.attempts,o.last_error,o.created_at,n.title,u.name AS recipient_name FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id JOIN users u ON u.id=n.user_id ORDER BY o.created_at DESC LIMIT 100',
    );
  }
  async function listUsers(user: any, input: RequestInput) {
    ensure(user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return await db.query(
      'SELECT id,name,email,phone,status,admin,email_verified_at,created_at FROM users ORDER BY created_at DESC LIMIT 100',
    );
  }
  async function resolveReport(q: Query, u: any, input: RequestInput) {
    const d = z.object({ resolution: z.string().trim().min(5).max(2000) }).parse(input.body);
    const [r] = await q.query(
      "UPDATE reports SET status='RESOLVED',resolution=$1 WHERE id=$2 RETURNING *",
      [d.resolution, input.params.id],
    );
    ensure(r, 404, 'NOT_FOUND', 'Report not found.');
    await audit(q, u.id, 'report.resolve', r.id, d);
    return r;
  }
  async function retryEmail(q: Query, u: any, input: RequestInput) {
    const [job] = await q.query(
      "UPDATE notification_outbox SET status='PENDING',attempts=0,available_at=now(),locked_until=NULL WHERE id=$1 AND status='FAILED' RETURNING id",
      [input.params.id],
    );
    ensure(job, 409, 'NOT_RETRYABLE', 'Only failed jobs can be retried.');
    await audit(q, u.id, 'notification.retry', job.id);
    return { ok: true };
  }
  async function setUserStatus(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        status: z.enum(['ACTIVE', 'SUSPENDED']),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(input.body);
    ensure(input.params.id !== u.id, 400, 'OWN_ACCOUNT', 'You cannot suspend your own account.');
    const [target] = await q.query('SELECT * FROM users WHERE id=$1', [input.params.id]);
    ensure(
      target && !target.admin,
      403,
      'PROTECTED_ACCOUNT',
      'Administrator accounts cannot be changed here.',
    );
    await q.query('UPDATE users SET status=$1 WHERE id=$2', [d.status, target.id]);
    if (d.status === 'SUSPENDED')
      await q.query('DELETE FROM sessions WHERE user_id=$1', [target.id]);
    await audit(q, u.id, 'user.status', target.id, d);
    return { ok: true };
  }
  return {
    listNotifications,
    markNotificationsRead,
    getNotificationPreferences,
    updateNotificationPreferences,
    listConversations,
    startConversation,
    listMessages,
    markConversationRead,
    sendMessage,
    listBlocks,
    blockUser,
    unblockUser,
    createReport,
    listFavourites,
    addFavourite,
    removeFavourite,
    getSellerProfile,
    getRating,
    rateBooking,
    listReports,
    listEmailQueue,
    listUsers,
    resolveReport,
    retryEmail,
    setUserStatus,
  };
}
