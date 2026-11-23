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
import { deviceToken, rememberDevice, saveSession } from './api';
import { request } from './request';
export default function AuthScreen({ onSignedIn }: { onSignedIn: (user: any) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login'),
    [challenge, setChallenge] = useState<any>(null),
    [form, setForm] = useState({ name: '', phone: '', email: '', password: '' }),
    [code, setCode] = useState(''),
    [pin, setPin] = useState(''),
    [pinAgain, setPinAgain] = useState(''),
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
        placeholderTextColor="#82a995"
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
                    if (d.device_token) await rememberDevice(challenge.email, d.device_token);
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
              {mode === 'register' && (
                <>
                  {field('Transaction PIN (4 digits)', pin, (v) => setPin(v.replace(/\D/g, '')), {
                    secureTextEntry: true,
                    keyboardType: 'number-pad',
                    maxLength: 4,
                    placeholder: 'Needed to withdraw money',
                  })}
                  {field(
                    'Confirm transaction PIN',
                    pinAgain,
                    (v) => setPinAgain(v.replace(/\D/g, '')),
                    {
                      secureTextEntry: true,
                      keyboardType: 'number-pad',
                      maxLength: 4,
                    },
                  )}
                  <Text style={s.pinNote}>
                    You’ll enter this PIN whenever you withdraw money or change your bank account,
                    so nobody else can move your money.
                  </Text>
                </>
              )}
              <Pressable
                style={[s.button, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const d =
                      mode === 'register'
                        ? await (() => {
                            if (!/^\d{4}$/.test(pin))
                              throw new Error('Choose a 4-digit transaction PIN.');
                            if (pin !== pinAgain) throw new Error('The two PINs don’t match.');
                            return request('post', '/auth/register', {
                              body: { ...form, transaction_pin: pin },
                            });
                          })()
                        : mode === 'reset'
                          ? await request('post', '/auth/password/forgot', {
                              body: { email: form.email },
                            })
                          : await request('post', '/auth/login', {
                              body: {
                                email: form.email,
                                password: form.password,
                                device_token: await deviceToken(form.email),
                              },
                            });
                    // A device that already confirmed a code signs straight in.
                    if (d.trusted_device === true) {
                      const signedIn = d as Extract<typeof d, { trusted_device: true }>;
                      await saveSession(signedIn);
                      await onSignedIn(signedIn.user);
                      return;
                    }
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
  safe: { flex: 1, backgroundColor: '#f5fcf9' },
  content: {
    padding: 28,
    paddingTop: 35,
    gap: 20,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  brand: { fontSize: 23, fontWeight: '700', color: '#1e5137', letterSpacing: -0.8 },
  hero: { gap: 17, paddingTop: 30, paddingBottom: 8 },
  eyebrow: { fontSize: 9, letterSpacing: 1.5, color: '#55846d' },
  heading: { fontSize: 35, lineHeight: 43, color: '#1b4731', fontWeight: '700', letterSpacing: -1 },
  body: { fontSize: 13, lineHeight: 22, color: '#537865' },
  pinNote: { fontSize: 11, lineHeight: 17, color: '#5f8571', marginTop: -10 },
  field: { gap: 8 },
  label: { fontSize: 12, color: '#396d53', fontWeight: '600' },
  input: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    backgroundColor: '#fff',
    borderRadius: 8,
    fontSize: 14,
    color: '#1c4b34',
  },
  button: { padding: 16, backgroundColor: '#1f754a', borderRadius: 8, alignItems: 'center' },
  buttonText: { fontSize: 13, color: '#e4f8ee', fontWeight: '600' },
  link: { fontSize: 12, color: '#3a7d5c', textAlign: 'center', padding: 5 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#d6eae0' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  active: { borderBottomWidth: 2, borderColor: '#255d41' },
  error: { backgroundColor: '#f9eade', padding: 14, borderRadius: 8 },
  errorText: { fontSize: 12, lineHeight: 19, color: '#9b553c' },
  notice: {
    backgroundColor: '#e2f6ec',
    padding: 14,
    borderRadius: 8,
    color: '#29714d',
    fontSize: 12,
  },
  hint: {
    fontSize: 11,
    lineHeight: 18,
    color: '#9b874e',
    backgroundColor: '#e0f4ea',
    padding: 13,
    borderRadius: 8,
  },
  fine: { fontSize: 10, lineHeight: 18, color: '#84a796', textAlign: 'center', marginTop: 10 },
});
