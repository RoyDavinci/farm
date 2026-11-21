import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { restoreToken } from './api';
import { request } from './request';
const TASK = 'marketplace-active-rider-location',
  KEY = 'marketplace-background-location-account';
let authRestored = false;
export async function stopBackgroundTracking() {
  await AsyncStorage.removeItem(KEY);
  if (Platform.OS !== 'web' && (await Location.hasStartedLocationUpdatesAsync(TASK)))
    await Location.stopLocationUpdatesAsync(TASK);
}
if (!TaskManager.isTaskDefined(TASK))
  TaskManager.defineTask(TASK, async ({ data, error }: any) => {
    if (error || !data?.locations?.length) return;
    const account = await AsyncStorage.getItem(KEY);
    if (!account) {
      await stopBackgroundTracking();
      return;
    }
    try {
      if (!authRestored && !(authRestored = await restoreToken())) {
        await stopBackgroundTracking();
        return;
      }
      const driver = await request('get', '/drivers/me');
      if (!driver || driver.user_id !== account || !driver.online || driver.status !== 'APPROVED') {
        await stopBackgroundTracking();
        return;
      }
      const point = data.locations.at(-1) as Location.LocationObject;
      if (Date.now() - point.timestamp > 120000) return;
      await request('put', '/drivers/me/background-location', {
        body: { latitude: point.coords.latitude, longitude: point.coords.longitude },
      });
    } catch {
      /* Connectivity failures do not queue historical location points. */
    }
  });
export async function startBackgroundTracking(accountId: string) {
  if (Platform.OS === 'web' || !(await TaskManager.isAvailableAsync()))
    throw new Error('Background tracking needs a rebuilt native development or store app.');
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) throw new Error('Foreground location permission is required.');
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted)
    throw new Error('Allow background location in device settings to enable this option.');
  await AsyncStorage.setItem(KEY, accountId);
  try {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 25,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Delivery location sharing is on',
        notificationBody: 'Your active buyers can follow delivery progress. Turn off in Drive.',
        killServiceOnDestroy: true,
      },
    });
    await request('put', '/drivers/me/background-consent', { body: { enabled: true } });
  } catch (e) {
    await stopBackgroundTracking();
    throw e;
  }
}
export async function backgroundTrackingEnabled() {
  return (
    Platform.OS !== 'web' &&
    (await Location.hasStartedLocationUpdatesAsync(TASK)) &&
    !!(await AsyncStorage.getItem(KEY))
  );
}
