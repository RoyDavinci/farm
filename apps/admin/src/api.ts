const base = import.meta.env.VITE_API_URL || '/v1';
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
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
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
  if (!response.ok) throw new Error(data.error?.message || 'Request failed.');
  return data;
}
