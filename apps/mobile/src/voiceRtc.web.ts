export const getCallAudio = () =>
  navigator.mediaDevices.getUserMedia({ audio: true, video: false });
export const makeCallPeer = (iceServers: any[], iceTransportPolicy: 'relay' | 'all' = 'relay') =>
  new RTCPeerConnection({ iceServers, iceTransportPolicy });
export const callDescription = (value: any) => new RTCSessionDescription(value);
export const callCandidate = (value: any) => new RTCIceCandidate(value);
