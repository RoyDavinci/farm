import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { request } from './request';
export default function AccountPanel({
  user,
  onUpdate,
}: {
  user: any;
  onUpdate: () => Promise<void>;
}) {
  const [name, setName] = useState(user.name),
    [phone, setPhone] = useState(user.phone),
    [sessions, setSessions] = useState<any[]>([]),
    [blocks, setBlocks] = useState<any[]>([]),
    [email, setEmail] = useState(true),
    [push, setPush] = useState(true),
    [marketing, setMarketing] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    const [s, b, p] = await Promise.all([
      request('get', '/me/sessions'),
      request('get', '/me/blocks'),
      request('get', '/notification-preferences'),
    ]);
    setSessions(s);
    setBlocks(b);
    setEmail(p.email_enabled);
    setPush(p.push_enabled !== false);
    setMarketing(p.marketing_enabled === true);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      await onUpdate();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 18 }}>
      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {notice && <Text style={s.notice}>{notice}</Text>}
      <View style={s.card}>
        <Text style={s.title}>Your details</Text>
        <Text style={s.small}>
          {user.email} ·{' '}
          {user.email_verified_at ? 'Email verified' : 'Verify email at your next sign-in'}
        </Text>
        <Text style={s.label}>Name</Text>
        <TextInput
          accessibilityLabel="Your name"
          value={name}
          onChangeText={setName}
          style={s.input}
        />
        <Text style={s.label}>Phone</Text>
        <TextInput
          accessibilityLabel="Your phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          style={s.input}
        />
        <Text style={s.small}>Phone is a contact detail; verification currently uses email.</Text>
        <Pressable
          style={s.button}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await request('patch', '/me', { body: { name, phone } });
            }, 'Profile updated.')
          }
        >
          <Text style={s.buttonText}>Save details</Text>
        </Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.title}>Notifications</Text>
        <View style={s.row}>
          <Text style={s.body}>Optional product updates from favourite sellers</Text>
          <Switch
            accessibilityLabel="Promotional notifications"
            value={marketing}
            disabled={busy}
            onValueChange={(value) =>
              void run(async () => {
                await request('put', '/notification-preferences', {
                  body: { email_enabled: email, push_enabled: push, marketing_enabled: value },
                });
                setMarketing(value);
              }, 'Promotional preference saved.')
            }
          />
        </View>
        <Text style={s.small}>
          Off by default. At most one new-product alert per 24 hours. Muted sellers/categories are
          excluded. Local Status uploads never broadcast notifications; booking, payment and
          delivery updates stay separate.
        </Text>
        <View style={s.row}>
          <Text style={s.body}>Email alerts for bookings and messages</Text>
          <Switch
            accessibilityLabel="Email notifications"
            value={email}
            disabled={busy}
            onValueChange={(value) =>
              void run(async () => {
                await request('put', '/notification-preferences', {
                  body: {
                    email_enabled: value,
                    push_enabled: push,
                  },
                });
                setEmail(value);
              }, 'Notification preference saved.')
            }
          />
        </View>
        <View style={s.row}>
          <Text style={s.body}>Push notifications on this phone</Text>
          <Switch
            accessibilityLabel="Push notifications"
            value={push}
            disabled={busy}
            onValueChange={(value) =>
              void run(async () => {
                await request('put', '/notification-preferences', {
                  body: {
                    email_enabled: email,
                    push_enabled: value,
                  },
                });
                setPush(value);
              }, 'Notification preference saved.')
            }
          />
        </View>
        <Text style={s.small}>Verification and password recovery emails are always sent.</Text>
      </View>
      <View style={s.card}>
        <Text style={s.title}>Your devices</Text>
        {sessions.map((session) => (
          <View key={session.id} style={s.session}>
            <Text style={s.label}>{session.current ? 'This device' : 'Signed-in device'}</Text>
            <Text style={s.small}>{session.device_label}</Text>
            <Text style={s.small}>Signed in {new Date(session.created_at).toLocaleString()}</Text>
            {!session.current && (
              <Pressable
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await request('delete', '/me/sessions/{id}', { params: { id: session.id } });
                  }, 'Device signed out.')
                }
              >
                <Text style={s.link}>Sign out this device</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
      {blocks.length > 0 && (
        <View style={s.card}>
          <Text style={s.title}>Blocked accounts</Text>
          {blocks.map((b) => (
            <View style={s.row} key={b.blocked_id}>
              <Text style={s.body}>{b.name}</Text>
              <Pressable
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await request('delete', '/me/blocks/{id}', { params: { id: b.blocked_id } });
                  }, 'Account unblocked.')
                }
              >
                <Text style={s.link}>Unblock</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Text style={s.small}>
        To change your password, sign out and choose “Forgot your password?” on the sign-in screen.
        Resetting signs out all devices.
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    padding: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d8ddeb',
    borderRadius: 10,
    gap: 12,
  },
  title: { fontSize: 16, color: '#2f4072', fontWeight: '600' },
  label: { fontSize: 11, color: '#5f6c94', fontWeight: '600' },
  input: {
    padding: 13,
    borderWidth: 1,
    borderColor: '#d2d8e9',
    borderRadius: 7,
    fontSize: 13,
    color: '#253565',
  },
  body: { fontSize: 12, color: '#657195' },
  small: { fontSize: 10, lineHeight: 18, color: '#7c87a7' },
  button: { backgroundColor: '#26408f', padding: 13, borderRadius: 7, alignItems: 'center' },
  buttonText: { color: '#e3e8f6', fontSize: 12, fontWeight: '600' },
  session: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderColor: '#e6e9f1' },
  link: { fontSize: 11, color: '#425aa3', paddingVertical: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  error: { fontSize: 12, color: '#a16447', backgroundColor: '#faeee5', padding: 13 },
  notice: { fontSize: 12, color: '#334b94', backgroundColor: '#e2e7f6', padding: 13 },
});
