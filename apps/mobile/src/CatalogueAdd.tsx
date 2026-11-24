import { money } from '@ahia/shared';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';
import { Button, Chip, Field, s } from './ui';

type Product = {
  id: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  photo: string | null;
  sellers: number;
  min_price_kobo: number | null;
  max_price_kobo: number | null;
  listed: boolean;
};
type Pick = { price: string; always: boolean; used: boolean };

const CATEGORIES = [
  'Phones & electronics',
  'Food & groceries',
  'Beauty & personal care',
  'Home & kitchen',
  'Baby & kids',
  'Vegetables',
  'Fruit',
  'Grains',
  'Tubers',
  'Livestock',
];

/**
 * Add products from the shared catalogue: tick what you sell, type prices, save. No photos or
 * descriptions needed: shared photos are added for you (labelled "representative photo").
 */
export default function CatalogueAdd({ onDone }: { onDone: () => void }) {
  const { busy, run, refresh } = useApp();
  const [q, setQ] = useState(''),
    [category, setCategory] = useState(''),
    [items, setItems] = useState<Product[] | null>(null),
    [picked, setPicked] = useState<Record<string, Pick & { product: Product }>>({}),
    [adding, setAdding] = useState(false),
    [form, setForm] = useState({ name: '', brand: '', unit: 'piece' });
  const search = useCallback(
    () =>
      request('get', '/catalogue/products', { query: { q, category } as any })
        .then((r) => setItems(r as Product[]))
        .catch(() => setItems([])),
    [q, category],
  );
  useEffect(() => {
    const t = setTimeout(() => void search(), 250);
    return () => clearTimeout(t);
  }, [search]);
  const toggle = (p: Product) =>
    setPicked((m) => {
      const next = { ...m };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = { product: p, price: '', always: true, used: false };
      return next;
    });
  const chosen = Object.values(picked);
  const ready = chosen.length > 0 && chosen.every((c) => Number(c.price) >= 1);
  const noPrice = chosen.filter((c) => !(Number(c.price) >= 1));
  // What other sellers charge (the middle of their range), for filling many prices at once.
  const usual = (p: Product) =>
    p.min_price_kobo != null
      ? String(Math.round((p.min_price_kobo + (p.max_price_kobo ?? p.min_price_kobo)) / 2 / 100))
      : '';
  const open = (items || []).filter((p) => !p.listed);
  const allTicked = open.length > 0 && open.every((p) => picked[p.id]);
  return (
    <View style={{ gap: 14 }}>
      <Text style={s.sectionTitle}>Add from the catalogue</Text>
      <Text style={s.small}>
        Tick what you sell and type your price. No photos needed: shared product photos are added
        for you. Big shop? Add dozens at once.
      </Text>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={setQ}
        placeholder="Search e.g. iPhone 15, Peak milk, rice 50kg"
        placeholderTextColor="#8aa698"
        accessibilityLabel="Search the catalogue"
      />
      <View style={s.chipWrap}>
        <Chip title="All" active={!category} onPress={() => setCategory('')} />
        {CATEGORIES.map((c) => (
          <Chip key={c} title={c} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </View>
      {!!open.length && (
        <View style={s.chipWrap}>
          <Chip
            title={allTicked ? `Untick all ${open.length}` : `Tick all ${open.length} shown`}
            active={allTicked}
            onPress={() =>
              setPicked((m) => {
                const next = { ...m };
                for (const p of open)
                  if (allTicked) delete next[p.id];
                  else next[p.id] ??= { product: p, price: '', always: true, used: false };
                return next;
              })
            }
          />
          {noPrice.some((c) => usual(c.product)) && (
            <Chip
              title="Use the usual price for the blanks"
              active={false}
              onPress={() =>
                setPicked((m) => {
                  const next = { ...m };
                  for (const c of Object.values(next))
                    if (!(Number(c.price) >= 1) && usual(c.product))
                      next[c.product.id] = { ...c, price: usual(c.product) };
                  return next;
                })
              }
            />
          )}
        </View>
      )}
      {!items ? (
        <ActivityIndicator />
      ) : (
        items.map((p) => {
          const pick = picked[p.id];
          return (
            <View key={p.id} style={[styles.row, pick && styles.rowOn]}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!pick, disabled: p.listed }}
                disabled={p.listed}
                onPress={() => toggle(p)}
                style={styles.rowTop}
              >
                <Text style={styles.box}>{p.listed ? '✓' : pick ? '☑' : '☐'}</Text>
                {p.photo ? (
                  <Image source={{ uri: p.photo }} style={styles.photo} />
                ) : (
                  <View style={[styles.photo, styles.noPhoto]}>
                    <Text style={{ fontSize: 18 }}>📦</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.bold}>{p.name}</Text>
                  <Text style={s.small}>
                    {p.listed
                      ? 'Already in your shop'
                      : `per ${p.unit}${p.sellers ? ` · ${p.sellers} seller${p.sellers === 1 ? '' : 's'}: ${money(p.min_price_kobo!)}${p.max_price_kobo !== p.min_price_kobo ? `–${money(p.max_price_kobo!)}` : ''}` : ''}`}
                  </Text>
                </View>
              </Pressable>
              {pick && (
                <View style={styles.pickRow}>
                  <TextInput
                    style={styles.price}
                    value={pick.price}
                    onChangeText={(v) =>
                      setPicked((m) => ({
                        ...m,
                        [p.id]: { ...pick, price: v.replace(/[^0-9]/g, '') },
                      }))
                    }
                    keyboardType="number-pad"
                    placeholder="Price ₦"
                    placeholderTextColor="#8aa698"
                    accessibilityLabel={`Price for ${p.name}`}
                  />
                  <Chip
                    title={pick.always ? '∞ Always in stock' : 'Count stock'}
                    active={pick.always}
                    onPress={() =>
                      setPicked((m) => ({ ...m, [p.id]: { ...pick, always: !pick.always } }))
                    }
                  />
                  {p.category === 'Phones & electronics' && (
                    <Chip
                      title={pick.used ? 'Used' : 'New'}
                      active={pick.used}
                      onPress={() =>
                        setPicked((m) => ({ ...m, [p.id]: { ...pick, used: !pick.used } }))
                      }
                    />
                  )}
                </View>
              )}
            </View>
          );
        })
      )}
      {items && !items.length && <Text style={s.small}>Nothing found.</Text>}
      {adding ? (
        <View style={s.locationBox}>
          <Text style={s.bold}>Add a product to the catalogue</Text>
          <Field
            label="Product name"
            value={form.name}
            onChangeText={(v: string) => setForm({ ...form, name: v })}
            placeholder="e.g. Golden Penny Noodles 70g (carton of 40)"
          />
          <Field
            label="Brand (optional)"
            value={form.brand}
            onChangeText={(v: string) => setForm({ ...form, brand: v })}
          />
          <View style={s.chipWrap}>
            {['piece', 'pack', 'carton', 'bag', 'bottle', 'tin', 'kg', 'bunch', 'crate'].map(
              (u) => (
                <Chip
                  key={u}
                  title={u}
                  active={form.unit === u}
                  onPress={() => setForm({ ...form, unit: u })}
                />
              ),
            )}
          </View>
          <Button
            title="Add to catalogue"
            disabled={busy || form.name.trim().length < 3 || !category}
            onPress={() =>
              void run(async () => {
                const p = (await request('post', '/catalogue/products', {
                  body: { ...form, category },
                })) as any;
                setAdding(false);
                setForm({ name: '', brand: '', unit: 'piece' });
                await search();
                toggle({
                  ...p,
                  photo: null,
                  sellers: 0,
                  min_price_kobo: null,
                  max_price_kobo: null,
                  listed: false,
                });
              }, 'Added. Set your price below.')
            }
          />
          {!category && <Text style={s.fine}>Pick a category above first.</Text>}
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)}>
          <Text style={s.link}>Can’t find it? Add a product</Text>
        </Pressable>
      )}
      {!!noPrice.length && (
        <Text style={styles.missing}>
          Type a price for {noPrice.length} product{noPrice.length === 1 ? '' : 's'}:{' '}
          {noPrice
            .slice(0, 4)
            .map((c) => c.product.name)
            .join(', ')}
          {noPrice.length > 4 ? ` and ${noPrice.length - 4} more` : ''}.
        </Text>
      )}
      <Button
        title={
          chosen.length
            ? `Add ${chosen.length} product${chosen.length === 1 ? '' : 's'} to my shop`
            : 'Tick products to add'
        }
        disabled={busy || !ready}
        onPress={() =>
          void run(async () => {
            const r = (await request('post', '/sellers/me/listings/from-catalogue', {
              body: {
                items: chosen.map((c) => ({
                  product_id: c.product.id,
                  price_kobo: Math.round(Number(c.price) * 100),
                  stock_mode: c.always ? 'ALWAYS' : 'COUNTED',
                  stock: c.always ? undefined : 1,
                  condition: c.used ? 'USED' : 'NEW',
                })),
              },
            })) as any;
            setPicked({});
            await refresh();
            onDone();
            return r;
          }, 'Products added to your shop.')
        }
      />
      <Pressable onPress={onDone}>
        <Text style={s.link}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { fontSize: 13, color: '#b3261e', fontWeight: '600' },
  search: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 10,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  row: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e1efe7',
    gap: 8,
  },
  rowOn: { borderColor: '#1f754a', backgroundColor: '#f2fbf6' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { fontSize: 20, width: 24, color: '#1f754a' },
  photo: { width: 44, height: 44, borderRadius: 8 },
  noPhoto: { backgroundColor: '#eef6f1', alignItems: 'center', justifyContent: 'center' },
  pickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 34,
  },
  price: {
    width: 120,
    padding: 10,
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 8,
    backgroundColor: '#fff',
    fontSize: 15,
  },
});
