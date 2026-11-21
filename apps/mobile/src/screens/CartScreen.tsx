import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppContext';
import { request } from '../request';
import { Button, Empty, FadeIn, produceIcon } from '../ui';

type Cart = Awaited<ReturnType<typeof loadCart>>;
const loadCart = () => request('get', '/cart');

/** The multi-seller cart: lines grouped by seller, then one request per line to each seller. */
export default function CartScreen({ onChanged }: { onChanged: () => void }) {
  const { run, busy, setTab } = useApp();
  const [cart, setCart] = useState<Cart | null>(null);
  const reload = useCallback(async () => {
    setCart(await loadCart());
    onChanged();
  }, [onChanged]);
  useEffect(() => {
    void reload().catch(() => setCart(null));
  }, [reload]);

  const setQuantity = (id: string, quantity: number) =>
    void run(async () => {
      if (quantity < 1) await request('delete', '/cart/{id}', { params: { id } });
      else await request('patch', '/cart/{id}', { params: { id }, body: { quantity } });
      await reload();
    });

  if (!cart) return <ActivityIndicator color="#26408f" style={{ marginTop: 40 }} />;
  if (!cart.line_count)
    return (
      <View style={{ gap: 14 }}>
        <Text style={styles.title}>Your cart</Text>
        <Empty
          title="Your cart is empty"
          text="Add products from any seller, then send all your requests at once."
        />
        <Button title="Browse products" onPress={() => setTab('Market')} />
      </View>
    );
  const blocked = cart.sellers.some((g) => g.lines.some((l) => !l.available));
  return (
    <View style={{ gap: 16 }}>
      <View>
        <Text style={styles.title}>Your cart</Text>
        <Text style={styles.sub}>
          {cart.line_count} item{cart.line_count === 1 ? '' : 's'} from {cart.sellers.length} seller
          {cart.sellers.length === 1 ? '' : 's'}
        </Text>
      </View>
      {cart.sellers.map((group, gi) => (
        <FadeIn key={group.seller_id} delay={gi * 60} style={styles.group}>
          <View style={styles.groupHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.seller}>{group.business_name}</Text>
              <Text style={styles.meta}>
                {group.area}, {group.city} ·{' '}
                {[group.pickup_available && 'Pickup', group.delivery_available && 'Delivery']
                  .filter(Boolean)
                  .join(' or ')}
              </Text>
            </View>
            <Text style={styles.subtotal}>{money(group.subtotal_kobo)}</Text>
          </View>
          {group.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <View style={styles.thumb}>
                {line.thumbnail_url || line.image_url ? (
                  <Image
                    source={{ uri: line.thumbnail_url || line.image_url! }}
                    style={StyleSheet.absoluteFill}
                  />
                ) : (
                  <Text style={{ fontSize: 26 }}>{produceIcon('Other')}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={2} style={styles.lineTitle}>
                  {line.title}
                </Text>
                <Text style={styles.meta}>
                  {line.variant_name !== 'Standard' ? `${line.variant_name} · ` : ''}
                  {money(line.unit_price_kobo)} per {line.unit}
                </Text>
                {line.plan_item_id && <Text style={styles.planTag}>From your plan</Text>}
                {line.problem && <Text style={styles.problem}>{line.problem}</Text>}
                <View style={styles.stepper}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={line.quantity === 1 ? 'Remove' : 'Fewer'}
                    disabled={busy}
                    onPress={() => setQuantity(line.id, line.quantity - 1)}
                    style={styles.step}
                  >
                    <Text style={styles.stepText}>{line.quantity === 1 ? '×' : '−'}</Text>
                  </Pressable>
                  <Text style={styles.qty}>{line.quantity}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="More"
                    disabled={busy}
                    onPress={() => setQuantity(line.id, line.quantity + 1)}
                    style={styles.step}
                  >
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                  <Text style={styles.lineTotal}>{money(line.total_kobo)}</Text>
                </View>
              </View>
            </View>
          ))}
        </FadeIn>
      ))}
      <View style={styles.totalBox}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total for available items</Text>
          <Text style={styles.total}>{money(cart.total_kobo)}</Text>
        </View>
        <Text style={styles.notice}>{cart.notice}</Text>
        {blocked && (
          <Text style={styles.problem}>
            Fix or remove the items marked above before sending your requests.
          </Text>
        )}
        <Button
          title={
            busy
              ? 'Sending…'
              : `Send ${cart.line_count} request${cart.line_count === 1 ? '' : 's'} to sellers`
          }
          disabled={busy || blocked}
          onPress={() =>
            void run(async () => {
              const result = await request('post', '/cart/checkout', { body: {} });
              onChanged();
              setTab('Bookings');
              return result;
            }, 'Requests sent. Pay each seller after they accept.')
          }
        />
        <Text style={styles.fine}>Nothing is charged until a seller accepts.</Text>
      </View>
    </View>
  );
}

const BRAND = '#26408f';
const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: '#18213a', letterSpacing: -0.5 },
  sub: { fontSize: 13, color: '#6b7390', marginTop: 2 },
  group: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e6f0',
    padding: 14,
    gap: 12,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seller: { fontSize: 16, fontWeight: '800', color: '#18213a' },
  meta: { fontSize: 12, color: '#6b7390' },
  subtotal: { fontSize: 15, fontWeight: '800', color: BRAND },
  line: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef0f5',
  },
  thumb: {
    width: 70,
    height: 70,
    borderRadius: 12,
    backgroundColor: '#eef1f8',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineTitle: { fontSize: 14, fontWeight: '700', color: '#18213a' },
  planTag: { fontSize: 11, fontWeight: '700', color: '#b57a10' },
  problem: { fontSize: 12, fontWeight: '700', color: '#a33e32' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  step: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eef1f8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 18, fontWeight: '800', color: BRAND, lineHeight: 20 },
  qty: { fontSize: 15, fontWeight: '800', color: '#18213a', minWidth: 22, textAlign: 'center' },
  lineTotal: { marginLeft: 'auto', fontSize: 14, fontWeight: '800', color: '#18213a' },
  totalBox: { backgroundColor: '#eef1fa', borderRadius: 18, padding: 16, gap: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#18213a' },
  total: { fontSize: 20, fontWeight: '900', color: BRAND },
  notice: { fontSize: 12, color: '#5d6684', lineHeight: 17 },
  fine: { fontSize: 11, color: '#7e86a0', textAlign: 'center' },
});
