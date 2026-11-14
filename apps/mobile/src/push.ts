import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { request } from './request';

// Show alerts while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registered: string | null = null;

/**
 * Asks for permission and registers this device's Expo push token with the API.
 * Returns null quietly on web, simulators, denied permission, or a build without an EAS project id.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Bookings and messages',
        importance: Notifications.AndroidImportance.HIGH,
      });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await request('put', '/me/push-tokens', { body: { token: data, platform: Platform.OS } });
    registered = data;
    return data;
  } catch {
    // Push is an enhancement; the inbox and email still deliver every alert.
    return null;
  }
}

/** Removes this device's token before signing out so the next user doesn't get these alerts. */
export async function unregisterPush() {
  if (!registered) return;
  const token = registered;
  registered = null;
  try {
    await request('delete', '/me/push-tokens', { body: { token } });
  } catch {}
}

/** Calls back with the notification's data when the user taps one. */
export function onNotificationTap(handler: (data: { kind?: string; booking_id?: string }) => void) {
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) =>
    handler((response.notification.request.content.data || {}) as any),
  );
  return () => sub.remove();
}
