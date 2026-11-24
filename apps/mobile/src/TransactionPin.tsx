import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  biometricKey,
  biometricOn,
  biometricSupported,
  savedFingerprintLogin,
  turnOffBiometric,
  turnOffFingerprintSignIn,
  turnOnBiometric,
  turnOnFingerprintSignIn,
} from './biometric';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Field, s } from './ui';

type PinState = { set: boolean; locked_until: string | null };

/** Whether the signed-in user has a transaction PIN; reload() after setting one. */
export function useTransactionPin() {
  const [state, setState] = useState<PinState | null>(null);
  const reload = useCallback(
    () =>
      request('get', '/me/transaction-pin')
        .then(setState)
        .catch(() => setState(null)),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, reload };
}

/** A PIN, or a fingerprint key ("bio:…") from a phone with fingerprint payments on. */
export const pinReady = (v: string) => /^\d{4}$/.test(v) || v.startsWith('bio:');

/**
 * Confirms a payment, transfer, withdrawal or bank change: the 4-digit PIN, or on a phone with
 * fingerprint payments turned on, a fingerprint.
 */
export function PinField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { me } = useApp();
  const [bio, setBio] = useState(false);
  useEffect(() => {
    if (me?.id) void biometricOn(me.id).then(setBio);
  }, [me?.id]);
  if (value.startsWith('bio:'))
    return (
      <View style={[s.rowBetween, { paddingVertical: 6 }]}>
        <Text style={s.bold}>✓ Confirmed with your fingerprint</Text>
        <Pressable onPress={() => onChange('')}>
          <Text style={s.link}>Use PIN</Text>
        </Pressable>
      </View>
    );
  return (
    <>
      {bio && (
        <Button
          secondary
          title="👆 Confirm with fingerprint"
          onPress={() => void biometricKey(me.id).then((k) => k && onChange(k))}
        />
      )}
      <Field
        label={bio ? 'Or enter your transaction PIN' : 'Transaction PIN'}
        value={value}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={4}
        placeholder="4 digits"
        onChangeText={(v: string) => onChange(v.replace(/\D/g, ''))}
      />
    </>
  );
}

