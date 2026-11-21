import { money } from '@zuru/shared';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { startDirectCheckout, type DirectCheckout, type PaymentProvider } from './funding';
import { request } from './request';
import { Button, s } from './ui';

const providerName = (p: string) => (p === 'paystack' ? 'Paystack' : 'Flutterwave');

/**
 * Pay one thing directly at the provider (used when the wallet feature is off): choose a
 * provider, finish paying in its checkout, then return here. The server confirms the payment with
 * the provider itself; nothing is credited from what the app says.
 */
export default function DirectPay({
  amountKobo,
  checkout,
  onPaid,
  paidMessage,
  disabled,
}: {
  amountKobo: number;
  checkout: DirectCheckout;
  onPaid: () => Promise<unknown>;
  paidMessage: string;
  disabled?: boolean;
}) {
  const { settings, busy, run } = useApp();
  const [reference, setReference] = useState<string | null>(null);
  const providers = (settings?.providers ?? []) as PaymentProvider[];
  if (!providers.length)
    return <Text style={s.fine}>Online payment is not available right now.</Text>;
  if (reference)
    return (
      <View style={{ gap: 8 }}>
        <Text style={s.small}>
          Finish paying in the checkout that opened. Your card is never charged twice; if you close
          it by mistake, start again.
        </Text>
        <Button
          title="I’ve paid — confirm"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await request('post', '/wallet/funding/{id}/verify', { params: { id: reference } });
              await onPaid();
              setReference(null);
            }, paidMessage)
          }
        />
      </View>
    );
  return (
    <View style={{ gap: 8 }}>
      {providers.map((provider) => (
        <Button
          key={provider}
          secondary={provider !== providers[0]}
          title={`Pay ${money(amountKobo)} with ${providerName(provider)} ↗`}
          disabled={busy || disabled}
          onPress={() =>
            void run(async () => {
              const c = await startDirectCheckout(provider, checkout);
              setReference(c.reference);
              await Linking.openURL(c.checkout_url);
            })
          }
        />
      ))}
    </View>
  );
}
