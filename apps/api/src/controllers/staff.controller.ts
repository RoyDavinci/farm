import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ensure } from '../lib/errors.js';
import { audit } from '../services/audit.service.js';
import { staffRoles } from '../services/staff.service.js';
import type { AppDeps } from '../types/deps.js';

export function createStaffController(deps: AppDeps) {
  const { db, mutate } = deps;

  const listStaff: RequestHandler = async (_req, res) =>
    res.json(
      await db.prisma.user.findMany({
        where: { admin: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, staff_role: true, status: true },
      }),
    );
  const setStaffRole: RequestHandler = async (req, res) =>
    mutate(req, res, async (q, u) => {
      const d = z
        .object({
          email: z.string().trim().toLowerCase().pipe(z.email()),
          role: z.enum(staffRoles).nullable(),
          reason: z.string().trim().min(3).max(300),
        })
        .parse(req.body);
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
    });
  return { listStaff, setStaffRole };
}
