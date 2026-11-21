import { z } from 'zod';
import type { Query } from '../database/client.js';
import { ensure } from '../lib/errors.js';
import type { RequestInput } from '../lib/http.js';
import type { AppDeps } from '../types/deps.js';
import { audit } from './audit.service.js';
export const staffRoles = ['owner', 'operations', 'finance', 'support'] as const;
export type StaffRole = (typeof staffRoles)[number];

/**
 * Which staff roles may use each admin area. The key is the first path segment after
 * /v1/admin/. Owners can do everything; areas not listed here are owner-only.
 */
export const permissions: Record<string, StaffRole[]> = {
  catalogue: ['operations'],
  policies: [],
  regions: [],
  parcels: ['operations', 'support'],
  returns: ['finance', 'support'],
  appeals: ['finance', 'support'],
  analytics: ['operations', 'finance'],
  tariffs: [],
  incidents: ['operations', 'support'],
  overview: ['operations', 'finance', 'support'],
  sellers: ['operations', 'support'],
  'seller-documents': ['operations'],
  listings: ['operations', 'support'],
  markets: ['operations'],
  promotions: ['operations', 'finance'],
  drivers: ['operations'],
  deliveries: ['operations', 'support'],
  shopping: ['operations', 'finance', 'support'],
  'local-status': ['operations', 'support'],
  'status-boosts': ['operations', 'finance'],
  bookings: ['operations', 'finance', 'support'],
  users: ['operations', 'support'],
  reports: ['operations', 'support'],
  'email-queue': ['support'],
  disputes: ['finance', 'support'],
  payouts: ['finance'],
  refunds: ['finance'],
  reconciliation: ['finance'],
  funding: ['finance'],
  ledger: ['finance'],
  audit: ['operations', 'finance'],
  // settings, staff and vehicle-types (fares) are owner-only.
};

export function canAccess(role: StaffRole | null | undefined, area: string) {
  if (!role) return false;
  return role === 'owner' || (permissions[area] || []).includes(role);
}

/** Pages each role can open in the operations console; the console hides the rest. */
export function allowedAreas(role: StaffRole | null | undefined) {
  if (role === 'owner') return [...Object.keys(permissions), 'settings', 'staff', 'vehicle-types'];
  return Object.keys(permissions).filter((area) => canAccess(role, area));
}

/** Business logic for staff requests. HTTP-free: callers pass plain input. */
export function createStaffService(deps: AppDeps) {
  const { db } = deps;
  async function listStaff(user: any, input: RequestInput) {
    return await db.prisma.user.findMany({
      where: { admin: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, staff_role: true, status: true },
    });
  }
  async function setStaffRole(q: Query, u: any, input: RequestInput) {
    const d = z
      .object({
        email: z.string().trim().toLowerCase().pipe(z.email()),
        role: z.enum(staffRoles).nullable(),
        reason: z.string().trim().min(3).max(300),
      })
      .parse(input.body);
    const [target] = await q.query('SELECT * FROM users WHERE email=$1 FOR UPDATE', [d.email]);
    ensure(target, 404, 'NOT_FOUND', 'No account uses that email. Ask them to register first.');
    ensure(target.status === 'ACTIVE', 409, 'ACCOUNT_SUSPENDED', 'That account is suspended.');
    if (target.staff_role === 'owner' && d.role !== 'owner') {
      const [owners] = await q.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE admin AND staff_role='owner' AND status='ACTIVE'",
      );
      ensure(owners.n > 1, 409, 'LAST_OWNER', 'Keep at least one active owner.');
    }
    const [updated] = await q.query(
      'UPDATE users SET admin=$1,staff_role=$2 WHERE id=$3 RETURNING id,name,email,staff_role,status',
      [d.role !== null, d.role, target.id],
    );
    // Role changes take effect on the next request; revoke sessions when access is removed.
    if (d.role === null) await q.query('DELETE FROM sessions WHERE user_id=$1', [target.id]);
    await audit(q, u.id, 'staff.role', target.id, { role: d.role, reason: d.reason });
    return updated;
  }
  return { listStaff, setStaffRole };
}
