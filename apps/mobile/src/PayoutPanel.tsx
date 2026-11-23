import { money, type PayoutSummary } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Badge, Button, Field, s } from './ui';
import TransactionPinPanel, { PinField, useTransactionPin } from './TransactionPin';
import BvnVerify from './BvnVerify';

type PayoutData = PayoutSummary;

/**
 * Withdraw to a bank account. source="earnings": a seller's or driver's proceeds;
 * source="wallet": money the user added to their wallet.
 */
export default function PayoutPanel({
  source = 'earnings',
  onDone,
}: {
  source?: 'earnings' | 'wallet';
  onDone?: () => void;
}) {
  const { busy, run, seller } = useApp();
  const [data, setData] = useState<PayoutData | null>(null),
    [banks, setBanks] = useState<{ code: string; name: string }[]>([]),
    [bankSearch, setBankSearch] = useState(''),
    [bankCode, setBankCode] = useState(''),
    [accountNumber, setAccountNumber] = useState(''),
    [resolved, setResolved] = useState<{ account_name: string; name_match: boolean } | null>(null),
    [editing, setEditing] = useState(false),
    [amount, setAmount] = useState(''),
    [loadError, setLoadError] = useState(''),
    [pin, setPin] = useState('');
  const pinStatus = useTransactionPin();
  const pinReady = pin.length === 4;
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
  const fromWallet = source === 'wallet';
  const available = fromWallet ? (data.wallet_kobo ?? 0) : data.available_kobo;
  const pending = data.payouts.some((p) => ['REQUESTED', 'PROCESSING'].includes(p.status));
  const kobo = Math.round(Number(amount) * 100);
  const visibleBanks = banks
    .filter((b) => b.name.toLowerCase().includes(bankSearch.toLowerCase()))
    .slice(0, 8);
  return (
    <View style={s.orderCard}>
      <Text style={s.label}>
        {fromWallet ? 'Wallet balance you can withdraw' : 'Earnings available to withdraw'}
      </Text>
      <Text style={s.price}>{money(available)}</Text>
      <Text style={s.fine}>
        {fromWallet
          ? 'Withdrawals go to your bank after a quick review.'
          : 'Recorded after confirmed pickups, minus commission.'}{' '}
        Minimum {money(data.min_kobo)} · transfer fee {money(data.fee_kobo)}.
        {data.mode === 'simulated' ? ' Development mode: payouts are simulated.' : ''}
      </Text>
      <SafetyNotes data={data} fromWallet={fromWallet} onVerified={() => void load()} />
      {pinStatus.state?.set === false ? (
        // No PIN yet: money can't leave the account until one is set.
        <TransactionPinPanel
          state={pinStatus.state}
          startOpen
          onSaved={() => void pinStatus.reload()}
        />
      ) : data.mode === 'disabled' ? (
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
                  <PinField value={pin} onChange={setPin} />
                  <Button
                    title="Save bank account"
                    disabled={busy || !pinReady}
                    onPress={() =>
                      void run(async () => {
                        await request('post', '/payouts/accounts', {
                          body: {
                            bank_code: bankCode,
                            account_number: accountNumber,
                            transaction_pin: pin,
                          },
                        });
                        setPin('');
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
            placeholder={(available / 100).toString()}
          />
          {kobo > data.fee_kobo && (
            <Text style={s.fine}>
              You will receive {money(kobo - data.fee_kobo)} after the transfer fee.
            </Text>
          )}
          {!!kobo && (kobo < data.min_kobo || kobo > available) && (
            <Text style={s.fine}>
              {kobo > available
                ? `That’s more than the ${money(available)} you have.`
                : `The minimum withdrawal is ${money(data.min_kobo)}.`}
            </Text>
          )}
          <PinField value={pin} onChange={setPin} />
          <Button
            title="Withdraw to bank"
            disabled={busy || !kobo || kobo < data.min_kobo || kobo > available || !pinReady}
            onPress={() =>
              void run(async () => {
                await request('post', '/payouts', {
                  body: { amount_kobo: kobo, source, transaction_pin: pin },
                });
                setAmount('');
                setPin('');
                await load();
                onDone?.();
              }, 'Withdrawal requested. We review it, then send it to your bank.')
            }
          />
        </>
      )}
      {!!data.payouts.length && <Text style={s.sectionTitle}>Withdrawals</Text>}
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
                  }, 'Withdrawal cancelled. The money is back where it came from.')
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

/** Holds, limits, pauses and identity: why a withdrawal might be smaller or later than expected. */
function SafetyNotes({
  data,
  fromWallet,
  onVerified,
}: {
  data: PayoutData;
  fromWallet: boolean;
  onVerified: () => void;
}) {
  const l: any = (data as any).limits;
  const held = fromWallet ? (data as any).held_wallet_kobo : (data as any).held_earnings_kobo;
  const account: any = data.account;
  if (!l) return null;
  return (
    <View style={{ gap: 8 }}>
      {l.frozen && (
        <Text style={s.fine}>
          ⛔ Your account is on hold while our team reviews it. Contact support.
        </Text>
      )}
      {l.locked_until && (
        <Text style={s.fine}>
          ⏸️ For your safety, withdrawals are paused until{' '}
          {new Date(l.locked_until).toLocaleString()} after a {l.lock_reason}.
        </Text>
      )}
      {held > 0 && (
        <Text style={s.small}>
          ⏳ {money(held)}{' '}
          {fromWallet
            ? 'from recent card top-ups can be withdrawn 48 hours after payment (you can still spend it now).'
            : 'of new earnings is held for 5 days in case a buyer disputes. This stops after 10 completed jobs.'}
        </Text>
      )}
      {account && !account.name_match && !account.staff_allowed && (
        <Text style={s.fine}>
          ⚠️ This bank account isn’t in your name, so withdrawals to it are blocked. Add your own
          account, or ask support to check it.
        </Text>
      )}
      <Text style={s.small}>
        Limits ({l.level.toLowerCase()}): {money(l.daily_limit_kobo - l.daily_used_kobo)} left today
        of {money(l.daily_limit_kobo)} · {money(l.monthly_limit_kobo - l.monthly_used_kobo)} left
        this month.
      </Text>
      {l.level === 'BASIC' && <BvnVerify onVerified={onVerified} />}
    </View>
  );
}