/** Sign in on this phone with a fingerprint (turned on with the account password). */
export function FingerprintSignInToggle() {
  const { me, busy, run } = useApp();
  const [supported, setSupported] = useState(false),
    [on, setOn] = useState(false),
    [password, setPassword] = useState(''),
    [open, setOpen] = useState(false);
  useEffect(() => {
    void biometricSupported().then(setSupported);
    void savedFingerprintLogin().then((v) => setOn(!!v && !!me && v.name === me.name));
  }, [me?.id]);
  if (!supported || !me) return null;
  return (
    <View style={s.orderCard}>
      <Text style={s.sectionTitle}>👆 Fingerprint sign-in {on ? '· On' : ''}</Text>
      <Text style={s.small}>
        {on
          ? 'Sign in on this phone with your fingerprint. A new password turns it off.'
          : 'Skip typing your password: sign in on this phone with your fingerprint.'}
      </Text>
      {on ? (
        <Button
          secondary
          title="Turn off on this phone"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await turnOffFingerprintSignIn();
              setOn(false);
            }, 'Fingerprint sign-in turned off on this phone.')
          }
        />
      ) : open ? (
        <>
          <Field
            label="Your account password"
            value={password}
            secureTextEntry
            onChangeText={setPassword}
            placeholder="To confirm it's you"
          />
          <Button
            title="Turn on fingerprint sign-in"
            disabled={busy || password.length < 10}
            onPress={() =>
              void run(async () => {
                await turnOnFingerprintSignIn(password, me.name);
                setPassword('');
                setOpen(false);
                setOn(true);
              }, 'Fingerprint sign-in is on for this phone.')
            }
          />
        </>
      ) : (
        <Button secondary title="Turn on" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

/** Turn fingerprint payments on (with the PIN) or off, on this phone. */
export function BiometricToggle({ pinSet }: { pinSet: boolean }) {
  const { me, busy, run } = useApp();
  const [supported, setSupported] = useState(false),
    [on, setOn] = useState(false),
    [pin, setPin] = useState(''),
    [open, setOpen] = useState(false);
  useEffect(() => {
    void biometricSupported().then(setSupported);
    if (me?.id) void biometricOn(me.id).then(setOn);
  }, [me?.id]);
  if (!supported || !pinSet) return null;
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>👆 Fingerprint payments {on ? '· On' : ''}</Text>
      <Text style={s.small}>
        {on
          ? 'Confirm payments, transfers and withdrawals with your fingerprint on this phone. Changing your PIN turns it off.'
          : 'Confirm payments with your fingerprint instead of typing your PIN. Enter your PIN once to turn it on.'}
      </Text>
      {on ? (
        <Button
          secondary
          title="Turn off on this phone"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await turnOffBiometric(me.id);
              setOn(false);
            }, 'Fingerprint payments turned off on this phone.')
          }
        />
      ) : open ? (
        <>
          <Field
            label="Transaction PIN"
            value={pin}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={4}
            placeholder="4 digits"
            onChangeText={(v: string) => setPin(v.replace(/\D/g, ''))}
          />
          <Button
            title="Turn on fingerprint payments"
            disabled={busy || pin.length !== 4}
            onPress={() =>
              void run(async () => {
                await turnOnBiometric(me.id, pin);
                setPin('');
                setOpen(false);
                setOn(true);
              }, 'Fingerprint payments are on for this phone.')
            }
          />
        </>
      ) : (
        <Button secondary title="Turn on" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

/**
 * Set or change the transaction PIN. Setting it the first time (or after forgetting it) needs the
 * account password; changing it can use the current PIN.
 */
export default function TransactionPinPanel({
  state,
  onSaved,
  startOpen = false,
}: {
  state: PinState | null;
  onSaved: () => void;
  startOpen?: boolean;
}) {
  const { busy, run } = useApp();
  const [open, setOpen] = useState(startOpen),
    [usePassword, setUsePassword] = useState(false),
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [pin, setPin] = useState(''),
    [again, setAgain] = useState('');
  if (!state) return null;
  const needsPassword = !state.set || usePassword;
  if (!open)
    return (
      <View style={s.locationBox}>
        <Text style={s.bold}>🔒 Transaction PIN</Text>
        <Text style={s.small}>
          {state.set
            ? 'Your PIN protects withdrawals and bank changes.'
            : 'Set a 4-digit PIN. You need it to withdraw money or change your bank account.'}
        </Text>
        {state.locked_until && (
          <Text style={s.fine}>
            Locked after too many wrong PINs until{' '}
            {new Date(state.locked_until).toLocaleTimeString()}. Reset it with your password.
          </Text>
        )}
        <Button
          secondary={state.set}
          title={state.set ? 'Change PIN' : 'Set transaction PIN'}
          onPress={() => setOpen(true)}
        />
      </View>
    );
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>{state.set ? 'Change transaction PIN' : 'Set transaction PIN'}</Text>
      {!state.set && (
        <Text style={s.small}>
          To keep your money safe, you need a 4-digit PIN before you can withdraw or change your
          bank account.
        </Text>
      )}
      {needsPassword ? (
        <Field
          label="Account password"
          value={password}
          secureTextEntry
          autoComplete="current-password"
          onChangeText={setPassword}
        />
      ) : (
        <PinField value={current} onChange={setCurrent} />
      )}
      {state.set && (
        <Pressable onPress={() => setUsePassword(!usePassword)}>
          <Text style={s.link}>
            {usePassword ? 'Use my current PIN instead' : 'Forgot your PIN? Use your password'}
          </Text>
        </Pressable>
      )}
      <Field
        label="New 4-digit PIN"
        value={pin}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={4}
        onChangeText={(v: string) => setPin(v.replace(/\D/g, ''))}
      />
      <Field
        label="Confirm new PIN"
        value={again}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={4}
        onChangeText={(v: string) => setAgain(v.replace(/\D/g, ''))}
      />
      {again.length === 4 && pin !== again && <Text style={s.fine}>The PINs don’t match.</Text>}
      <Button
        title="Save PIN"
        disabled={
          busy ||
          pin.length !== 4 ||
          pin !== again ||
          (needsPassword ? !password : current.length !== 4)
        }
        onPress={() =>
          void run(async () => {
            await request('put', '/me/transaction-pin', {
              body: needsPassword ? { pin, password } : { pin, current_pin: current },
            });
            setOpen(false);
            setPin('');
            setAgain('');
            setPassword('');
            setCurrent('');
            onSaved();
          }, 'Transaction PIN saved.')
        }
      />
      <Pressable onPress={() => setOpen(false)}>
        <Text style={s.link}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/** The Wallet's PIN card: shows whether a PIN is set and lets the user set or change it. */
export function TransactionPinCard() {
  const { state, reload } = useTransactionPin();
  return (
    <>
      <TransactionPinPanel state={state} onSaved={() => void reload()} />
      <BiometricToggle pinSet={!!state?.set} />
    </>
  );
}
