/**
 * What a shop's team members may do while working on the shop account (header X-Act-As-Seller).
 *
 * STAFF   — products, photos, stories, orders (accept, ready, hand over), chat, support cases.
 * MANAGER — everything staff can, plus cancelling orders, bulk upload and B2B quotes.
 * Nobody but the owner — money (payouts, wallet, bank accounts, anything paid from proceeds such
 * as sponsoring or featuring), plans and subscriptions, the
 * team itself, API keys and webhooks, verification, account settings, or anything in /admin.
 */
export type TeamRole = 'STAFF' | 'MANAGER';

const ownerOnly = [
  /^\/admin(\/|$)/,
  /^\/payouts(\/|$)/,
  /^\/wallet(\/|$)/,
  /^\/me\/(sessions|subscriptions|blocks|teams)(\/|$)/,
  /^\/me$/, // profile edits (reading /me is allowed below)
  /^\/sellers\/me\/(team|api-keys|webhooks|integrations|verification|featured|promotions)(\/|$)/,
  /^\/listings\/[^/]+\/promote$/,
  /^\/sellers$/,
  /^\/plans(\/|$)/,
  /^\/planner(\/|$)/,
  /^\/cart(\/|$)/,
  /^\/subscription-plans(\/|$)/,
];
/** Reads a member may make (everything not owner-only, plus these owner-only reads). */
const readsAllowed = [/^\/me$/, /^\/sellers\/me\/(featured|promotions|verification)$/];

const staffWrites = [
  /^\/listings$/,
  /^\/listings\/[^/]+$/,
  /^\/listings\/[^/]+\/(?!promote$)[^/]+(\/.*)?$/,
  /^\/media(\/|$)/,
  /^\/local-status(\/|$)/,
  /^\/bookings\/[^/]+\/(accept|decline|counter|ready|pickup|approve-change|decline-change|dispute)$/,
  /^\/conversations(\/|$)/,
  /^\/notifications\/read$/,
  /^\/disputes\/[^/]+\/(messages|evidence|return)$/,
  /^\/sellers\/me\/ai\/listing-assist$/,
];
const managerWrites = [
  ...staffWrites,
  /^\/bookings\/[^/]+\/cancel$/,
  /^\/sellers\/me\/listings\/import$/,
  /^\/rfqs\/[^/]+\/quotes$/,
];

/** True when a team member with this role may make this request on the shop's behalf. */
export function teamMayAccess(role: TeamRole, method: string, path: string) {
  const isRead = method === 'GET' || method === 'HEAD';
  if (isRead && readsAllowed.some((r) => r.test(path))) return true;
  if (ownerOnly.some((r) => r.test(path))) return false;
  if (isRead) return true;
  return (role === 'MANAGER' ? managerWrites : staffWrites).some((r) => r.test(path));
}
