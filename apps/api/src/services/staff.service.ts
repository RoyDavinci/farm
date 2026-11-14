export const staffRoles = ['owner', 'operations', 'finance', 'support'] as const;
export type StaffRole = (typeof staffRoles)[number];

/**
 * Which staff roles may use each admin area. The key is the first path segment after
 * /v1/admin/. Owners can do everything; areas not listed here are owner-only.
 */
export const permissions: Record<string, StaffRole[]> = {
  overview: ['operations', 'finance', 'support'],
  sellers: ['operations', 'support'],
  'seller-documents': ['operations'],
  listings: ['operations', 'support'],
  markets: ['operations'],
  promotions: ['operations', 'finance'],
  drivers: ['operations'],
  deliveries: ['operations', 'support'],
  bookings: ['operations', 'finance', 'support'],
  users: ['operations', 'support'],
  reports: ['operations', 'support'],
  'email-queue': ['support'],
  disputes: ['finance', 'support'],
  payouts: ['finance'],
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
