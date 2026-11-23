import { money, statusLabel } from '@ahia/shared';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { describeFunding, startCheckout, type FundingRow, type PaymentProvider } from '../funding';
import { featureOn } from '../features';
import { useI18n } from '../i18n';
import PayoutPanel from '../PayoutPanel';
import { TransactionPinCard } from '../TransactionPin';
import { request } from '../request';
import { Badge, Button, Chip, Field, s } from '../ui';

export interface WalletData {
  balance_kobo: number;
  seller_payable_kobo: number;
  entries: any[];
  funding: FundingRow[];
  refunds?: {
    id: string;
    amount_kobo: number;
    status: string;
    provider: string;
    created_at: string;
  }[];
}
export default function WalletScreen({ wallet }: { wallet: WalletData }) {
  const { seller, settings, busy, run, refresh } = useApp();
  const [fund, setFund] = useState('5000');
  const [panel, setPanel] = useState<'deposit' | 'withdraw' | null>(null);
  const [withdrawFrom, setWithdrawFrom] = useState<'wallet' | 'earnings'>('wallet');
  /** Opens the provider's checkout; the wallet is credited when the payment is confirmed. */
  const deposit = (provider: PaymentProvider, method: 'card' | 'any') =>
    run(async () => {
      const d = await startCheckout(provider, Math.round(Number(fund) * 100), method);
      await Linking.openURL(d.checkout_url);
    }, 'Finish paying on the secure page. Your balance updates once it’s confirmed.');
  const { t } = useI18n();
  const field = (label: string, value: string, onChange: (v: string) => void, extra: any = {}) => (
    <Field label={label} value={value} onChangeText={onChange} {...extra} />
  );
  if (!featureOn(settings, 'wallet')) return <PaymentsView wallet={wallet} />;
  return (
    <>
      <Text style={s.eyebrow}>{t('wallet.eyebrow')}</Text>
      <Text style={s.heading}>{t('wallet.heading')}</Text>
      <View style={s.balanceCard}>
        <Text style={s.heroEyebrow}>
          {settings?.payment_mode === 'demo' ? 'SIMULATED BALANCE' : 'AVAILABLE BALANCE'}
        </Text>
        <Text style={s.balance}>{money(wallet.balance_kobo)}</Text>
        <Text style={s.heroText}>NGN · Pay for accepted bookings</Text>
        {!!seller && (
          <Text style={s.heroText}>Sales earnings: {money(wallet.seller_payable_kobo)}</Text>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={[styles.action, panel === 'deposit' && styles.actionOn]}
          onPress={() => setPanel(panel === 'deposit' ? null : 'deposit')}
        >
          <Text style={[styles.actionIcon, panel === 'deposit' && styles.actionTextOn]}>＋</Text>
          <Text style={[styles.actionText, panel === 'deposit' && styles.actionTextOn]}>
            Deposit
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.action, panel === 'withdraw' && styles.actionOn]}
          onPress={() => setPanel(panel === 'withdraw' ? null : 'withdraw')}
        >
          <Text style={[styles.actionIcon, panel === 'withdraw' && styles.actionTextOn]}>↗</Text>
          <Text style={[styles.actionText, panel === 'withdraw' && styles.actionTextOn]}>
            Withdraw
          </Text>
        </Pressable>
      </View>
      {panel === 'deposit' && (
        <View style={s.orderCard}>
          <Text style={s.cardTitle}>Add money to your wallet</Text>
          {field('Amount (₦)', fund, (v: string) => setFund(v.replace(/[^0-9]/g, '')), {
            keyboardType: 'number-pad',
          })}
          <View style={s.chipWrap}>
            {[1000, 5000, 10000, 20000].map((n) => (
              <Chip
                key={n}
                title={money(n * 100)}
                active={Number(fund) === n}
                onPress={() => setFund(String(n))}
              />
            ))}
          </View>
          {Number(fund) > 0 && Number(fund) < 100 && (
            <Text style={s.fine}>The smallest deposit is ₦100.</Text>
          )}
          {settings?.providers.includes('paystack') && (
            <Button
              title={`💳 Pay ${money(Math.round(Number(fund) * 100))} with card`}
              disabled={busy || !(Number(fund) >= 100)}
              onPress={() => void deposit('paystack', 'card')}
            />
          )}
          {settings?.providers.includes('flutterwave') && (
            <Button
              secondary
              title="Other ways to pay (Flutterwave) ↗"
              disabled={busy || !(Number(fund) >= 100)}
              onPress={() => void deposit('flutterwave', 'any')}
            />
          )}
          {settings?.payment_mode === 'demo' && (
            <Button
              secondary
              title="Add simulated funds (development)"
              disabled={busy}
              onPress={() =>
                void run(
                  () =>
                    request('post', '/wallet/demo-fund', {
                      body: {
                        amount_kobo: Math.round(Number(fund) * 100),
                      },
                    }),
                  'Simulated funds added. This is not real money.',
                )
              }
            />
          )}
          <Text style={s.fine}>
            You pay on Paystack’s secure page; Ahia never sees your card number. Your wallet is
            credited as soon as the payment is confirmed.
          </Text>
        </View>
      )}
      {panel === 'withdraw' && (
        <>
          {!!seller && (
            <View style={s.chipWrap}>
              <Chip
                title="From wallet balance"
                active={withdrawFrom === 'wallet'}
                onPress={() => setWithdrawFrom('wallet')}
              />
              <Chip
                title="From sales earnings"
                active={withdrawFrom === 'earnings'}
                onPress={() => setWithdrawFrom('earnings')}
              />
            </View>
          )}
          <PayoutPanel
            key={withdrawFrom}
            source={seller ? withdrawFrom : 'wallet'}
            onDone={() => void refresh()}
          />
        </>
      )}
      <TransactionPinCard />
      {settings?.payment_mode === 'disabled' && (
        <Text style={s.body}>Wallet funding is not enabled on this server.</Text>
      )}
      {/* Top-ups that still need attention, plus the latest completed ones. */}
      {wallet.funding
        .filter((f: FundingRow, i: number) => f.status !== 'SUCCESSFUL' || i < 3)
        .map((f: FundingRow) => {
          const info = describeFunding(f);
          return (
            <View style={s.orderCard} key={f.id}>
              <View style={s.rowBetween}>
                <Text style={s.bold}>
                  {money(f.amount_kobo)} · {f.provider === 'paystack' ? 'Paystack' : 'Flutterwave'}
                </Text>
                <Badge status={f.status === 'SUCCESSFUL' ? 'COMPLETED' : f.status} />
              </View>
              <Text style={s.small}>
                {info.label} · {new Date(f.created_at).toLocaleString()}
              </Text>
              {!!info.detail && <Text style={s.fine}>{info.detail}</Text>}
              {info.reopen && f.checkout_url && (
                <Button
                  secondary
                  title="Open checkout again ↗"
                  disabled={busy}
                  onPress={() => void Linking.openURL(f.checkout_url!)}
                />
              )}
              {info.verify && (
                <Button
                  secondary
                  title="Verify payment"
                  disabled={busy}
                  onPress={() =>
                    void run(
                      () =>
                        request('post', '/wallet/funding/{id}/verify', { params: { id: f.id } }),
                      'Payment verified and wallet credited.',
                    )
                  }
                />
              )}
            </View>
          );
        })}
      <Text style={s.sectionTitle}>{t('wallet.recent')}</Text>
      {wallet.entries.length ? (
        wallet.entries.map((e: any) => (
          <View key={e.id} style={s.walletEntry}>
            <View style={s.flex}>
              <Text style={s.bold}>{statusLabel(e.account)}</Text>
              <Text style={s.small}>{new Date(e.created_at).toLocaleString()}</Text>
            </View>
            <Text
              style={[
                s.bold,
                {
                  color: Number(e.amount_kobo) > 0 ? '#287750' : '#8b6047',
                },
              ]}
            >
              {Number(e.amount_kobo) > 0 ? '+' : ''}
              {money(Number(e.amount_kobo))}
            </Text>
          </View>
        ))
      ) : (
        <Text style={s.muted}>Your wallet activity will appear here.</Text>
      )}
    </>
  );
}

