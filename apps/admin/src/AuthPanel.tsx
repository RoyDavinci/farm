import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { request, saveSession } from './api';
export default function AuthPanel({ onSignedIn }: { onSignedIn: (u: any) => void }) {
  const [reset, setReset] = useState(false),
    [challenge, setChallenge] = useState<any>(null),
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
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      if (challenge) {
        const d = await request('post', '/auth/otp/verify', {
          body: {
            challenge_id: challenge.challenge_id,
            code: f.get('code'),
            ...(reset ? { new_password: f.get('new_password') } : {}),
          },
        });
        if (d.password_reset) {
          setChallenge(null);
          setReset(false);
          setNotice('Password reset. Sign in with your new password.');
          return;
        }
        if (!d.user.admin) throw new Error('Administrator access is required.');
        saveSession(d);
        onSignedIn(d.user);
      } else {
        const fields = Object.fromEntries(f) as Record<string, string>;
        const d = reset
          ? await request('post', '/auth/password/forgot', { body: { email: fields.email } })
          : await request('post', '/auth/login', {
              body: { email: fields.email, password: fields.password },
            });
        setChallenge(d);
        setResendAt(Date.now() + 60000);
        setNotice('');
      }
    });
  }
  return (
    <main className="login-form">
      <ShieldCheck size={36} />
      <h2>
        {challenge ? 'Check your inbox' : reset ? 'Reset your password' : 'Welcome to operations'}
      </h2>
      <p>
        {challenge
          ? `Enter the verification code sent to ${challenge.email}.`
          : reset
            ? 'We will email you a password reset code.'
            : 'Sign in with your administrator account, then verify your email code.'}
      </p>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="alert success">
          {notice}
        </div>
      )}
      {challenge?.delivery === 'development_file' && (
        <div className="demo-banner">
          Development email saved in apps/api/.data/zuru/mail. Configure SMTP to deliver it to an
          inbox.
        </div>
      )}
      <form onSubmit={submit}>
        {challenge ? (
          <>
            <label>
              Six-digit email code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
            </label>
            {reset && (
              <label>
                New password
                <input
                  name="new_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={100}
                  required
                />
              </label>
            )}
          </>
        ) : (
          <>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="admin@zuru.example"
              />
            </label>
            {!reset && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={10}
                />
              </label>
            )}
          </>
        )}
        <button disabled={busy} className="primary">
          {busy
            ? 'Please wait…'
            : challenge
              ? reset
                ? 'Reset password'
                : 'Verify and sign in'
              : reset
                ? 'Send recovery code'
                : 'Continue with email'}
          <ArrowUpRight size={18} />
        </button>
      </form>
      {challenge ? (
        <>
          <button
            className="text-button"
            style={{ margin: '20px auto' }}
            disabled={busy || seconds > 0}
            onClick={() =>
              void run(async () => {
                await request('post', '/auth/otp/resend', {
                  body: { challenge_id: challenge.challenge_id },
                });
                setResendAt(Date.now() + 60000);
                setNotice('A new code has been sent.');
              })
            }
          >
            {seconds ? `Resend in ${seconds}s` : 'Resend verification code'}
          </button>
          <button
            className="text-button"
            onClick={() => {
              setChallenge(null);
              setError('');
            }}
          >
            Start again
          </button>
        </>
      ) : (
        <button
          className="text-button"
          style={{ marginTop: 20 }}
          onClick={() => {
            setReset(!reset);
            setError('');
          }}
        >
          {reset ? 'Back to sign in' : 'Forgot your password?'}
        </button>
      )}
    </main>
  );
}
