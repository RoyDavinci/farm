import { createHash } from 'node:crypto';
import { z } from 'zod';
export const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  admin: boolean;
  staff_role: import('./staff.service.js').StaffRole | null;
  email_verified_at: Date | null;
}
type UserIdentity = Pick<
  import('../generated/prisma/client.js').User,
  'id' | 'name' | 'email' | 'phone' | 'admin' | 'staff_role' | 'email_verified_at'
>;
export const publicUser = (u: UserIdentity): AuthenticatedUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  admin: u.admin,
  staff_role: u.admin ? (u.staff_role as AuthenticatedUser['staff_role']) : null,
  email_verified_at: u.email_verified_at,
});
export const email = z.string().trim().toLowerCase().pipe(z.email());
export const password = z.string().min(10).max(100);
export const profile = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Use international phone format, e.g. +2348012345678'),
});
