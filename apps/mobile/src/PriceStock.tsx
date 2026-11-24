import { money } from '@ahia/shared';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Chip, s } from './ui';
import { SaleEditor } from './Deals';

/**
 * Keep a big shop current in a minute: change prices in one list (or everything by a %), and
 * switch items "out today" or between always-in-stock and counted stock.
 */
export default function PriceStock({ listings, onDone }: { listings: any[]; onDone: () => void }) {
  const { busy, run, refresh } = useApp();
  const live = listings.filter((l) => !l.archived_at);
  const [prices, setPrices] = useState<Record<string, string>>({}),
    [filter, setFilter] = useState(''),
    [saleFor, setSaleFor] = useState<string | null>(null);
  const changed = Object.entries(prices).filter(
    ([id, v]) =>
      Number(v) > 0 && Math.round(Number(v) * 100) !== live.find((l) => l.id === id)?.price_kobo,
  );
  const shown = live.filter((l) => l.title.toLowerCase().includes(filter.toLowerCase()));
  const bump = (percent: number) =>
    void run(
      async () => {
        await request('post', '/sellers/me/listings/prices', { body: { percent } });
        setPrices({});
        await refresh();
      },
      `All prices ${percent > 0 ? 'up' : 'down'} ${Math.abs(percent)}%.`,
    );
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.sectionTitle}>Prices & stock</Text>
      <Text style={s.small}>
        Market moved? Change everything by a percentage, or type new prices below and save once.
      </Text>
      <View style={s.chipWrap}>
        {[-10, -5, 5, 10, 20].map((p) => (
          <Chip
            key={p}
            active={false}
            title={`${p > 0 ? '+' : ''}${p}% all`}
            onPress={() => bump(p)}
          />
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={filter}
        onChangeText={setFilter}
        placeholder="Find a product"
        placeholderTextColor="#8aa698"
      />
      {shown.map((l) => {
        const out = l.out_until && new Date(l.out_until) > new Date();
        return (
          <View key={l.id} style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.bold} numberOfLines={1}>
                {l.title}
              </Text>
              <Text style={s.small}>
                Now {money(l.price_kobo)} / {l.unit} ·{' '}
                {l.stock_mode === 'ALWAYS' ? 'always in stock' : `${l.stock} in stock`}
                {out ? ' · out today' : ''}
              </Text>
              <View style={styles.actions}>
                <Chip
                  title={out ? 'Back in stock' : 'Out today'}
                  active={!!out}
                  onPress={() =>
                    void run(
                      async () => {
                        await request('post', '/listings/{id}/out-today', {
                          params: { id: l.id },
                          body: { out: !out },
                        });
                        await refresh();
                      },
                      out ? 'Back on sale.' : 'Hidden until midnight.',
                    )
                  }
                />
                <Chip
                  title={
                    l.sale_until && new Date(l.sale_until) > new Date()
                      ? '🏷️ On sale'
                      : '🏷️ Put on sale'
                  }
                  active={saleFor === l.id}
                  onPress={() => setSaleFor(saleFor === l.id ? null : l.id)}
                />
                <Chip
                  title={l.stock_mode === 'ALWAYS' ? '∞ Always in stock' : 'Count stock'}
                  active={l.stock_mode === 'ALWAYS'}
                  onPress={() =>
                    void run(async () => {
                      await request('put', '/listings/{id}/stock-mode', {
                        params: { id: l.id },
                        body: { mode: l.stock_mode === 'ALWAYS' ? 'COUNTED' : 'ALWAYS', stock: 1 },
                      });
                      await refresh();
                    })
                  }
                />
              </View>
              {saleFor === l.id && (
                <SaleEditor
                  listing={l}
                  onDone={() => {
                    setSaleFor(null);
                    void refresh();
                  }}
                />
              )}
            </View>
            <TextInput
              style={styles.price}
              value={prices[l.id] ?? ''}
              onChangeText={(v) => setPrices({ ...prices, [l.id]: v.replace(/[^0-9]/g, '') })}
              keyboardType="number-pad"
              placeholder={String(Math.round(l.price_kobo / 100))}
              placeholderTextColor="#8aa698"
              accessibilityLabel={`New price for ${l.title}`}
            />
          </View>
        );
      })}
      <Button
        title={
          changed.length
            ? `Save ${changed.length} new price${changed.length === 1 ? '' : 's'}`
            : 'Type new prices to save'
        }
        disabled={busy || !changed.length}
        onPress={() =>
          void run(async () => {
            await request('post', '/sellers/me/listings/prices', {
              body: {
                items: changed.map(([listing_id, v]) => ({
                  listing_id,
                  price_kobo: Math.round(Number(v) * 100),
                })),
              },
            });
            setPrices({});
            await refresh();
          }, 'Prices updated.')
        }
      />
      <Pressable onPress={onDone}>
        <Text style={s.link}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e1efe7',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  price: {
    width: 100,
    padding: 10,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 8,
    backgroundColor: '#fff',
    fontSize: 15,
  },
});
