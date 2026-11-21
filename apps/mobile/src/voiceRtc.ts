import { PermissionsAndroid, Platform } from 'react-native';

// Load the native module only when a user explicitly starts/accepts a call.
// Existing Expo clients can continue using chat until rebuilt with WebRTC.
const rtc = () => require('react-native-webrtc');

/** Asks for the microphone (Android shows its own prompt) and returns the call's audio stream. */
export async function getCallAudio() {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'Microphone for calls',
      message: 'Ahia uses your microphone only during voice calls you start or accept.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    if (result !== PermissionsAndroid.RESULTS.GRANTED)
      throw new Error(
        result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          ? 'Microphone access is off for Ahia. Turn it on in your phone’s Settings → Apps → Ahia → Permissions to make calls.'
          : 'Allow microphone access to make or answer a call.',
      );
  }
  try {
    return await rtc().mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    throw new Error(
      'Ahia couldn’t use your microphone. Check microphone access for Ahia in your phone’s Settings, then try again.',
    );
  }
}
export const makeCallPeer = (iceServers: any[], iceTransportPolicy: 'relay' | 'all' = 'relay') =>
  new (rtc().RTCPeerConnection)({ iceServers, iceTransportPolicy });
export const callDescription = (value: any) => new (rtc().RTCSessionDescription)(value);
export const callCandidate = (value: any) => new (rtc().RTCIceCandidate)(value);
