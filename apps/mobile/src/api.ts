import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  activateCacheAccount,
  cacheable,
  cacheScope,
  forgetAll,
  recall,
  remember,
  setOffline,
} from './offline';
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  // On Render the API's hostname arrives as EXPO_PUBLIC_API_HOST (inlined at build time).
  (process.env.EXPO_PUBLIC_API_HOST ? `https://${process.env.EXPO_PUBLIC_API_HOST}/v1` : '') ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:4000/v1' : 'http://localhost:4000/v1');
let expiredHandler: () => void = () => {};
export function onSessionExpired(handler: () => void) {
  expiredHandler = handler;
  return () => {
    expiredHandler = () => {};
  };
}
let token = '',
  refreshToken = '';
/**
 * Team members work on a shop by sending X-Act-As-Seller with each request. The server limits
 * what they can do by role; if they lose access we drop back to their own account.
 */
let actingSeller = '';
let actingHandler: (message: string) => void = () => {};
export function actingAs() {
  return actingSeller;
}
export async function actAsSeller(sellerId: string) {
  actingSeller = sellerId;
  await put('fm-act-as', sellerId);
}
export function onTeamAccessLost(handler: (message: string) => void) {
  actingHandler = handler;
  return () => {
    actingHandler = () => {};
  };
}
let refreshing: Promise<void> | null = null;
async function put(key: string, value: string) {
  if (Platform.OS === 'web') {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } else if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}
async function get(key: string) {
  return Platform.OS === 'web'
    ? sessionStorage.getItem(key) || ''
    : (await SecureStore.getItemAsync(key)) || '';
}
/**
 * Device tokens, one per email, from a completed sign-in code. Sending one with the password
 * signs in without a new code. They outlive sign-out (on web they stay in localStorage).
 */
