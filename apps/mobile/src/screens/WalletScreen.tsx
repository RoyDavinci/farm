import { money, statusLabel } from '@ahia/shared';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { describeFunding, startCheckout, type FundingRow, type PaymentProvider } from '../funding';
import { featureOn } from '../features';
import { useI18n } from '../i18n';
import PayoutPanel from '../PayoutPanel';
import { request } from '../request';
import { Badge, Button, Field, s } from '../ui';

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
  const { seller, settings, busy, run } = useApp();
  const [fund, setFund] = useState('5000');
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
      </View>
      <PayoutPanel />
      {field('Amount to add (₦)', fund, setFund, {
        keyboardType: 'decimal-pad',
      })}
      {settings?.payment_mode === 'demo' && (
        <Button
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
      )}{' '}
      {settings?.providers.map((provider) => (
        <Button
          key={provider}
          secondary
          title={`Add money with ${provider === 'paystack' ? 'Paystack' : 'Flutterwave'} ↗`}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              const d = await startCheckout(
                provider as PaymentProvider,
                Math.round(Number(fund) * 100),
              );
              await Linking.openURL(d.checkout_url);
            }, 'Complete payment in the provider’s checkout, then verify it below.')
          }
        />
      ))}
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
                  color: Number(e.amount_kobo) > 0 ? '#314991' : '#8b6047',
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
