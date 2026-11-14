import type { NextFunction, Request, Response } from 'express';
import { ensure } from '../lib/errors.js';
import { canAccess } from '../services/staff.service.js';

/** Guards every /v1/admin route by staff role. Mount before any router that serves admin paths. */
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  const u = res.locals.user;
  ensure(u?.admin && u.staff_role, 403, 'FORBIDDEN', 'Administrator access required.');
  const area = req.path.split('/').filter(Boolean)[0] || '';
  ensure(
    canAccess(u.staff_role, area),
    403,
    'ROLE_FORBIDDEN',
    'Your staff role does not include this area. Ask an owner for access.',
  );
  next();
}
