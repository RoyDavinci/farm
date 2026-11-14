import type { RequestHandler } from 'express';
import { audit } from '../services/audit.service.js';
import { profile, publicUser, tokenHash } from '../services/auth.service.js';
import { paymentService, type Provider } from '../services/payment-provider.service.js';
import { allowedAreas } from '../services/staff.service.js';
import type { AppDeps } from '../types/deps.js';

const bearer = (header?: string) => (header || '').replace(/^Bearer /, '');

/** The signed-in user: profile, device sessions, sign-out and public marketplace settings. */
export function createAccountController(deps: AppDeps) {
  const { db, config: c, mutate } = deps;
  const payments = paymentService(c);

  const getMe: RequestHandler = async (_req, res) => {
    const u = res.locals.user;
    const seller = await db.prisma.seller.findUnique({ where: { user_id: u.id } });
    res.json({
      user: u,
      seller,
      ...(u.admin ? { staff_areas: allowedAreas(u.staff_role) } : {}),
    });
  };

  const updateMe: RequestHandler = (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = profile.parse(req.body);
      const updated = await q.prisma.user.update({
        where: { id: u.id },
        data: { name: d.name, phone: d.phone },
      });
      await audit(q, u.id, 'profile.update', u.id);
      return publicUser(updated);
    });

  const listSessions: RequestHandler = async (req, res) => {
    const current = tokenHash(bearer(req.headers.authorization));
    const sessions = await db.prisma.session.findMany({
      where: { user_id: res.locals.user.id, refresh_expires_at: { gt: new Date() } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        device_label: true,
        created_at: true,
        last_seen_at: true,
        token_hash: true,
      },
    });
    res.json(sessions.map(({ token_hash, ...s }) => ({ ...s, current: token_hash === current })));
  };

  const revokeSession: RequestHandler = (req, res) =>
    mutate(req, res, async (q, u) => {
      const id = String(req.params.id);
      await q.prisma.session.deleteMany({ where: { id, user_id: u.id } });
      await audit(q, u.id, 'session.revoke', id);
      return { ok: true };
    });

  const logout: RequestHandler = async (req, res) => {
    await db.prisma.session.deleteMany({
      where: { token_hash: tokenHash(bearer(req.headers.authorization)) },
    });
    res.json({ ok: true });
  };

  const getSettings: RequestHandler = async (_req, res) => {
    const settings = await db.prisma.setting.findUniqueOrThrow({ where: { id: 1 } });
    res.json({
      ...settings,
      stock_confirmation: 'immediate',
      payment_mode: c.demo ? 'demo' : c.payments ? 'provider' : 'disabled',
      providers: (['paystack', 'flutterwave'] as Provider[]).filter((p) => payments.enabled(p)),
    });
  };

  return { getMe, updateMe, listSessions, revokeSession, logout, getSettings };
}
