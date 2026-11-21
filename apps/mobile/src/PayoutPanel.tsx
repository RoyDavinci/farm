import { money, type PayoutSummary } from '@zuru/shared';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Badge, Button, Field, s } from './ui';

type PayoutData = PayoutSummary;

export default function PayoutPanel() {
  const { busy, run, seller } = useApp();
  const [data, setData] = useState<PayoutData | null>(null),
    [banks, setBanks] = useState<{ code: string; name: string }[]>([]),
    [bankSearch, setBankSearch] = useState(''),
    [bankCode, setBankCode] = useState(''),
    [accountNumber, setAccountNumber] = useState(''),
    [resolved, setResolved] = useState<{ account_name: string; name_match: boolean } | null>(null),
    [editing, setEditing] = useState(false),
    [amount, setAmount] = useState(''),
    [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await request('get', '/payouts'));
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  // Sellers and approved drivers both have earnings to withdraw; others see nothing.
  useEffect(() => {
    void load();
  }, [seller?.status, load]);
  async function openEditor() {
    setEditing(true);
    setResolved(null);
    if (!banks.length) {
      await run(async () => setBanks((await request('get', '/payouts/banks')).banks));
    }
  }
  if (loadError.includes('available to sellers')) return null;
  if (!data)
    return (
      <View style={s.orderCard}>
        <Text style={s.label}>Seller payouts</Text>
        <Text style={s.fine}>{loadError || 'Loading your proceeds…'}</Text>
      </View>
    );
  const pending = data.payouts.some((p) => ['REQUESTED', 'PROCESSING'].includes(p.status));
  const kobo = Math.round(Number(amount) * 100);
  const visibleBanks = banks
    .filter((b) => b.name.toLowerCase().includes(bankSearch.toLowerCase()))
    .slice(0, 8);
  return (
    <View style={s.orderCard}>
      <Text style={s.label}>Earnings available to withdraw</Text>
      <Text style={s.price}>{money(data.available_kobo)}</Text>
      <Text style={s.fine}>
        Recorded after confirmed pickups, minus commission. Minimum payout {money(data.min_kobo)} ·
        transfer fee {money(data.fee_kobo)}.
        {data.mode === 'simulated' ? ' Development mode: payouts are simulated.' : ''}
      </Text>
      {data.mode === 'disabled' ? (
        <Text style={s.body}>Bank payouts are not enabled on this server yet.</Text>
      ) : editing || !data.account ? (
        <>
          <Text style={s.sectionTitle}>Payout bank account</Text>
          <Text style={s.fine}>
            We confirm the account holder’s name with the bank before saving. Only the last four
            digits are shown afterwards.
          </Text>
          {!banks.length && (
            <Button
              secondary
              title="Choose your bank"
              disabled={busy}
              onPress={() => void openEditor()}
            />
          )}
          {!!banks.length && (
            <>
              <Field
                label="Bank"
                value={bankSearch}
                onChangeText={(v: string) => {
                  setBankSearch(v);
                  setBankCode('');
                  setResolved(null);
                }}
                placeholder="Search for your bank"
              />
              {!bankCode && (
                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                  {visibleBanks.map((b) => (
                    <Pressable
                      key={b.code}
                      onPress={() => {
                        setBankCode(b.code);
                        setBankSearch(b.name);
                        setResolved(null);
                      }}
                      style={{ paddingVertical: 10 }}
                    >
                      <Text style={s.body}>{b.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              <Field
                label="10-digit account number"
                value={accountNumber}
                keyboardType="number-pad"
                maxLength={10}
                onChangeText={(v: string) => {
                  setAccountNumber(v.replace(/\D/g, ''));
                  setResolved(null);
                }}
              />
              {resolved ? (
                <>
                  <View style={s.locationBox}>
                    <Text style={s.small}>ACCOUNT HOLDER</Text>
                    <Text style={s.bold}>{resolved.account_name}</Text>
                    {!resolved.name_match && (
                      <Text style={s.fine}>
                        This name does not match your profile or business name. An administrator
                        will check it before paying out.
                      </Text>
                    )}
                  </View>
                  <Button
                    title="Save bank account"
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/payouts/accounts', {
                          body: {
                            bank_code: bankCode,
                            account_number: accountNumber,
                          },
                        });
                        setEditing(false);
                        setAccountNumber('');
                        setResolved(null);
                        await load();
                      }, 'Payout account saved.')
                    }
                  />
                </>
              ) : (
                <Button
                  title="Confirm account name"
                  disabled={busy || !bankCode || accountNumber.length !== 10}
                  onPress={() =>
                    void run(async () =>
                      setResolved(
                        await request('post', '/payouts/accounts/resolve', {
                          body: {
                            bank_code: bankCode,
                            account_number: accountNumber,
                          },
                        }),
                      ),
                    )
                  }
                />
              )}
              {data.account && (
                <Pressable onPress={() => setEditing(false)}>
                  <Text style={s.link}>Keep current account</Text>
                </Pressable>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <View style={s.locationBox}>
            <Text style={s.small}>PAYOUTS GO TO</Text>
            <Text style={s.bold}>
              {data.account.bank_name} ••••{data.account.account_last4}
            </Text>
            <Text style={s.body}>{data.account.account_name}</Text>
            {!pending && (
              <Pressable onPress={() => void openEditor()}>
                <Text style={s.link}>Change bank account</Text>
              </Pressable>
            )}
          </View>
          <Field
            label="Amount to withdraw (₦)"
            value={amount}
            keyboardType="decimal-pad"
            onChangeText={setAmount}
            placeholder={(data.available_kobo / 100).toString()}
          />
          {kobo > data.fee_kobo && (
            <Text style={s.fine}>
              You will receive {money(kobo - data.fee_kobo)} after the transfer fee.
            </Text>
          )}
          <Button
            title="Request payout"
            disabled={busy || !kobo || kobo < data.min_kobo || kobo > data.available_kobo}
            onPress={() =>
              void run(async () => {
                await request('post', '/payouts', { body: { amount_kobo: kobo } });
                setAmount('');
                await load();
              }, 'Payout requested. We review payouts before sending them to your bank.')
            }
          />
        </>
      )}
      {!!data.payouts.length && <Text style={s.sectionTitle}>Payout history</Text>}
      {data.payouts.map((p) => (
        <View key={p.id} style={s.walletEntry}>
          <View style={s.flex}>
            <Text style={s.bold}>
              {money(Number(p.amount_kobo) - Number(p.fee_kobo))} → ••••{p.account_last4}
            </Text>
            <Text style={s.small}>{new Date(p.created_at).toLocaleString()}</Text>
            {p.failure_reason && <Text style={s.fine}>{p.failure_reason}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Badge status={p.status} />
            {p.status === 'REQUESTED' && (
              <Pressable
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await request('post', '/payouts/{id}/cancel', { params: { id: p.id } });
                    await load();
                  }, 'Payout cancelled. The amount is back in your proceeds.')
                }
              >
                <Text style={s.link}>Cancel</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
