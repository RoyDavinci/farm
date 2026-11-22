import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Database } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import { publicUser, tokenHash } from '../services/auth.service.js';
import { teamMayAccess, type TeamRole } from '../services/team-access.js';

/** Paths under /v1 that work without signing in. */
const PUBLIC = [
  (method: string, path: string) => method === 'GET' && path === '/settings',
  (_method: string, path: string) => path.startsWith('/webhooks/'),
  // Provider checkout redirects land here in a browser without an access token.
  (method: string, path: string) => method === 'GET' && path === '/payments/return',
];

/**
 * Resolves the Bearer access token to an active user and stores it on res.locals.user.
 *
 * A shop's team member can work on the shop account by sending X-Act-As-Seller: <shop owner id>.
 * The request then runs as the shop (so orders, listings and chats are the shop's), limited by the
 * member's role (see services/team-access.ts), and every change is written to team_activity.
 */
export function authenticate(db: Database): RequestHandler {
  return async (req, res, next) => {
    if (PUBLIC.some((allowed) => allowed(req.method, req.path))) return next();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    ensure(token, 401, 'UNAUTHENTICATED', 'Please sign in.');
    const session = await db.prisma.session.findFirst({
      where: {
        token_hash: tokenHash(token),
        expires_at: { gt: new Date() },
        user: { status: 'ACTIVE' },
      },
      include: { user: true },
    });
    ensure(session, 401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in.');
    const member = publicUser(session.user);
    const shopId = String(req.headers['x-act-as-seller'] || '');
    if (!shopId || shopId === member.id) {
      res.locals.user = member;
      return next();
    }
    const [team] = await db.query(
      `SELECT m.role FROM seller_team_members m JOIN sellers s ON s.user_id=m.seller_id JOIN users o ON o.id=s.user_id
       WHERE m.seller_id=$1 AND m.user_id=$2 AND s.status='APPROVED' AND o.status='ACTIVE'`,
      [shopId, member.id],
    );
    ensure(team, 403, 'NOT_ON_TEAM', 'You are no longer on this shop’s team.');
    // Team access needs the shop to keep a plan with team seats.
    const [plan] = await db.query(
      `SELECT 1 FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
       WHERE s.user_id=$1 AND s.status='ACTIVE' AND s.ends_at>now() AND COALESCE((p.features->>'team_seats')::int,0)>0 LIMIT 1`,
      [shopId],
    );
    ensure(
      plan,
      402,
      'TEAM_PLAN_REQUIRED',
      'The shop’s plan no longer includes team accounts. Ask the owner.',
    );
    const role = team.role as TeamRole;
    ensure(
      teamMayAccess(role, req.method, req.path),
      403,
      'TEAM_ROLE_FORBIDDEN',
      'Your team role can’t do this. Ask the shop owner.',
    );
    const owner = await db.prisma.user.findUnique({ where: { id: shopId } });
    ensure(owner, 403, 'NOT_ON_TEAM', 'This shop is no longer available.');
    res.locals.user = {
      ...publicUser(owner),
      // Team members never get the owner's staff (admin) rights.
      admin: false,
      staff_role: null,
      acting_member: { id: member.id, name: member.name, role },
    };
    if (req.method !== 'GET' && req.method !== 'HEAD')
      res.on('finish', () => {
        void db
          .query(
            'INSERT INTO team_activity(id,seller_id,member_id,role,method,path,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              randomUUID(),
              shopId,
              member.id,
              role,
              req.method,
              req.path.slice(0, 300),
              res.statusCode,
            ],
          )
          .catch(() => {});
      });
    next();
  };
}
