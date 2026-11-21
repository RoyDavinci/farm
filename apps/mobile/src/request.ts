import { createRequest } from '@ahia/shared';
import { api } from './api';

/**
 * Typed API calls (see packages/shared/src/request.ts). Goes through `api()`, so token refresh,
 * retries and offline caching are unchanged.
 *   const booking = await request('get', '/bookings/{id}', { params: { id } });
 */
export const request = createRequest(api);
