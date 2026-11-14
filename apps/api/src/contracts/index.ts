import type { z } from 'zod';
import { operationResponses } from './operations.js';
import { coreResponses } from './responses.js';

export * from './operations.js';
export * from './responses.js';

/**
 * Success response schema for every JSON operation, by operation id. Endpoints that return files
 * or HTML (photo/evidence/document downloads, the payment return page) are listed as non-JSON.
 */
export const responses: Record<string, z.ZodType> = { ...operationResponses, ...coreResponses };
export const nonJsonOperations = new Set([
  'media.servePhoto',
  'support.downloadEvidence',
  'support.downloadSignedEvidence',
  'verification.downloadDocument',
  'wallet.paymentReturnPage',
]);
