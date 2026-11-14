import { Router, type RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { accountRoutes } from './account.routes.js';
import { adminRoutes } from './admin.routes.js';
import { authRoutes } from './auth.routes.js';
import { bookingsRoutes } from './bookings.routes.js';
import { communicationRoutes } from './communications.routes.js';
import { adminDeliveryRoutes, deliveryRoutes } from './deliveries.routes.js';
import { geographyRoutes } from './geography.routes.js';
import { marketplaceRoutes } from './marketplace.routes.js';
import { mediaRoutes, publicMediaRoutes } from './media.routes.js';
import { adminPayoutRoutes, payoutRoutes } from './payouts.routes.js';
import { adminPromotionRoutes, promotionRoutes } from './promotions.routes.js';
import { pushRoutes } from './push.routes.js';
import { retentionRoutes } from './retention.routes.js';
import { staffRoutes } from './staff.routes.js';
import { publicEvidenceRoutes, supportRoutes } from './support.routes.js';
import { publicDocumentRoutes, verificationRoutes } from './verification.routes.js';
import { walletRoutes } from './wallet.routes.js';

/** Unauthenticated resource URLs: product images and signed private-file links. */
export function publicFileRoutes(deps: AppDeps) {
  const r = Router();
  r.use('/media', publicMediaRoutes(deps));
  r.use('/files', publicEvidenceRoutes(deps));
  r.use('/files', publicDocumentRoutes(deps));
  return r;
}

/** Everything under /v1. Order matters where paths overlap, so keep it as listed. */
export function apiRoutes(
  deps: AppDeps,
  guards: {
    authenticate: RequestHandler;
    requireStaff: RequestHandler;
    authLimiter: RequestHandler;
  },
) {
  const r = Router();
  r.use('/auth', guards.authLimiter, authRoutes(deps));
  r.use(guards.authenticate);
  // Every admin path is checked against the user's staff role before any router can serve it.
  r.use('/admin', guards.requireStaff);

  r.use('/media', mediaRoutes(deps));
  r.use(communicationRoutes(deps));
  r.use(geographyRoutes(deps));
  r.use(supportRoutes(deps));
  r.use(payoutRoutes(deps));
  r.use(pushRoutes(deps));
  r.use(retentionRoutes(deps));
  r.use(verificationRoutes(deps));
  r.use(promotionRoutes(deps));
  r.use(deliveryRoutes(deps));
  r.use(accountRoutes(deps));
  r.use(marketplaceRoutes(deps));
  r.use(bookingsRoutes(deps));
  r.use(walletRoutes(deps));

  r.use('/admin', staffRoutes(deps));
  r.use('/admin', adminPromotionRoutes(deps));
  r.use('/admin', adminDeliveryRoutes(deps));
  r.use('/admin', adminPayoutRoutes(deps));
  r.use(adminRoutes(deps));
  return r;
}
