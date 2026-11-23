import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** Photographs a document or selfie with the camera (the file picker on web). */
export async function snap(front: boolean) {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Allow camera access to take the photo.');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });
  if (result.canceled) return null;
  const a = result.assets[0];
  return { uri: a.uri, mimeType: a.mimeType, name: a.fileName, file: (a as any).file };
}
