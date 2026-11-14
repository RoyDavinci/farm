import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import { audit } from '../services/audit.service.js';
import { notify } from '../services/communications.service.js';
import type { AppDeps } from '../types/deps.js';

export function createCommunicationsController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;

  async function conversation(q: Query, cid: string, uid: string) {
    const [c] = await q.query(
      'SELECT c.*,l.title,buyer.name AS buyer_name,s.business_name FROM conversations c JOIN listings l ON l.id=c.listing_id JOIN users buyer ON buyer.id=c.buyer_id JOIN sellers s ON s.user_id=c.seller_id WHERE c.id=$1 AND (c.buyer_id=$2 OR c.seller_id=$2)',
      [cid, uid],
    );
    ensure(c, 404, 'NOT_FOUND', 'Conversation not found.');
    return c;
  }
  const listNotifications: RequestHandler = async (_req, res) =>
    res.json(
      await db.query(
        'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
        [res.locals.user.id],
      ),
    );
  const markNotificationsRead: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = z.object({ id: z.uuid().optional() }).parse(req.body || {});
      await q.query(
        `UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL${d.id ? ' AND id=$2' : ''}`,
        d.id ? [u.id, d.id] : [u.id],
      );
      return { ok: true };
    });
  const getNotificationPreferences: RequestHandler = async (_req, res) => {
    const p = await db.prisma.notificationPreference.findUnique({
      where: { user_id: res.locals.user.id },
      select: { email_enabled: true, push_enabled: true },
    });
    res.json(p ?? { email_enabled: true, push_enabled: true });
  };
  const updateNotificationPreferences: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = z
        .object({ email_enabled: z.boolean(), push_enabled: z.boolean().optional() })
        .parse(req.body);
      return q.prisma.notificationPreference.upsert({
        where: { user_id: u.id },
        create: {
          user_id: u.id,
          email_enabled: d.email_enabled,
          push_enabled: d.push_enabled ?? true,
        },
        update: { email_enabled: d.email_enabled, push_enabled: d.push_enabled },
        select: { email_enabled: true, push_enabled: true },
      });
    });
  const listConversations: RequestHandler = async (_req, res) =>
    res.json(
      await db.query(
        `SELECT c.id,c.buyer_id,c.seller_id,c.listing_id,c.created_at,l.title,buyer.name AS buyer_name,s.business_name,
 (SELECT m.body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message,
 (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>$1 AND m.created_at>CASE WHEN c.buyer_id=$1 THEN c.buyer_read_at ELSE c.seller_read_at END) AS unread,
 EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=CASE WHEN c.buyer_id=$1 THEN c.seller_id ELSE c.buyer_id END) OR (b.blocked_id=$1 AND b.blocker_id=CASE WHEN c.buyer_id=$1 THEN c.seller_id ELSE c.buyer_id END)) AS blocked,
 EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_id=$1 AND b.blocked_id=CASE WHEN c.buyer_id=$1 THEN c.seller_id ELSE c.buyer_id END) AS blocked_by_me
 FROM conversations c JOIN listings l ON l.id=c.listing_id JOIN users buyer ON buyer.id=c.buyer_id JOIN sellers s ON s.user_id=c.seller_id WHERE c.buyer_id=$1 OR c.seller_id=$1 ORDER BY c.created_at DESC LIMIT 100`,
        [res.locals.user.id],
      ),
    );
  const startConversation: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = z.object({ listing_id: z.uuid() }).parse(req.body);
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
    });
  const listMessages: RequestHandler = async (req, res) => {
    const c = await conversation(db, req.params.id as string, res.locals.user.id);
    const cursor = z.object({ before: z.iso.datetime().optional() }).parse(req.query);
    const rows = await db.query(
      `SELECT id,sender_id,body,created_at FROM messages WHERE conversation_id=$1${cursor.before ? ' AND created_at<$2' : ''} ORDER BY created_at DESC,id DESC LIMIT 50`,
      cursor.before ? [c.id, cursor.before] : [c.id],
    );
    res.json({
      messages: rows.reverse(),
      peer_read_at: c.buyer_id === res.locals.user.id ? c.seller_read_at : c.buyer_read_at,
      has_more: rows.length === 50,
    });
  };
  const markConversationRead: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const c = await conversation(q, req.params.id as string, u.id);
      await q.query(
        `UPDATE conversations SET ${u.id === c.buyer_id ? 'buyer_read_at' : 'seller_read_at'}=now() WHERE id=$1`,
        [c.id],
      );
      return { ok: true };
    });
  const sendMessage: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
      const c = await conversation(q, req.params.id as string, u.id);
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
        `You have a new message about ${c.title || 'a produce listing'}. Open Farmers Market to read it.`,
      );
      return message;
    });
  const listBlocks: RequestHandler = async (_req, res) =>
    res.json(
      (
        await db.prisma.userBlock.findMany({
          where: { blocker_id: res.locals.user.id },
          select: { blocked_id: true, blocked: { select: { name: true } } },
        })
      ).map((b) => ({ blocked_id: b.blocked_id, name: b.blocked.name })),
    );
  const blockUser: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      ensure(req.params.id !== u.id, 400, 'INVALID_BLOCK', 'You cannot block yourself.');
      const target = await q.prisma.user.findUnique({
        where: { id: String(req.params.id) },
        select: { id: true },
      });
      ensure(target, 404, 'NOT_FOUND', 'Account not found.');
      await q.prisma.userBlock.upsert({
        where: { blocker_id_blocked_id: { blocker_id: u.id, blocked_id: target.id } },
        create: { blocker_id: u.id, blocked_id: target.id },
        update: {},
      });
      return { ok: true };
    });
  const unblockUser: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      await q.prisma.userBlock.deleteMany({
        where: { blocker_id: u.id, blocked_id: String(req.params.id) },
      });
      return { ok: true };
    });
  const createReport: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = z
        .object({
          subject_type: z.enum(['listing', 'conversation', 'user']),
          subject_id: z.uuid(),
          reason: z.string().trim().min(5).max(2000),
        })
        .parse(req.body);
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
    });
  const listFavourites: RequestHandler = async (_req, res) =>
    res.json(
      (
        await db.prisma.favourite.findMany({
          where: { buyer_id: res.locals.user.id, seller: { status: 'APPROVED' } },
          orderBy: { created_at: 'desc' },
          select: {
            seller: { select: { user_id: true, business_name: true, city: true, area: true } },
          },
        })
      ).map((f) => f.seller),
    );
  const addFavourite: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const s = await q.prisma.seller.findFirst({
        where: { user_id: String(req.params.id), status: 'APPROVED' },
        select: { user_id: true },
      });
      ensure(s, 404, 'NOT_FOUND', 'Seller not found.');
      await q.prisma.favourite.upsert({
        where: { buyer_id_seller_id: { buyer_id: u.id, seller_id: s.user_id } },
        create: { buyer_id: u.id, seller_id: s.user_id },
        update: {},
      });
      return { ok: true };
    });
  const removeFavourite: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      await q.prisma.favourite.deleteMany({
        where: { buyer_id: u.id, seller_id: String(req.params.id) },
      });
      return { ok: true };
    });
  const getSellerProfile: RequestHandler = async (req, res) => {
    const [s] = await db.query(
      "SELECT s.user_id,s.business_name,s.business_type,s.city,s.area,(SELECT ROUND(AVG(score),1) FROM ratings WHERE seller_id=s.user_id) AS rating_avg,(SELECT COUNT(*)::int FROM ratings WHERE seller_id=s.user_id) AS rating_count FROM sellers s WHERE s.user_id=$1 AND s.status='APPROVED'",
      [req.params.id],
    );
    ensure(s, 404, 'NOT_FOUND', 'Seller not found.');
    const ratings = await db.query(
      'SELECT r.score,r.comment,r.created_at,u.name AS buyer_name FROM ratings r JOIN users u ON u.id=r.buyer_id WHERE r.seller_id=$1 ORDER BY r.created_at DESC LIMIT 20',
      [s.user_id],
    );
    res.json({ ...s, ratings });
  };
  const getRating: RequestHandler = async (req, res) => {
    const [b] = await db.query('SELECT id FROM bookings WHERE id=$1 AND buyer_id=$2', [
      req.params.id,
      res.locals.user.id,
    ]);
    ensure(b, 404, 'NOT_FOUND', 'Booking not found.');
    const [rating] = await db.query(
      'SELECT score,comment FROM ratings WHERE booking_id=$1 AND buyer_id=$2',
      [b.id, res.locals.user.id],
    );
    res.json(rating || null);
  };
  const rateBooking: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = z
        .object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(1000) })
        .parse(req.body);
      const [b] = await q.query(
        "SELECT * FROM bookings WHERE id=$1 AND buyer_id=$2 AND status='COMPLETED'",
        [req.params.id, u.id],
      );
      ensure(b, 403, 'REVIEW_NOT_ALLOWED', 'Only the buyer can review a completed pickup.');
      const [existing] = await q.query(
        'SELECT id FROM ratings WHERE booking_id=$1 AND buyer_id=$2',
        [b.id, u.id],
      );
      ensure(!existing, 409, 'ALREADY_REVIEWED', 'You already reviewed this pickup.');
      await q.query(
        'INSERT INTO ratings(id,booking_id,buyer_id,seller_id,score,comment) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), b.id, u.id, b.seller_id, d.score, d.comment],
      );
      return { ok: true };
    });
  const listReports: RequestHandler = async (_req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    res.json(
      await db.query(
        'SELECT r.*,u.name AS reporter_name FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 100',
      ),
    );
  };
  const resolveReport: RequestHandler = async (req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return mutate(req, res, async (q, u) => {
      const d = z.object({ resolution: z.string().trim().min(5).max(2000) }).parse(req.body);
      const [r] = await q.query(
        "UPDATE reports SET status='RESOLVED',resolution=$1 WHERE id=$2 RETURNING *",
        [d.resolution, req.params.id],
      );
      ensure(r, 404, 'NOT_FOUND', 'Report not found.');
      await audit(q, u.id, 'report.resolve', r.id, d);
      return r;
    });
  };
  const listEmailQueue: RequestHandler = async (_req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    res.json(
      await db.query(
        'SELECT o.id,o.status,o.attempts,o.last_error,o.created_at,n.title,u.name AS recipient_name FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id JOIN users u ON u.id=n.user_id ORDER BY o.created_at DESC LIMIT 100',
      ),
    );
  };
  const retryEmail: RequestHandler = async (req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return mutate(req, res, async (q, u) => {
      const [job] = await q.query(
        "UPDATE notification_outbox SET status='PENDING',attempts=0,available_at=now(),locked_until=NULL WHERE id=$1 AND status='FAILED' RETURNING id",
        [req.params.id],
      );
      ensure(job, 409, 'NOT_RETRYABLE', 'Only failed jobs can be retried.');
      await audit(q, u.id, 'notification.retry', job.id);
      return { ok: true };
    });
  };
  const listUsers: RequestHandler = async (_req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    res.json(
      await db.query(
        'SELECT id,name,email,phone,status,admin,email_verified_at,created_at FROM users ORDER BY created_at DESC LIMIT 100',
      ),
    );
  };
  const setUserStatus: RequestHandler = async (req, res) => {
    ensure(res.locals.user.admin, 403, 'FORBIDDEN', 'Admin access required.');
    return mutate(req, res, async (q, u) => {
      const d = z
        .object({
          status: z.enum(['ACTIVE', 'SUSPENDED']),
          reason: z.string().trim().min(5).max(500),
        })
        .parse(req.body);
      ensure(req.params.id !== u.id, 400, 'OWN_ACCOUNT', 'You cannot suspend your own account.');
      const [target] = await q.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
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
    });
  };
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
    resolveReport,
    listEmailQueue,
    retryEmail,
    listUsers,
    setUserStatus,
  };
}
