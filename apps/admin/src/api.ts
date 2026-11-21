import { createRequest } from '@ahia/shared';
// VITE_API_URL wins; on Render the API's hostname arrives as VITE_API_HOST.
const base =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.VITE_API_HOST ? `https://${import.meta.env.VITE_API_HOST}/v1` : '/v1');
let expiredHandler: () => void = () => {};
export function onSessionExpired(handler: () => void) {
  expiredHandler = handler;
  return () => {
    expiredHandler = () => {};
  };
}
let token = sessionStorage.getItem('fm-admin-token') || '',
  refresh = sessionStorage.getItem('fm-admin-refresh') || '';
let renewing: Promise<void> | null = null;
export function saveToken(value: string) {
  token = value;
  if (value) sessionStorage.setItem('fm-admin-token', value);
  else {
    refresh = '';
    sessionStorage.removeItem('fm-admin-token');
    sessionStorage.removeItem('fm-admin-refresh');
  }
}
export function saveSession(d: { token: string; refresh_token: string }) {
  saveToken(d.token);
  refresh = d.refresh_token;
  sessionStorage.setItem('fm-admin-refresh', refresh);
}
async function renew() {
  const r = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  const d = await r.json();
  if (!r.ok) {
    saveToken('');
    expiredHandler();
    throw new Error('Please sign in again.');
  }
  saveSession(d);
}
/** An API error with the server's machine-readable code. */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = 'GET',
  body?: unknown,
  requestOptions: { idempotencyKey?: string } = {},
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET'
        ? { 'Idempotency-Key': requestOptions.idempotencyKey || crypto.randomUUID() }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let response = await fetch(`${base}${path}`, options);
  if (response.status === 401 && refresh && !path.startsWith('/auth/')) {
    if (!renewing)
      renewing = renew().finally(() => {
        renewing = null;
      });
    await renewing;
    options.headers = { ...options.headers, Authorization: `Bearer ${token}` };
    response = await fetch(`${base}${path}`, options);
  }
  if (response.status === 401 && !path.startsWith('/auth/')) {
    saveToken('');
    expiredHandler();
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error?.message || 'Request failed.',
      data.error?.code || 'ERROR',
      response.status,
    );
  return data;
}

/** Typed API calls from the contract: request('get', '/admin/payouts'). */
export const request = createRequest(api);
