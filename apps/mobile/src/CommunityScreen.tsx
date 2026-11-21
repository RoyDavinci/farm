import VoiceCallPanel from './VoiceCallPanel';
import { useApp } from './AppContext';
import { featureOn } from './features';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { liveUpdates } from './api';
import { request } from './request';
export default function CommunityScreen({
  user,
  initialConversation,
  onBooking,
  onShopping,
}: {
  user: any;
  initialConversation?: string | null;
  onBooking: () => void;
  onShopping: () => void;
}) {
  const { settings } = useApp();
  const [section, setSection] = useState<'messages' | 'updates'>('messages'),
    [conversations, setConversations] = useState<any[]>([]),
    [notifications, setNotifications] = useState<any[]>([]),
    [selected, setSelected] = useState<string | null>(initialConversation || null),
    [messages, setMessages] = useState<any[]>([]),
    [peerReadAt, setPeerReadAt] = useState<string | null>(null),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [report, setReport] = useState(''),
    [reporting, setReporting] = useState(false),
    [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const [c, n] = await Promise.all([
        request('get', '/conversations'),
        request('get', '/notifications'),
      ]);
      setConversations(c);
      setNotifications(n);
      if (selected) {
        const m = await request('get', '/conversations/{id}/messages', {
          params: { id: selected },
        });
        setMessages(m.messages);
        setPeerReadAt(m.peer_read_at);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selected]);
  useEffect(() => {
    setSelected(initialConversation || null);
  }, [initialConversation]);
  useEffect(() => {
    void load();
    const closeLive = liveUpdates(() => void load());
    const interval = setInterval(() => void load(), 5000);
    return () => {
      clearInterval(interval);
      closeLive();
    };
  }, [load]);
  useEffect(() => {
    if (selected)
      void request('post', '/conversations/{id}/read', { params: { id: selected } }).catch(
        () => {},
      );
  }, [selected, messages.length]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const c = conversations.find((c) => c.id === selected),
    peer = c?.buyer_id === user.id ? c?.seller_id : c?.buyer_id;
  return (
    <View style={s.container}>
      <Text style={s.eyebrow}>KEEP YOUR MARKET CLOSE</Text>
      <Text style={s.heading}>Your inbox</Text>
      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {notice && (
        <Text accessibilityRole="alert" style={s.notice}>
          {notice}
        </Text>
      )}
      <View style={s.tabs}>
        {(['messages', 'updates'] as const).map((t) => (
          <Pressable
            key={t}
            style={[s.tab, section === t && s.active]}
            onPress={() => setSection(t)}
          >
            <Text style={s.bold}>
              {t === 'messages'
                ? `Messages (${conversations.reduce((sum, c) => sum + c.unread, 0)})`
                : `Updates (${notifications.filter((n) => !n.read_at).length})`}
            </Text>
          </Pressable>
        ))}
      </View>
      {section === 'updates' ? (
        <>
          <Pressable
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await request('post', '/notifications/read', { body: {} });
              })
            }
          >
            <Text style={s.link}>Mark all read</Text>
          </Pressable>
          {!notifications.length && <Text style={s.body}>Booking updates will appear here.</Text>}
          {notifications.map((n) => (
            <Pressable
              key={n.id}
              style={[s.card, !n.read_at && { borderColor: '#bacd9f' }]}
              onPress={() =>
                void run(async () => {
                  await request('post', '/notifications/read', { body: { id: n.id } });
                  if (n.kind === 'shopping') onShopping();
                  else if (n.booking_id) onBooking();
                  else setSection('messages');
                })
              }
            >
              <Text style={s.bold}>
                {!n.read_at ? '● ' : ''}
                {n.title}
              </Text>
              <Text style={s.body}>{n.body}</Text>
              <Text style={s.small}>{new Date(n.created_at).toLocaleString()}</Text>
            </Pressable>
          ))}
        </>
      ) : selected ? (
        <>
          <Pressable
            onPress={() => {
              setSelected(null);
              setReporting(false);
            }}
          >
            <Text style={s.link}>← All conversations</Text>
          </Pressable>
          <View style={s.card}>
            <Text style={s.bold}>
              {c ? (c.buyer_id === user.id ? c.business_name : c.buyer_name) : 'Conversation'}
            </Text>
            <Text style={s.small}>{c?.title}</Text>
          </View>
          {messages.length === 0 && (
            <Text style={s.body}>Ask about stock, quality or collection before you book.</Text>
          )}
          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
          >
            {messages.map((m) => (
              <View key={m.id} style={[s.message, m.sender_id === user.id ? s.sent : s.received]}>
                <Text style={s.messageText}>{m.body}</Text>
                <Text style={s.small}>
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {m.sender_id === user.id
                    ? peerReadAt && new Date(peerReadAt) >= new Date(m.created_at)
                      ? ' · Read'
                      : ' · Delivered'
                    : ''}
                </Text>
              </View>
            ))}
          </ScrollView>
          {!c?.blocked && selected && featureOn(settings, 'voice') && (
            <VoiceCallPanel conversationId={selected} userId={user.id} />
          )}
          {c?.blocked ? (
            <Text style={s.body}>
              Messaging is unavailable while a participant has a block in place.
            </Text>
          ) : (
            <>
              <TextInput
                accessibilityLabel="Message"
                style={s.input}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={2000}
                placeholder="Ask your seller a question…"
              />
              <Pressable
                style={s.button}
                disabled={busy || !text.trim()}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/conversations/{id}/messages', {
                      params: { id: selected },
                      body: { body: text },
                    });
                    setText('');
                  })
                }
              >
                <Text style={s.buttonText}>{busy ? 'Sending…' : 'Send message →'}</Text>
              </Pressable>
            </>
          )}
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <Pressable
              disabled={busy || !peer || (c?.blocked && !c?.blocked_by_me)}
              onPress={() =>
                void run(async () => {
                  await request(c?.blocked_by_me ? 'delete' : 'put', '/me/blocks/{id}', {
                    params: { id: peer },
                  });
                })
              }
            >
              <Text style={s.link}>
                {c?.blocked_by_me
                  ? 'Remove my block'
                  : c?.blocked
                    ? 'Messaging unavailable'
                    : 'Block participant'}
              </Text>
            </Pressable>
            <Pressable onPress={() => setReporting(!reporting)}>
              <Text style={s.link}>Report conversation</Text>
            </Pressable>
          </View>
          {reporting && (
            <>
              <TextInput
                accessibilityLabel="Report reason"
                style={s.input}
                value={report}
                onChangeText={setReport}
                multiline
                placeholder="Describe the issue for support"
              />
              <Pressable
                style={s.button}
                disabled={busy || report.trim().length < 5}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/reports', {
                      body: {
                        subject_type: 'conversation',
                        subject_id: selected,
                        reason: report,
                      },
                    });
                    setReport('');
                    setReporting(false);
                    setNotice('Report sent to the support team.');
                  })
                }
              >
                <Text style={s.buttonText}>Submit report</Text>
              </Pressable>
            </>
          )}
        </>
      ) : (
        <>
          {conversations.length === 0 && (
            <View style={s.card}>
              <Text style={s.bold}>Start a local conversation</Text>
              <Text style={s.body}>
                Open a listing and tap “Message seller” to ask about products before booking.
              </Text>
            </View>
          )}
          {conversations.map((c) => (
            <Pressable
              key={c.id}
              style={s.card}
              onPress={() => {
                setSelected(c.id);
                setError('');
              }}
            >
              <View style={s.row}>
                <Text style={s.bold}>
                  {c.buyer_id === user.id ? c.business_name : c.buyer_name}
                </Text>
                {c.unread > 0 && <Text style={s.unread}>{c.unread} new</Text>}
              </View>
              <Text style={s.small}>{c.title}</Text>
              <Text numberOfLines={2} style={s.body}>
                {c.last_message || 'No messages yet. Say hello.'}
              </Text>
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { gap: 16 },
  eyebrow: { fontSize: 9, color: '#8b987b', letterSpacing: 1.5 },
  heading: { fontSize: 30, fontWeight: '700', color: '#315233' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8d9' },
  tab: { flex: 1, padding: 13, alignItems: 'center' },
  active: { borderBottomWidth: 2, borderColor: '#4f713d' },
  bold: { fontSize: 13, color: '#4d6540', fontWeight: '600' },
  body: { fontSize: 12, lineHeight: 20, color: '#829175' },
  small: { fontSize: 9, lineHeight: 16, color: '#98a08b' },
  card: {
    backgroundColor: '#fff',
    padding: 17,
    borderWidth: 1,
    borderColor: '#e2e8d9',
    borderRadius: 9,
    gap: 9,
  },
  link: { fontSize: 11, color: '#708d58', paddingVertical: 6 },
  input: {
    fontSize: 13,
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dce5d0',
    borderRadius: 8,
    color: '#405c34',
    minHeight: 55,
  },
  button: { padding: 15, backgroundColor: '#365b38', borderRadius: 8, alignItems: 'center' },
  buttonText: { fontSize: 12, color: '#f2f6e8', fontWeight: '600' },
  message: { maxWidth: '88%', padding: 13, borderRadius: 10, gap: 9 },
  sent: { alignSelf: 'flex-end', backgroundColor: '#e6efd8' },
  received: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5eadf',
  },
  messageText: { color: '#4b6340', fontSize: 13, lineHeight: 20 },
  error: {
    fontSize: 12,
    color: '#a05f43',
    padding: 13,
    backgroundColor: '#faeee5',
    borderRadius: 7,
  },
  notice: { fontSize: 12, color: '#5c7e48', padding: 13, backgroundColor: '#eaf2df' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  unread: {
    fontSize: 10,
    color: '#668b44',
    backgroundColor: '#eff5e7',
    padding: 5,
    borderRadius: 4,
  },
});
