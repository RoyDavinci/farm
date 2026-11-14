import type { RequestHandler } from 'express';
import type { Database } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import { publicUser, tokenHash } from '../services/auth.service.js';

/** Paths under /v1 that work without signing in. */
const PUBLIC = [
  (method: string, path: string) => method === 'GET' && path === '/settings',
  (_method: string, path: string) => path.startsWith('/webhooks/'),
  // Provider checkout redirects land here in a browser without an access token.
  (method: string, path: string) => method === 'GET' && path === '/payments/return',
];

/** Resolves the Bearer access token to an active user and stores it on res.locals.user. */
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
    res.locals.user = publicUser(session.user);
    next();
  };
}