const DEVICE_KEY = 'fm-devices';
async function readDevices(): Promise<Record<string, string>> {
  try {
    const raw =
      Platform.OS === 'web'
        ? localStorage.getItem(DEVICE_KEY)
        : await SecureStore.getItemAsync(DEVICE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
export async function deviceToken(email: string) {
  return (await readDevices())[email.trim().toLowerCase()] || undefined;
}
export async function rememberDevice(email: string, token: string) {
  const all = { ...(await readDevices()), [email.trim().toLowerCase()]: token };
  const raw = JSON.stringify(all);
  try {
    if (Platform.OS === 'web') localStorage.setItem(DEVICE_KEY, raw);
    else await SecureStore.setItemAsync(DEVICE_KEY, raw);
  } catch {
    // Without storage the next sign-in simply asks for a code again.
  }
}
let accountId = '',
  sessionEpoch = 0;
let credentialsTail: Promise<unknown> = Promise.resolve();
class SessionChangedError extends Error {
  constructor() {
    super('Your sign-in session changed. Please retry.');
  }
}
function persistCredentials(expectedEpoch: number) {
  const values = { token, refreshToken, accountId };
  const write = credentialsTail.then(async () => {
    if (expectedEpoch !== sessionEpoch) return;
    await Promise.all([
      put('fm-token', values.token),
      put('fm-refresh', values.refreshToken),
      put('fm-account-id', values.accountId),
    ]);
  });
  credentialsTail = write.catch(() => {});
  return write;
}
export async function saveSession(data: {
  token: string;
  refresh_token: string;
  user?: { id: string };
}) {
  sessionEpoch++;
  token = data.token;
  refreshToken = data.refresh_token;
  actingSeller = '';
  await put('fm-act-as', '');
  accountId = data.user?.id || '';
  const expected = sessionEpoch;
  if (accountId) await activateCacheAccount(accountId);
  else await forgetAll();
  await persistCredentials(expected);
}
export async function restoreToken() {
  const expected = sessionEpoch;
  const restored = await Promise.all([
    get('fm-token'),
    get('fm-refresh'),
    get('fm-account-id'),
    get('fm-act-as'),
  ]);
  if (expected !== sessionEpoch) return false;
  [token, refreshToken, accountId, actingSeller] = restored;
  if (accountId) await activateCacheAccount(accountId);
  else await forgetAll();
  return !!(token || refreshToken);
}
export async function saveToken(value: string) {
  if (!value)
    await import('./backgroundTracking').then((m) => m.stopBackgroundTracking()).catch(() => {});
  sessionEpoch++;
  token = value;
  refreshToken = '';
  actingSeller = '';
  void put('fm-act-as', '');
  accountId = '';
  refreshing = null;
  const expected = sessionEpoch;
  // Invalidate cached reads and in-flight writes before awaiting any storage operation.
  const clearing = forgetAll();
  await Promise.all([clearing, persistCredentials(expected)]);
}
async function renew(expectedEpoch: number) {
  if (!refreshToken) throw new Error('Please sign in again.');
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const d = await res.json();
  if (expectedEpoch !== sessionEpoch) throw new SessionChangedError();
  if (!res.ok) {
    if (res.status === 401) {
      await saveToken('');
      expiredHandler();
    }
    throw new Error(d.error?.message || 'Could not renew your session. Please retry.');
  }
  token = d.token;
  refreshToken = d.refresh_token;
  await persistCredentials(expectedEpoch);
  if (expectedEpoch !== sessionEpoch) throw new SessionChangedError();
}
/**
 * A random id for this install, sent with every signed-in request so the server can spot several
 * accounts on one phone (fraud checks). It identifies the install, nothing about the person.
 */
let installId: Promise<string> | null = null;
function deviceId() {
  installId ??= AsyncStorage.getItem('fm-install-id')
    .then(async (v) => {
      if (v) return v;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem('fm-install-id', id);
      return id;
    })
    .catch(() => '');
  return installId;
}
async function authenticatedFetch(path: string, options: RequestInit, allowRefresh = true) {
  const expected = sessionEpoch;
  const device = await deviceId();
  options.headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(actingSeller ? { 'X-Act-As-Seller': actingSeller } : {}),
    ...(device ? { 'X-Device-Id': device } : {}),
  };
  let res = await fetch(`${API_URL}${path}`, options);
  if (expected !== sessionEpoch) throw new SessionChangedError();
  if (res.status === 401 && allowRefresh && !path.startsWith('/auth/') && refreshToken) {
    if (!refreshing) {
      const pending = renew(expected);
      refreshing = pending;
      void pending
        .finally(() => {
          if (refreshing === pending) refreshing = null;
        })
        .catch(() => {});
    }
    await refreshing;
    if (expected !== sessionEpoch) throw new SessionChangedError();
    options.headers = { ...options.headers, Authorization: `Bearer ${token}` };
    res = await fetch(`${API_URL}${path}`, options);
  }
  if (expected !== sessionEpoch) throw new SessionChangedError();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    await saveToken('');
    expiredHandler();
  }
  return res;
}
/** An API error with the server's machine-readable code (e.g. FUNDING_IN_PROGRESS). */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
/**
 * Calls the API. Writes get a fresh Idempotency-Key unless `options.idempotencyKey` is given:
 * pass the same key when retrying one user action so the server never repeats it.
 */
export async function api<T = any>(
  path: string,
  method = 'GET',
  body?: unknown,
  requestOptions: { idempotencyKey?: string } = {},
): Promise<T> {
  const requestScope = cacheScope();
  const requestEpoch = sessionEpoch;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET'
        ? { 'Idempotency-Key': requestOptions.idempotencyKey || Crypto.randomUUID() }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let response: Response;
  try {
    response = await authenticatedFetch(path, options);
  } catch (e) {
    if (
      e instanceof SessionChangedError ||
      requestEpoch !== sessionEpoch ||
      (e as Error).message.includes('sign in')
    )
      throw e;
    try {
      response = await authenticatedFetch(path, options);
    } catch (error) {
      if (error instanceof SessionChangedError || requestEpoch !== sessionEpoch) throw error;
      setOffline(true);
      // Offline: show the last saved copy of read-only screens instead of an error.
      if (method === 'GET' && cacheable(path)) {
        const cached = await recall<T>(path, requestScope);
        if (cached !== null) return cached;
      }
      throw new Error('Cannot reach Ahia. Please check your connection.');
    }
  }
  setOffline(false);
  const d = await response.json();
  const code = d?.error?.code;
  if (!response.ok && actingSeller && (code === 'NOT_ON_TEAM' || code === 'TEAM_PLAN_REQUIRED')) {
    await actAsSeller('');
    actingHandler(d?.error?.message || '');
  }
  if (!response.ok)
    throw new ApiError(
      d.error?.message || 'Request failed.',
      d.error?.code || 'ERROR',
      response.status,
    );
  if (requestEpoch !== sessionEpoch) throw new SessionChangedError();
  let scope = requestScope;
  if (path === '/me' && typeof d?.user?.id === 'string' && d.user.id !== accountId) {
    accountId = d.user.id;
    await activateCacheAccount(accountId);
    await persistCredentials(sessionEpoch);
    scope = cacheScope();
  }
  if (method === 'GET' && cacheable(path)) await remember(path, d, scope);
  return d;
}
export async function uploadPhoto(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  file?: File;
}) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const file = asset.file || (await (await fetch(asset.uri)).blob());
    form.append('image', file, asset.fileName || 'produce.jpg');
  } else
    form.append('image', {
      uri: asset.uri,
      name: asset.fileName || 'produce.jpg',
      type: asset.mimeType || 'image/jpeg',
    } as any);
  const res = await authenticatedFetch('/media', { method: 'POST', body: form });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message || 'Photo upload failed.');
  return d as { id: string; url: string; thumbnail_url: string };
}
// Tokens are sent in the first encrypted WS frame, never in a URL or access log.
export function liveUpdates(onSync: () => void) {
  let stopped = false,
    socket: WebSocket | undefined,
    retry: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    try {
      await api('/me');
      if (stopped) return;
      socket = new WebSocket(API_URL.replace(/^http/, 'ws').replace(/\/v1\/?$/, '/ws'));
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'authenticate', token }));
      socket.onmessage = (e) => {
        try {
          if (JSON.parse(e.data).type === 'sync') onSync();
        } catch {}
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(() => void connect(), 5000);
      };
      socket.onerror = () => socket?.close();
    } catch {
      if (!stopped) retry = setTimeout(() => void connect(), 10000);
    }
  };
  void connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}