const refundLabel: Record<string, string> = {
  PENDING: 'Refund queued',
  SENDING: 'Refund in progress',
  REFUNDED: 'Refunded to your card',
  FAILED: 'Refund being checked by our team',
};

/**
 * Wallet feature off (pilot): no balance and no top-ups. Buyers see each payment and any refund
 * going back to their card; sellers withdraw their proceeds here.
 */
function PaymentsView({ wallet }: { wallet: WalletData }) {
  const { seller, busy, run } = useApp();
  return (
    <>
      <Text style={s.eyebrow}>PAYMENTS</Text>
      <Text style={s.heading}>Payments and refunds</Text>
      <Text style={s.subtitle}>
        You pay for each booking or delivery at checkout. If an order is cancelled or refunded, the
        money goes back to the card or account you paid with.
      </Text>
      {seller && <PayoutPanel />}
      <Text style={s.sectionTitle}>Your payments</Text>
      {wallet.funding.length ? (
        wallet.funding.map((f: FundingRow) => {
          const info = describeFunding(f);
          return (
            <View style={s.orderCard} key={f.id}>
              <View style={s.rowBetween}>
                <Text style={s.bold}>
                  {money(f.amount_kobo)} · {f.provider === 'paystack' ? 'Paystack' : 'Flutterwave'}
                </Text>
                <Badge status={f.status === 'SUCCESSFUL' ? 'COMPLETED' : f.status} />
              </View>
              <Text style={s.small}>
                {f.status === 'SUCCESSFUL' ? 'Paid' : info.label} ·{' '}
                {new Date(f.created_at).toLocaleString()}
              </Text>
              {info.verify && (
                <Button
                  secondary
                  title="Check payment"
                  disabled={busy}
                  onPress={() =>
                    void run(
                      () =>
                        request('post', '/wallet/funding/{id}/verify', { params: { id: f.id } }),
                      'Payment confirmed.',
                    )
                  }
                />
              )}
            </View>
          );
        })
      ) : (
        <Text style={s.muted}>Your payments will appear here.</Text>
      )}
      {!!wallet.refunds?.length && <Text style={s.sectionTitle}>Refunds</Text>}
      {wallet.refunds?.map((r) => (
        <View key={r.id} style={s.walletEntry}>
          <View style={s.flex}>
            <Text style={s.bold}>{refundLabel[r.status] ?? r.status}</Text>
            <Text style={s.small}>{new Date(r.created_at).toLocaleString()}</Text>
          </View>
          <Text style={s.bold}>{money(r.amount_kobo)}</Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 12, marginVertical: 4 },
  action: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#cfe3d6',
  },
  actionOn: { backgroundColor: '#1f754a', borderColor: '#1f754a' },
  actionIcon: { fontSize: 22, fontWeight: '800', color: '#1f754a' },
  actionText: { fontSize: 15, fontWeight: '800', color: '#0c3a25' },
  actionTextOn: { color: '#fff' },
});
