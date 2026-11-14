import React, { useState } from 'react';
import { View, Text, Linking } from 'react-native';
import { money, statusLabel } from '@farmers-market/shared';
import { api } from '../api';
import PayoutPanel from '../PayoutPanel';
import { Field, Button, Chip, Badge, Empty, Back, s } from '../ui';
import { useApp } from '../AppContext';
import { useI18n } from '../i18n';

export interface WalletData {
  balance_kobo: number;
  seller_payable_kobo: number;
  entries: any[];
  funding: any[];
}
export default function WalletScreen({ wallet }: { wallet: WalletData }) {
  const { seller, settings, busy, run } = useApp();
  const [fund, setFund] = useState('5000');
  const { t } = useI18n();
  const field = (label: string, value: string, onChange: (v: string) => void, extra: any = {}) => (
    <Field label={label} value={value} onChangeText={onChange} {...extra} />
  );
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
                api('/wallet/demo-fund', 'POST', {
                  amount_kobo: Math.round(Number(fund) * 100),
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
              const d = await api('/wallet/fund', 'POST', {
                provider,
                amount_kobo: Math.round(Number(fund) * 100),
              });
              await Linking.openURL(d.checkout_url);
            }, 'Complete payment in the provider’s checkout, then verify it below.')
          }
        />
      ))}
      {settings?.payment_mode === 'disabled' && (
        <Text style={s.body}>Wallet funding is not enabled on this server.</Text>
      )}
      {wallet.funding
        .filter((f: any) => f.status === 'PENDING')
        .map((f: any) => (
          <View style={s.orderCard} key={f.id}>
            <Text style={s.bold}>
              {money(f.amount_kobo)} · {f.provider}
            </Text>
            <Button
              secondary
              title="Verify completed payment"
              disabled={busy}
              onPress={() =>
                void run(
                  () => api(`/wallet/funding/${f.id}/verify`, 'POST'),
                  'Payment verified and wallet credited.',
                )
              }
            />
          </View>
        ))}
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
                  color: Number(e.amount_kobo) > 0 ? '#527d45' : '#8b6047',
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
