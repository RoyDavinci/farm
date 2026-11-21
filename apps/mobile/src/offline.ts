import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHEABLE = [
  /^\/me$/,
  /^\/bookings$/,
  /^\/wallet$/,
  /^\/settings$/,
  /^\/listings\?mine=true$/,
  /^\/notifications$/,
  /^\/conversations$/,
];
const CACHE_PREFIX = 'fm-cache:',
  DRAFT_PREFIX = 'fm-draft:',
  VERSION = 'v2:';
const CACHE_TTL = 5 * 60 * 1000,
  DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
const privateFields = new Set([
  'pickup_code',
  'pickup_address',
  'pickup_address_snapshot',
  'pickup_latitude',
  'pickup_longitude',
  'delivery_code',
  'delivery_pin',
  'pickup_pin',
  'address',
  'latitude',
  'longitude',
  'account_cipher',
  'password_hash',
  'profile_details',
  'return_pin',
  'permit_number',
  'insurance_reference',
]);
export interface CacheScope {
  readonly accountId: string;
  readonly epoch: number;
}
interface Envelope<T> {
  version: 2;
  accountId: string;
  expiresAt: number;
  data: T;
}
let accountId: string | null = null,
  epoch = 0,
  tail: Promise<unknown> = Promise.resolve();
let offline = false;
const listeners = new Set<(offline: boolean) => void>();
const valid = (scope: CacheScope | null): scope is CacheScope =>
  !!scope && scope.accountId === accountId && scope.epoch === epoch;
function serial<T>(operation: () => Promise<T>) {
  const next = tail.then(operation, operation);
  tail = next.catch(() => {});
  return next;
}
function key(prefix: string, scope: CacheScope, path: string) {
  return `${prefix}${VERSION}${encodeURIComponent(scope.accountId)}:${path}`;
}
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !privateFields.has(name))
      .map(([name, entry]) => [name, sanitize(entry)]),
  );
}
async function removeKeys(keepAccount?: string) {
  const keep = keepAccount ? `${VERSION}${encodeURIComponent(keepAccount)}:` : null;
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (k) =>
      (k.startsWith(CACHE_PREFIX) && (!keep || !k.startsWith(CACHE_PREFIX + keep))) ||
      (k.startsWith(DRAFT_PREFIX) && (!keep || !k.startsWith(DRAFT_PREFIX + keep))),
  );
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
export function cacheScope(): CacheScope | null {
  return accountId ? { accountId, epoch } : null;
}
/** Invalidates old requests synchronously; then drains writes before removing another account's data. */
export async function activateCacheAccount(id: string) {
  if (id === accountId) return;
  accountId = id;
  epoch++;
  await serial(() => removeKeys(id));
}
export async function forgetAll() {
  accountId = null;
  epoch++;
  setOffline(false);
  await serial(() => removeKeys());
}
export function onConnectivity(fn: (offline: boolean) => void) {
  listeners.add(fn);
  fn(offline);
  return () => void listeners.delete(fn);
}
export function setOffline(value: boolean) {
  if (value === offline) return;
  offline = value;
  listeners.forEach((fn) => fn(value));
}
export const cacheable = (path: string) => CACHEABLE.some((re) => re.test(path));
export async function remember(path: string, data: unknown, scope = cacheScope()) {
  if (!valid(scope)) return;
  const captured = scope;
  await serial(async () => {
    if (!valid(captured)) return;
    const envelope: Envelope<unknown> = {
      version: 2,
      accountId: captured.accountId,
      expiresAt: Date.now() + CACHE_TTL,
      data: sanitize(data),
    };
    await AsyncStorage.setItem(key(CACHE_PREFIX, captured, path), JSON.stringify(envelope));
  }).catch(() => {});
}
export async function recall<T>(path: string, scope = cacheScope()): Promise<T | null> {
  if (!valid(scope)) return null;
  const captured = scope;
  return serial(async () => {
    if (!valid(captured)) return null;
    const storageKey = key(CACHE_PREFIX, captured, path);
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw || !valid(captured)) return null;
    const envelope = JSON.parse(raw) as Envelope<T>;
    if (
      envelope.version !== 2 ||
      envelope.accountId !== captured.accountId ||
      !Number.isFinite(envelope.expiresAt) ||
      envelope.expiresAt <= Date.now()
    ) {
      await AsyncStorage.removeItem(storageKey);
      return null;
    }
    return valid(captured) ? envelope.data : null;
  }).catch(() => null);
}
export const drafts = {
  async load<T>(name: string): Promise<T | null> {
    const scope = cacheScope();
    if (!valid(scope)) return null;
    return serial(async () => {
      if (!valid(scope)) return null;
      const storageKey = key(DRAFT_PREFIX, scope, name),
        raw = await AsyncStorage.getItem(storageKey);
      if (!raw || !valid(scope)) return null;
      const envelope = JSON.parse(raw) as Envelope<T>;
      if (
        envelope.version !== 2 ||
        envelope.accountId !== scope.accountId ||
        envelope.expiresAt <= Date.now()
      ) {
        await AsyncStorage.removeItem(storageKey);
        return null;
      }
      return valid(scope) ? envelope.data : null;
    }).catch(() => null);
  },
  save(name: string, data: unknown) {
    const scope = cacheScope();
    if (!valid(scope)) return;
    void serial(async () => {
      if (!valid(scope)) return;
      await AsyncStorage.setItem(
        key(DRAFT_PREFIX, scope, name),
        JSON.stringify({
          version: 2,
          accountId: scope.accountId,
          expiresAt: Date.now() + DRAFT_TTL,
          data,
        } satisfies Envelope<unknown>),
      );
    }).catch(() => {});
  },
  clear(name: string) {
    const scope = cacheScope();
    if (!valid(scope)) return;
    void serial(async () => {
      if (valid(scope)) await AsyncStorage.removeItem(key(DRAFT_PREFIX, scope, name));
    }).catch(() => {});
  },
};
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof TypeError) && !String((e as Error).message).includes('reach')) throw e;
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i));
    }
  }
  throw last;
}
