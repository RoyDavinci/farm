// Load the native module only when a user explicitly starts/accepts a call.
// Existing Expo clients can continue using chat until rebuilt with WebRTC.
const rtc = () => require('react-native-webrtc');
export const getCallAudio = () => rtc().mediaDevices.getUserMedia({ audio: true, video: false });
export const makeCallPeer = (iceServers: any[], iceTransportPolicy: 'relay' | 'all' = 'relay') =>
  new (rtc().RTCPeerConnection)({ iceServers, iceTransportPolicy });
export const callDescription = (value: any) => new (rtc().RTCSessionDescription)(value);
export const callCandidate = (value: any) => new (rtc().RTCIceCandidate)(value);
