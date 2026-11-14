import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch } from 'react-native';
export interface VariantDraft {
  id?: string;
  name: string;
  unit: string;
  price: string;
  stock: string;
  minimum: string;
  active: boolean;
  tiers: { minimum: string; price: string }[];
}
export const newVariant = (): VariantDraft => ({
  name: 'Standard',
  unit: 'kg',
  price: '',
  stock: '',
  minimum: '1',
  active: true,
  tiers: [],
});
export function variantDraft(v: any): VariantDraft {
  return {
    id: v.id,
    name: v.name,
    unit: v.unit,
    price: String(v.price_kobo / 100),
    stock: String(v.stock),
    minimum: String(v.min_quantity),
    active: v.active,
    tiers: (v.wholesale_tiers || []).map((t: any) => ({
      minimum: String(t.min_quantity),
      price: String(t.price_kobo / 100),
    })),
  };
}
export function serializeVariants(variants: VariantDraft[]) {
  return variants.map((v) => ({
    id: v.id,
    name: v.name,
    unit: v.unit,
    price_kobo: Math.round(Number(v.price) * 100),
    stock: Number(v.stock),
    min_quantity: Number(v.minimum),
    active: v.active,
    wholesale_tiers: v.tiers.map((t) => ({
      min_quantity: Number(t.minimum),
      price_kobo: Math.round(Number(t.price) * 100),
    })),
  }));
}
export default function VariantEditor({
  value,
  onChange,
}: {
  value: VariantDraft[];
  onChange: (v: VariantDraft[]) => void;
}) {
  const update = (i: number, patch: Partial<VariantDraft>) =>
    onChange(value.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  return (
    <View style={{ gap: 15 }}>
      <Text style={s.heading}>Product options & wholesale</Text>
      <Text style={s.small}>
        Each option has separate available stock. Reservations are deducted from the exact option a
        buyer chooses. The first active option is the default.
      </Text>
      {value.map((v, i) => (
        <View style={s.card} key={v.id || i}>
          <View style={s.row}>
            <Text style={s.bold}>Option {i + 1}</Text>
            <Text style={s.small}>Active</Text>
            <Switch value={v.active} onValueChange={(active) => update(i, { active })} />
          </View>
          <TextInput
            style={s.input}
            accessibilityLabel={`Option ${i + 1} name`}
            value={v.name}
            onChangeText={(name) => update(i, { name })}
            placeholder="e.g. Small basket / 50kg bag"
          />
          <View style={s.wrap}>
            {['kg', 'crate', 'bag', 'basket', 'piece', 'carton'].map((unit) => (
              <Pressable key={unit} onPress={() => update(i, { unit })}>
                <Text style={[s.chip, v.unit === unit && s.active]}>{unit}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.small}>Price per unit (₦) / available stock / minimum quantity</Text>
          <View style={s.row}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel={`Option ${i + 1} price`}
              value={v.price}
              onChangeText={(price) => update(i, { price })}
              placeholder="Price ₦"
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel={`Option ${i + 1} stock`}
              value={v.stock}
              onChangeText={(stock) => update(i, { stock })}
              placeholder="Stock"
              keyboardType="number-pad"
            />
            <TextInput
              style={[s.input, { flex: 1 }]}
              accessibilityLabel={`Option ${i + 1} minimum`}
              value={v.minimum}
              onChangeText={(minimum) => update(i, { minimum })}
              placeholder="Minimum"
              keyboardType="number-pad"
            />
          </View>
          <Text style={s.bold}>Wholesale tiers</Text>
          {v.tiers.map((t, n) => (
            <View key={n} style={s.row}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                accessibilityLabel="Wholesale minimum quantity"
                value={t.minimum}
                onChangeText={(minimum) =>
                  update(i, {
                    tiers: v.tiers.map((tier, j) => (j === n ? { ...tier, minimum } : tier)),
                  })
                }
                placeholder="Buy at least"
                keyboardType="number-pad"
              />
              <TextInput
                style={[s.input, { flex: 1 }]}
                accessibilityLabel="Wholesale unit price"
                value={t.price}
                onChangeText={(price) =>
                  update(i, {
                    tiers: v.tiers.map((tier, j) => (j === n ? { ...tier, price } : tier)),
                  })
                }
                placeholder="Unit price ₦"
                keyboardType="decimal-pad"
              />
              <Pressable onPress={() => update(i, { tiers: v.tiers.filter((_, j) => j !== n) })}>
                <Text style={s.link}>Remove</Text>
              </Pressable>
            </View>
          ))}
          {v.tiers.length < 10 && (
            <Pressable
              onPress={() => update(i, { tiers: [...v.tiers, { minimum: '', price: '' }] })}
            >
              <Text style={s.link}>+ Add wholesale tier</Text>
            </Pressable>
          )}
          {value.length > 1 && (
            <Pressable onPress={() => onChange(value.filter((_, j) => j !== i))}>
              <Text style={s.link}>Remove option from listing</Text>
            </Pressable>
          )}
        </View>
      ))}
      {value.length < 20 && (
        <Pressable
          onPress={() =>
            onChange([...value, { ...newVariant(), name: `Option ${value.length + 1}` }])
          }
        >
          <Text style={s.link}>+ Add another product option</Text>
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  heading: { fontSize: 16, color: '#4c6b3a', fontWeight: '600' },
  small: { fontSize: 10, lineHeight: 18, color: '#91a17f' },
  bold: { fontSize: 12, color: '#607d4b', fontWeight: '600' },
  card: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#e1e8d6',
    borderRadius: 10,
    gap: 13,
    backgroundColor: '#fff',
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  input: {
    padding: 11,
    borderWidth: 1,
    borderColor: '#dfe7d2',
    borderRadius: 7,
    fontSize: 12,
    color: '#4e6e3b',
    backgroundColor: '#fafcf6',
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 15,
    color: '#879a71',
    backgroundColor: '#f3f6ec',
    fontSize: 11,
  },
  active: { color: '#fff', backgroundColor: '#496d3d' },
  link: { fontSize: 11, color: '#6a8c4f', paddingVertical: 6 },
});
