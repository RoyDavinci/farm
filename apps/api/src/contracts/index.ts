import { refundResponses } from './refunds.js';
import { regionResponses } from './regions.js';
import { voiceResponses } from './voice.js';
import { parcelResponses } from './parcels.js';
import { returnsOperationsResponses } from './returns-operations.js';
import { discoveryOperationsResponses } from './discovery-operations.js';
import { deliveryOperationsResponses } from './delivery-operations.js';
import { marketOperationsResponses } from './market-operations.js';
import { statusBoostResponses } from './status-boost.js';
import { localStatusResponses } from './local-status.js';
import { shoppingResponses } from './shopping.js';
import { plannerResponses } from './planner.js';
import { businessResponses } from './business.js';
import { growthResponses } from './growth.js';
import type { z } from 'zod';
import { operationResponses } from './operations.js';
import { coreResponses } from './responses.js';

export * from './operations.js';
export * from './responses.js';

/**
 * Success response schema for every JSON operation, by operation id. Endpoints that return files
 * or HTML (photo/evidence/document downloads, the payment return page) are listed as non-JSON.
 */
export const responses: Record<string, z.ZodType> = {
  ...operationResponses,
  ...refundResponses,
  ...regionResponses,
  ...voiceResponses,
  ...parcelResponses,
  ...returnsOperationsResponses,
  ...discoveryOperationsResponses,
  ...deliveryOperationsResponses,
  ...marketOperationsResponses,
  ...shoppingResponses,
  ...plannerResponses,
  ...businessResponses,
  ...growthResponses,
  ...localStatusResponses,
  ...statusBoostResponses,
  ...coreResponses,
};
export const nonJsonOperations = new Set([
  'media.servePhoto',
  'shopping.receipt',
  'support.downloadEvidence',
  'support.downloadSignedEvidence',
  'verification.downloadDocument',
  'wallet.paymentReturnPage',
]);
