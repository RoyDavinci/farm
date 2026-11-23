import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Field, s } from './ui';

/**
 * Verify identity with a BVN through Flutterwave. The customer approves on the NIBSS consent page,
 * then comes back; verified accounts get higher withdrawal limits.
 */
export default function BvnVerify({ onVerified }: { onVerified?: () => void }) {
  const { busy, run } = useApp();
  const [kyc, setKyc] = useState<any>(null),
    [bvn, setBvn] = useState(''),
    [first, setFirst] = useState(''),
    [last, setLast] = useState('');
  const load = useCallback(
    () =>
      request('get', '/me/kyc')
        .then(setKyc)
        .catch(() => setKyc(null)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const pending = kyc?.check?.status === 'PENDING' ? kyc.check : null;
  const refresh = useCallback(async () => {
    if (!pending) return;
    const c = await request('post', '/me/kyc/bvn/{id}/refresh', {
      params: { id: pending.id },
      body: {},
    });
    await load();
    if (c.status === 'VERIFIED') onVerified?.();
  }, [pending, load, onVerified]);
  // Coming back from the consent page: check straight away.
  useEffect(() => {
    if (!pending) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh().catch(() => {});
    });
    return () => sub.remove();
  }, [pending, refresh]);
  if (!kyc?.available) return null;
  if (kyc.bvn_verified)
    return (
      <View style={s.locationBox}>
        <Text style={s.bold}>✅ Identity verified</Text>
        <Text style={s.small}>
          BVN confirmed as {kyc.verified_name}. Your withdrawal limits are higher.
        </Text>
      </View>
    );
  return (
    <View style={s.locationBox}>
      <Text style={s.bold}>🪪 Verify your BVN</Text>
      <Text style={s.small}>
        Confirms it’s really you, protects your account and raises your withdrawal limits. You
        approve the check on the official NIBSS page; we never see your bank details.
      </Text>
      {kyc.check?.status === 'MISMATCH' && (
        <Text style={s.fine}>
          ⚠️ {kyc.check.reason} Use your own BVN, or contact support if your name changed.
        </Text>
      )}
      {pending ? (
        <>
          <Text style={s.small}>
            Waiting for you to approve BVN ••••{pending.bvn_last4} on the NIBSS page.
          </Text>
          {pending.consent_url && (
            <Button
              secondary
              title="Open the approval page"
              onPress={() => void Linking.openURL(pending.consent_url)}
            />
          )}
          <Button
            title="I’ve approved it — check now"
            disabled={busy}
            onPress={() => void run(refresh)}
          />
        </>
      ) : (
        <>
          <Field
            label="BVN (11 digits)"
            value={bvn}
            keyboardType="number-pad"
            maxLength={11}
            onChangeText={(v: string) => setBvn(v.replace(/\D/g, ''))}
          />
          <Field label="First name (as on your BVN)" value={first} onChangeText={setFirst} />
          <Field label="Last name" value={last} onChangeText={setLast} />
          <Button
            title="Verify with Flutterwave"
            disabled={
              busy || bvn.length !== 11 || first.trim().length < 2 || last.trim().length < 2
            }
            onPress={() =>
              void run(async () => {
                const c = await request('post', '/me/kyc/bvn', {
                  body: { bvn, first_name: first.trim(), last_name: last.trim() },
                });
                await load();
                if (c.consent_url) await Linking.openURL(c.consent_url);
                else if (c.status === 'VERIFIED') onVerified?.();
              })
            }
          />
        </>
      )}
    </View>
  );
}
