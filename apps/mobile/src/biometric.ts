import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { request } from './request';

/**
 * Fingerprint (or face) confirmation for payments. Turning it on needs the transaction PIN once:
 * the server then issues a device key, kept in this phone's secure storage. Paying, sending or
 * withdrawing reads the key only after the fingerprint matches, and sends it in place of the PIN.
 * Changing the PIN turns it off on every phone. Phone app only; the website keeps the PIN.
 */
const keyName = (userId: string) => `ahia-bio-${userId}`;

export async function biometricSupported() {
  if (Platform.OS === 'web') return false;
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

export async function biometricOn(userId: string) {
  if (Platform.OS === 'web') return false;
  return !!(await SecureStore.getItemAsync(keyName(userId)).catch(() => null));
}

/** Asks for the fingerprint; returns the key to send instead of the PIN, or null. */
export async function biometricKey(userId: string, reason = 'Confirm with your fingerprint') {
  if (Platform.OS === 'web') return null;
  const key = await SecureStore.getItemAsync(keyName(userId)).catch(() => null);
  if (!key) return null;
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Use PIN',
    disableDeviceFallback: true,
  });
  return r.success ? key : null;
}

export async function turnOnBiometric(userId: string, pin: string) {
  const check = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Touch the sensor to turn on fingerprint payments',
    disableDeviceFallback: true,
  });
  if (!check.success) throw new Error('Fingerprint not confirmed. Try again.');
  const r = (await request('post', '/me/biometrics', {
    body: {
      transaction_pin: pin,
      device_name: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} phone`,
    },
  })) as { id: string; key: string };
  await SecureStore.setItemAsync(keyName(userId), r.key);
  await SecureStore.setItemAsync(`${keyName(userId)}-id`, r.id);
}

export async function turnOffBiometric(userId: string) {
  const id = await SecureStore.getItemAsync(`${keyName(userId)}-id`).catch(() => null);
  if (id) await request('delete', '/me/biometrics/{id}', { params: { id } }).catch(() => {});
  await SecureStore.deleteItemAsync(keyName(userId)).catch(() => {});
  await SecureStore.deleteItemAsync(`${keyName(userId)}-id`).catch(() => {});
}

// ---- Fingerprint sign-in --------------------------------------------------------------------
const LOGIN_KEY = 'ahia-login-key';
type SavedLogin = { key: string; id: string; name: string };

/** The account this phone can sign in to with a fingerprint, if turned on. */
export async function savedFingerprintLogin(): Promise<SavedLogin | null> {
  if (Platform.OS === 'web') return null;
  try {
    const raw = await SecureStore.getItemAsync(LOGIN_KEY);
    return raw ? (JSON.parse(raw) as SavedLogin) : null;
  } catch {
    return null;
  }
}

/** Asks for the fingerprint, then signs in. Returns the session, or null if cancelled. */
export async function fingerprintSignIn() {
  const saved = await savedFingerprintLogin();
  if (!saved) return null;
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: `Sign in as ${saved.name}`,
    cancelLabel: 'Use password',
    disableDeviceFallback: true,
  });
  if (!r.success) return null;
  try {
    return (await request('post', '/auth/biometric', { body: { key: saved.key } })) as any;
  } catch (e) {
    // Turned off elsewhere (a new password): forget it here too.
    await SecureStore.deleteItemAsync(LOGIN_KEY).catch(() => {});
    throw e;
  }
}

export async function turnOnFingerprintSignIn(password: string, name: string) {
  const check = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Touch the sensor to turn on fingerprint sign-in',
    disableDeviceFallback: true,
  });
  if (!check.success) throw new Error('Fingerprint not confirmed. Try again.');
  const r = (await request('post', '/me/login-keys', {
    body: { password, device_name: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} phone` },
  })) as { id: string; key: string };
  await SecureStore.setItemAsync(LOGIN_KEY, JSON.stringify({ key: r.key, id: r.id, name }));
}

export async function turnOffFingerprintSignIn() {
  const saved = await savedFingerprintLogin();
  if (saved)
    await request('delete', '/me/login-keys/{id}', { params: { id: saved.id } }).catch(() => {});
  await SecureStore.deleteItemAsync(LOGIN_KEY).catch(() => {});
}
