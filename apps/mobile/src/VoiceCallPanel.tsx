import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { request } from './request';
import { getCallAudio, makeCallPeer, callDescription, callCandidate } from './voiceRtc';
import CallAudio from './CallAudio';
import { Button, s } from './ui';
export default function VoiceCallPanel({
  conversationId,
  userId,
}: {
  conversationId: string;
  userId: string;
}) {
  const [config, setConfig] = useState<any>(null),
    [call, setCall] = useState<any>(null),
    [remote, setRemote] = useState<any>(null),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [muted, setMuted] = useState(false);
  const current = useRef<any>(null),
    peer = useRef<any>(null),
    audio = useRef<any>(null),
    seen = useRef(new Set<string>()),
    pendingIce = useRef<any[]>([]),
    polling = useRef(false),
    offerHandled = useRef(false),
    mounted = useRef(true);
  const change = (c: any) => {
    current.current = c;
    if (mounted.current) setCall(c);
  };
  function stop() {
    if (peer.current) {
      peer.current.onconnectionstatechange = null;
      peer.current.onicecandidate = null;
      peer.current.ontrack = null;
    }
    peer.current?.close();
    peer.current = null;
    audio.current?.getTracks().forEach((t: any) => t.stop());
    audio.current = null;
    seen.current.clear();
    pendingIce.current = [];
    offerHandled.current = false;
    if (mounted.current) {
      setRemote(null);
      setMuted(false);
      setStatus('');
    }
  }
  async function end(action: 'end' | 'decline' = 'end') {
    const c = current.current;
    stop();
    change(null);
    if (c)
      await request('post', '/voice/{id}/action', { params: { id: c.id }, body: { action } }).catch(
        () => {},
      );
  }
  async function setup(id: string, existingStream?: any) {
    const stream = existingStream || (await getCallAudio());
    if (!mounted.current) {
      stream.getTracks().forEach((t: any) => t.stop());
      throw new Error('Conversation closed.');
    }
    audio.current = stream;
    const pc = makeCallPeer(config.ice_servers, config.ice_transport_policy);
    peer.current = pc;
    stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));
    pc.ontrack = (e: any) => {
      if (mounted.current && e.streams?.[0]) setRemote(e.streams[0]);
    };
    pc.onicecandidate = (e: any) => {
      if (e.candidate)
        void request('post', '/voice/{id}/signals', {
          params: { id },
          body: { kind: 'ice', payload: e.candidate.toJSON() },
        }).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (!mounted.current) return;
      setStatus(pc.connectionState || 'connecting');
      if (['failed', 'closed'].includes(pc.connectionState)) {
        setError('Connection ended. A configured relay may be needed on this network.');
        void end();
      }
    };
    return pc;
  }
  async function signals() {
    const c = current.current;
    if (!c || !peer.current || polling.current) return;
    polling.current = true;
    try {
      const data = await request('get', '/voice/{id}/signals', { params: { id: c.id } });
      if (current.current?.id !== c.id || !peer.current) return;
      if (data.status === 'ENDED') {
        stop();
        change(null);
        return;
      }
      for (const signal of data.signals) {
        if (seen.current.has(signal.id)) continue;
        const pc = peer.current;
        if (!pc) break;
        if (signal.kind === 'offer' && !offerHandled.current) {
          await pc.setRemoteDescription(callDescription(signal.payload));
          offerHandled.current = true;
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await request('post', '/voice/{id}/signals', {
            params: { id: c.id },
            body: { kind: 'answer', payload: { type: 'answer', sdp: answer.sdp } },
          });
        } else if (signal.kind === 'answer' && !offerHandled.current) {
          await pc.setRemoteDescription(callDescription(signal.payload));
          offerHandled.current = true;
        } else if (signal.kind === 'ice') {
          if (pc.remoteDescription) await pc.addIceCandidate(callCandidate(signal.payload));
          else pendingIce.current.push(signal.payload);
        }
        seen.current.add(signal.id);
        if (pc.remoteDescription && pendingIce.current.length) {
          for (const ice of pendingIce.current) await pc.addIceCandidate(callCandidate(ice));
          pendingIce.current = [];
        }
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      stop();
      change(null);
    } finally {
      polling.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    void request('get', '/voice/config')
      .then(setConfig)
      .catch((e) => setError(e.message));
    const tick = async () => {
      try {
        const active = await request('get', '/conversations/{id}/call', {
          params: { id: conversationId },
        });
        if (!mounted.current) return;
        if (active) {
          if (current.current?.id !== active.id) {
            stop();
            change(active);
          } else change(active);
          await signals();
        } else if (current.current) {
          stop();
          change(null);
        }
      } catch (e) {
        if (mounted.current) {
          setError((e as Error).message);
          stop();
          change(null);
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && peer.current) void end();
    });
    return () => {
      mounted.current = false;
      clearInterval(timer);
      app.remove();
      const c = current.current;
      const wasConnected = !!audio.current;
      stop();
      current.current = null;
      if (c && wasConnected)
        void request('post', '/voice/{id}/action', {
          params: { id: c.id },
          body: { action: 'end' },
        }).catch(() => {});
    };
  }, [conversationId]);
  async function start() {
    setBusy(true);
    setError('');
    try {
      const media = await getCallAudio();
      audio.current = media;
      const result = await request('post', '/conversations/{id}/call', {
        params: { id: conversationId },
      });
      change({ id: result.id, caller_id: userId, status: 'RINGING' });
      const pc = await setup(result.id, media),
        offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await request('post', '/voice/{id}/signals', {
        params: { id: result.id },
        body: { kind: 'offer', payload: { type: 'offer', sdp: offer.sdp } },
      });
      setStatus('Calling…');
    } catch (e) {
      setError((e as Error).message);
      await end();
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    if (!call) return;
    setBusy(true);
    setError('');
    try {
      await setup(call.id);
      await request('post', '/voice/{id}/action', {
        params: { id: call.id },
        body: { action: 'accept' },
      });
      change({ ...call, status: 'ACCEPTED' });
      await signals();
    } catch (e) {
      setError((e as Error).message);
      await end();
    } finally {
      setBusy(false);
    }
  }
  if (!config?.enabled) return null;
  const incoming = call && call.caller_id !== userId && call.status === 'RINGING';
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>Private voice call</Text>
      <Text style={s.fine}>
        {config.notice} Microphone access begins only after you start or accept. Leaving the app
        ends audio.
      </Text>
      {error && <Text style={s.fine}>{error}</Text>}
      {!call ? (
        <Button secondary title="Start voice call" disabled={busy} onPress={() => void start()} />
      ) : (
        <>
          <Text style={s.body}>
            {incoming ? 'Incoming voice call' : status || call.status.toLowerCase()}
          </Text>
          {incoming ? (
            <>
              <Button
                title="Accept & enable microphone"
                disabled={busy}
                onPress={() => void accept()}
              />
              <Button
                secondary
                title="Decline call"
                disabled={busy}
                onPress={() => void end('decline')}
              />
            </>
          ) : (
            <>
              <Button
                secondary
                title={muted ? 'Unmute microphone' : 'Mute microphone'}
                disabled={busy || !audio.current}
                onPress={() => {
                  const next = !muted;
                  audio.current?.getAudioTracks().forEach((t: any) => {
                    t.enabled = !next;
                  });
                  setMuted(next);
                }}
              />
              <Button secondary title="End call" onPress={() => void end()} />
            </>
          )}
        </>
      )}
      {remote && <CallAudio stream={remote} />}
    </View>
  );
}
