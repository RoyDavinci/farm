import { regionRoutes, adminRegionRoutes } from './regions.routes.js';
import { adminRefundRoutes } from './refunds.routes.js';
import { voiceRoutes } from './voice.routes.js';
import { cartRoutes } from './cart.routes.js';
import { plannerRoutes } from './planner.routes.js';
import { parcelRoutes, adminParcelRoutes } from './parcels.routes.js';
import {
  returnsOperationsRoutes,
  adminReturnsOperationsRoutes,
} from './returns-operations.routes.js';
import {
  discoveryOperationsRoutes,
  adminDiscoveryOperationsRoutes,
} from './discovery-operations.routes.js';
import {
  deliveryOperationsRoutes,
  adminDeliveryOperationsRoutes,
} from './delivery-operations.routes.js';
import { marketOperationsRoutes, adminMarketOperationsRoutes } from './market-operations.routes.js';
import { statusBoostRoutes, adminStatusBoostRoutes } from './status-boost.routes.js';
import { localStatusRoutes, adminLocalStatusRoutes } from './local-status.routes.js';
import { shoppingRoutes, adminShoppingRoutes, publicShoppingRoutes } from './shopping.routes.js';
import { Router, type RequestHandler } from 'express';
import type { AppDeps } from '../types/deps.js';
import { disabledFeatureFor } from '../config/features.js';
import { AppError } from '../lib/errors.js';
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
  r.use('/files', publicShoppingRoutes(deps));
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
  // Switched-off features (see config/features.ts) answer as if their routes did not exist.
  r.use((req, _res, next) => {
    const feature = disabledFeatureFor(deps.config.features, req.path);
    if (feature)
      return next(new AppError(404, 'FEATURE_DISABLED', 'This feature is not available yet.'));
    next();
  });

  r.use('/media', mediaRoutes(deps));
  r.use(voiceRoutes(deps));
  r.use(communicationRoutes(deps));
  r.use(geographyRoutes(deps));
  r.use(returnsOperationsRoutes(deps));
  r.use(supportRoutes(deps));
  r.use(payoutRoutes(deps));
  r.use(pushRoutes(deps));
  r.use(discoveryOperationsRoutes(deps));
  r.use(retentionRoutes(deps));
  r.use(verificationRoutes(deps));
  r.use(promotionRoutes(deps));
  r.use(deliveryOperationsRoutes(deps));
  r.use(deliveryRoutes(deps));
  r.use(parcelRoutes(deps));
  r.use(shoppingRoutes(deps));
  r.use(localStatusRoutes(deps));
  r.use(statusBoostRoutes(deps));
  r.use(marketOperationsRoutes(deps));
  r.use(regionRoutes(deps));
  r.use(accountRoutes(deps));
  r.use(marketplaceRoutes(deps));
  r.use(bookingsRoutes(deps));
  r.use(cartRoutes(deps));
  r.use(plannerRoutes(deps));
  r.use(walletRoutes(deps));

  r.use('/admin', adminMarketOperationsRoutes(deps));
  r.use('/admin', adminDiscoveryOperationsRoutes(deps));
  r.use('/admin', adminReturnsOperationsRoutes(deps));
  r.use('/admin', adminParcelRoutes(deps));
  r.use('/admin', adminRegionRoutes(deps));
  r.use('/admin', staffRoutes(deps));
  r.use('/admin', adminPromotionRoutes(deps));
  r.use('/admin', adminDeliveryOperationsRoutes(deps));
  r.use('/admin', adminDeliveryRoutes(deps));
  r.use('/admin', adminShoppingRoutes(deps));
  r.use('/admin', adminLocalStatusRoutes(deps));
  r.use('/admin', adminStatusBoostRoutes(deps));
  r.use('/admin', adminPayoutRoutes(deps));
  r.use('/admin', adminRefundRoutes(deps));
  r.use(adminRoutes(deps));
  return r;
}
