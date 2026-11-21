import { Brand } from './ui';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { saveSession } from './api';
import { request } from './request';
export default function AuthScreen({ onSignedIn }: { onSignedIn: (user: any) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login'),
    [challenge, setChallenge] = useState<any>(null),
    [form, setForm] = useState({ name: '', phone: '', email: '', password: '' }),
    [code, setCode] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [resendAt, setResendAt] = useState(0),
    [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    label: string,
    value: string,
    onChangeText: (s: string) => void,
    extra: any = {},
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={s.input}
        placeholderTextColor="#828ca9"
        {...extra}
      />
    </View>
  );
  function switchMode(next: typeof mode) {
    setMode(next);
    setChallenge(null);
    setCode('');
    setError('');
    setNotice('');
  }
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Brand size={34} />
          <View style={s.hero}>
            <Text style={s.eyebrow}>BUY, SELL & DELIVER ACROSS NIGERIA</Text>
            <Text style={s.heading}>
              {challenge
                ? 'Check your inbox.'
                : mode === 'reset'
                  ? 'A fresh start.'
                  : 'Find it.\nBuy it nearby.'}
            </Text>
            <Text style={s.body}>
              {challenge
                ? `Enter the six-digit code sent to ${challenge.email}. It expires in 10 minutes.`
                : mode === 'reset'
                  ? 'We’ll email you a code to reset your password.'
                  : 'Buy and sell locally. Verify your email to keep your market account secure.'}
            </Text>
          </View>
          {error ? (
            <View accessibilityRole="alert" style={s.error}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}
          {notice ? (
            <Text accessibilityRole="alert" style={s.notice}>
              {notice}
            </Text>
          ) : null}
          {challenge ? (
            <>
              {challenge.delivery === 'development_file' && (
                <Text style={s.hint}>
                  Development mode: the email is saved as an .eml file in apps/api/.data/ahia/mail.
                  SMTP delivery is not configured yet.
                </Text>
              )}
              {field('Email verification code', code, setCode, {
                keyboardType: 'number-pad',
                maxLength: 6,
                textContentType: 'oneTimeCode',
                autoComplete: 'one-time-code',
                placeholder: '123456',
              })}
              {mode === 'reset' &&
                field('New password', newPassword, setNewPassword, {
                  secureTextEntry: true,
                  placeholder: 'At least 10 characters',
                  autoComplete: 'new-password',
                })}
              <Pressable
                style={[s.button, busy && { opacity: 0.5 }]}
                disabled={busy || !/^\d{6}$/.test(code)}
                onPress={() =>
                  void run(async () => {
                    const d = await request('post', '/auth/otp/verify', {
                      body: {
                        challenge_id: challenge.challenge_id,
                        code,
                        ...(mode === 'reset' ? { new_password: newPassword } : {}),
                      },
                    });
                    if ('password_reset' in d) {
                      switchMode('login');
                      setNotice('Password reset. Sign in with your new password.');
                      return;
                    }
                    await saveSession(d);
                    await onSignedIn(d.user);
                  })
                }
              >
                <Text style={s.buttonText}>
                  {busy
                    ? 'Verifying…'
                    : mode === 'reset'
                      ? 'Reset password'
                      : 'Verify and continue →'}
                </Text>
              </Pressable>
              <Pressable
                disabled={busy || seconds > 0}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/auth/otp/resend', {
                      body: { challenge_id: challenge.challenge_id },
                    });
                    setResendAt(Date.now() + 60000);
                    setCode('');
                    setNotice('A new code has been sent.');
                  })
                }
              >
                <Text style={s.link}>
                  {seconds ? `Resend available in ${seconds}s` : 'Send another code'}
                </Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => {
                  setChallenge(null);
                  setCode('');
                  setError('');
                }}
              >
                <Text style={s.link}>← Use a different email / start again</Text>
              </Pressable>
            </>
          ) : (
            <>
              {mode !== 'reset' && (
                <View style={s.tabs}>
                  {(['login', 'register'] as const).map((m) => (
                    <Pressable
                      key={m}
                      disabled={busy}
                      style={[s.tab, mode === m && s.active]}
                      onPress={() => switchMode(m)}
                    >
                      <Text style={s.label}>
                        {m === 'login' ? 'Welcome back' : 'Create account'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {mode === 'register' && (
                <>
                  {field('Your name', form.name, (v) => setForm({ ...form, name: v }), {
                    autoComplete: 'name',
                  })}
                  {field('Phone number', form.phone, (v) => setForm({ ...form, phone: v }), {
                    keyboardType: 'phone-pad',
                    placeholder: '+2348012345678',
                  })}
                </>
              )}
              {field('Email address', form.email, (v) => setForm({ ...form, email: v }), {
                autoCapitalize: 'none',
                keyboardType: 'email-address',
                autoComplete: 'email',
              })}
              {mode !== 'reset' &&
                field('Password', form.password, (v) => setForm({ ...form, password: v }), {
                  secureTextEntry: true,
                  placeholder: 'At least 10 characters',
                  autoComplete: mode === 'login' ? 'current-password' : 'new-password',
                })}
              <Pressable
                style={[s.button, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const d =
                      mode === 'register'
                        ? await request('post', '/auth/register', { body: form })
                        : mode === 'reset'
                          ? await request('post', '/auth/password/forgot', {
                              body: { email: form.email },
                            })
                          : await request('post', '/auth/login', {
                              body: { email: form.email, password: form.password },
                            });
                    setChallenge(d);
                    setResendAt(Date.now() + 60000);
                    setCode('');
                  })
                }
              >
                <Text style={s.buttonText}>
                  {busy
                    ? 'Sending code…'
                    : mode === 'reset'
                      ? 'Send recovery code'
                      : 'Continue with email →'}
                </Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => switchMode(mode === 'reset' ? 'login' : 'reset')}
              >
                <Text style={s.link}>
                  {mode === 'reset' ? '← Back to sign in' : 'Forgot your password?'}
                </Text>
              </Pressable>
            </>
          )}
          <Text style={s.fine}>
            One account to shop and sell. Your private collection address is only shared after an
            accepted booking.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f7fc' },
  content: {
    padding: 28,
    paddingTop: 35,
    gap: 20,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  brand: { fontSize: 23, fontWeight: '700', color: '#243463', letterSpacing: -0.8 },
  hero: { gap: 17, paddingTop: 30, paddingBottom: 8 },
  eyebrow: { fontSize: 9, letterSpacing: 1.5, color: '#6a779f' },
  heading: { fontSize: 35, lineHeight: 43, color: '#212e57', fontWeight: '700', letterSpacing: -1 },
  body: { fontSize: 13, lineHeight: 22, color: '#657092' },
  field: { gap: 8 },
  label: { fontSize: 12, color: '#465685', fontWeight: '600' },
  input: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#d1d7e9',
    backgroundColor: '#fff',
    borderRadius: 8,
    fontSize: 14,
    color: '#22315c',
  },
  button: { padding: 16, backgroundColor: '#26408f', borderRadius: 8, alignItems: 'center' },
  buttonText: { fontSize: 13, color: '#e4e9f8', fontWeight: '600' },
  link: { fontSize: 12, color: '#475c99', textAlign: 'center', padding: 5 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#d6dbea' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  active: { borderBottomWidth: 2, borderColor: '#2d3e72' },
  error: { backgroundColor: '#f9eade', padding: 14, borderRadius: 8 },
  errorText: { fontSize: 12, lineHeight: 19, color: '#9b553c' },
  notice: {
    backgroundColor: '#e2e7f6',
    padding: 14,
    borderRadius: 8,
    color: '#32488a',
    fontSize: 12,
  },
  hint: {
    fontSize: 11,
    lineHeight: 18,
    color: '#9b874e',
    backgroundColor: '#e0e6f4',
    padding: 13,
    borderRadius: 8,
  },
  fine: { fontSize: 10, lineHeight: 18, color: '#848da7', textAlign: 'center', marginTop: 10 },
});
