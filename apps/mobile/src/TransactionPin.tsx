import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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

/** A 4-digit PIN box for confirming a withdrawal or bank change. */
export function PinField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="Transaction PIN"
      value={value}
      secureTextEntry
      keyboardType="number-pad"
      maxLength={4}
      placeholder="4 digits"
      onChangeText={(v: string) => onChange(v.replace(/\D/g, ''))}
    />
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
  return <TransactionPinPanel state={state} onSaved={() => void reload()} />;
}
