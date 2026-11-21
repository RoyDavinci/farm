import * as Location from 'expo-location';
export type Point = { latitude: number; longitude: number };
export async function currentPosition(): Promise<Point> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted)
    throw new Error('Location permission is needed. You can enter a map pin instead.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: p.coords.latitude, longitude: p.coords.longitude };
}
