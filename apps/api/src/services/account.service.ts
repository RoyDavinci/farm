import { productUnits, productConditions, sellerTypes } from '../config/marketplace.js';
import type { Query } from '../database/client.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
import { profile, publicUser, tokenHash } from './auth.service.js';
import { paymentService, type Provider } from './payment-provider.service.js';
import { allowedAreas } from './staff.service.js';

const bearer = (header?: string) => (header || '').replace(/^Bearer /, '');

/** Business logic for account requests. HTTP-free: callers pass plain input. */
export function createAccountService(deps: AppDeps) {
  const { db, config: c } = deps;
  const payments = paymentService(c);
  async function getMe(user: any, input: RequestInput) {
    const u = user;
    const seller = await db.prisma.seller.findUnique({ where: { user_id: u.id } });
    const [pin] = await db.query(
      'SELECT transaction_pin_hash IS NOT NULL AS set FROM users WHERE id=$1',
      [u.id],
    );
    return {
      user: u,
      seller,
      transaction_pin_set: !!pin?.set,
      ...(u.admin ? { staff_areas: allowedAreas(u.staff_role) } : {}),
    };
  }
  async function updateMe(q: Query, u: any, input: RequestInput) {
    const d = profile.parse(input.body);
    const updated = await q.prisma.user.update({
      where: { id: u.id },
      data: { name: d.name, phone: d.phone },
    });
    await audit(q, u.id, 'profile.update', u.id);
    return publicUser(updated);
  }
  async function listSessions(user: any, input: RequestInput) {
    const current = tokenHash(bearer(input.headers.authorization));
    const sessions = await db.prisma.session.findMany({
      where: { user_id: user.id, refresh_expires_at: { gt: new Date() } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        device_label: true,
        created_at: true,
        last_seen_at: true,
        token_hash: true,
      },
    });
    return sessions.map(({ token_hash, ...s }) => ({ ...s, current: token_hash === current }));
  }
  async function revokeSession(q: Query, u: any, input: RequestInput) {
    const id = String(input.params.id);
    await q.prisma.session.deleteMany({ where: { id, user_id: u.id } });
    await audit(q, u.id, 'session.revoke', id);
    return { ok: true };
  }
  async function logout(user: any, input: RequestInput) {
    await db.prisma.session.deleteMany({
      where: { token_hash: tokenHash(bearer(input.headers.authorization)) },
    });
    return { ok: true };
  }
  async function getSettings(user: any, input: RequestInput) {
    const settings = await db.prisma.setting.findUniqueOrThrow({ where: { id: 1 } });
    return {
      ...settings,
      stock_confirmation: 'immediate',
      catalog: {
        categories: (
          await db.query('SELECT name FROM catalogue_categories WHERE active ORDER BY name')
        ).map((r) => r.name),
        seller_types: [...sellerTypes],
        units: [...productUnits],
        conditions: [...productConditions],
        /** Categories with their own commission rate (basis points); others use commission_bps. */
        commission_rates: Object.fromEntries(
          (
            await db.query(
              'SELECT name,commission_bps FROM catalogue_categories WHERE active AND commission_bps IS NOT NULL',
            )
          ).map((r: any) => [r.name, r.commission_bps]),
        ),
      },
      payment_mode: c.demo ? 'demo' : c.payments ? 'provider' : 'disabled',
      features: c.features,
      providers: (['paystack', 'flutterwave'] as Provider[]).filter((p) => payments.enabled(p)),
    };
  }
  return { getMe, updateMe, listSessions, revokeSession, logout, getSettings };
}