export async function uploadStatusVideo(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  file?: File;
}) {
  const form = new FormData();
  if (Platform.OS === 'web')
    form.append(
      'video',
      asset.file || (await (await fetch(asset.uri)).blob()),
      asset.fileName || 'status.mp4',
    );
  else
    form.append('video', {
      uri: asset.uri,
      name: asset.fileName || 'status.mp4',
      type: asset.mimeType || 'video/mp4',
    } as any);
  const response = await authenticatedFetch('/media/status-video', { method: 'POST', body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Video upload failed.');
  return data as {
    url: string;
    thumbnail_url: string;
    media_type: 'VIDEO';
    duration_seconds: number;
  };
}
export async function uploadEvidence(
  disputeId: string,
  asset: { uri: string; mimeType?: string | null; fileName?: string | null; file?: File },
) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const file = asset.file || (await (await fetch(asset.uri)).blob());
    form.append('file', file, asset.fileName || 'evidence.jpg');
  } else
    form.append('file', {
      uri: asset.uri,
      name: asset.fileName || 'evidence.jpg',
      type: asset.mimeType || 'image/jpeg',
    } as any);
  const response = await authenticatedFetch(`/disputes/${disputeId}/evidence`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Evidence upload failed.');
  return data;
}
export async function uploadShoppingReceipt(
  requestId: string,
  asset: { uri: string; mimeType?: string | null; fileName?: string | null; file?: File },
) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const file = asset.file || (await (await fetch(asset.uri)).blob());
    form.append('file', file, asset.fileName || 'receipt.jpg');
  } else
    form.append('file', {
      uri: asset.uri,
      name: asset.fileName || 'receipt.jpg',
      type: asset.mimeType || 'image/jpeg',
    } as any);
  const response = await authenticatedFetch(`/shopping/${requestId}/receipts`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Receipt upload failed.');
  return data;
}
export async function uploadSellerDocument(
  kind: string,
  asset: { uri: string; mimeType?: string | null; name?: string | null; file?: File },
  subject: 'seller' | 'driver' = 'seller',
) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('subject', subject);
  if (Platform.OS === 'web') {
    const file = asset.file || (await (await fetch(asset.uri)).blob());
    form.append('file', file, asset.name || 'document');
  } else
    form.append('file', {
      uri: asset.uri,
      name: asset.name || 'document',
      type: asset.mimeType || 'application/octet-stream',
    } as any);
  const response = await authenticatedFetch('/sellers/me/documents', {
    method: 'POST',
    body: form,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Document upload failed.');
  return data;
}
