import { useApp } from './AppContext';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
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
  unit: 'piece',
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
  const { settings } = useApp();
  const update = (i: number, patch: Partial<VariantDraft>) =>
    onChange(value.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  return (
    <View style={{ gap: 16 }}>
      {value.length > 1 && (
        <Text style={s.small}>
          Each option has its own stock. The first active option is the one buyers see first.
        </Text>
      )}
      {value.map((v, i) => (
        <View style={s.card} key={v.id || i}>
          <View style={s.row}>
            <Text style={s.bold}>Option {i + 1}</Text>
            <Text style={s.small}>Active</Text>
            <Switch value={v.active} onValueChange={(active) => update(i, { active })} />
          </View>
          <Text style={s.label}>Option name</Text>
          <TextInput
            style={[s.input, { marginTop: -6 }]}
            accessibilityLabel={`Option ${i + 1} name`}
            value={v.name}
            onChangeText={(name) => update(i, { name })}
            placeholder="e.g. Small basket / 50kg bag"
          />
          <Text style={s.label}>Sold per</Text>
          <View style={[s.wrap, { marginTop: -6 }]}>
            {(settings?.catalog?.units || ['piece', 'kg', 'pack', 'pair', 'set', 'box']).map(
              (unit) => (
                <Pressable key={unit} onPress={() => update(i, { unit })}>
                  <Text style={[s.chip, v.unit === unit && s.active]}>{unit}</Text>
                </Pressable>
              ),
            )}
          </View>
          <View style={s.cells}>
            <View style={s.cell}>
              <Text style={s.label}>Price per {v.unit} (₦) *</Text>
              <TextInput
                style={s.input}
                accessibilityLabel={`Option ${i + 1} price`}
                value={v.price}
                onChangeText={(price) => update(i, { price })}
                placeholder="e.g. 2500"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={s.cell}>
              <Text style={s.label}>In stock *</Text>
              <TextInput
                style={s.input}
                accessibilityLabel={`Option ${i + 1} stock`}
                value={v.stock}
                onChangeText={(stock) => update(i, { stock })}
                placeholder="e.g. 20"
                keyboardType="number-pad"
              />
            </View>
            <View style={s.cell}>
              <Text style={s.label}>Min. order</Text>
              <TextInput
                style={s.input}
                accessibilityLabel={`Option ${i + 1} minimum`}
                value={v.minimum}
                onChangeText={(minimum) => update(i, { minimum })}
                placeholder="1"
                keyboardType="number-pad"
              />
            </View>
          </View>
          <View style={s.divider} />
          <View style={{ gap: 2 }}>
            <Text style={s.bold}>Wholesale prices (optional)</Text>
            <Text style={s.small}>Cheaper price when someone buys a lot.</Text>
          </View>
          {v.tiers.map((t, n) => (
            <View key={n} style={s.row}>
              <TextInput
                style={[s.input, s.grow]}
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
                style={[s.input, s.grow]}
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
          <Text style={s.link}>+ Add another size or option</Text>
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '600', color: '#3d6b54' },
  cells: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // minWidth 0 lets the three boxes share a phone-width row instead of overflowing.
  cell: { flexGrow: 1, flexBasis: 90, minWidth: 0, gap: 6 },
  grow: { flex: 1, minWidth: 0 },
  divider: { height: 1, backgroundColor: '#e3f1ea' },
  small: { fontSize: 10, lineHeight: 18, color: '#73ad90' },
  bold: { fontSize: 12, color: '#307452', fontWeight: '600' },
  card: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#d3ebdf',
    borderRadius: 10,
    gap: 16,
    backgroundColor: '#fbfefc',
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  input: {
    padding: 11,
    borderWidth: 1,
    borderColor: '#cfeadc',
    borderRadius: 7,
    fontSize: 12,
    color: '#226945',
    backgroundColor: '#f5fdf9',
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 15,
    color: '#4e8d6d',
    backgroundColor: '#ebf7f1',
    fontSize: 11,
  },
  active: { color: '#fff', backgroundColor: '#246746' },
  link: { fontSize: 11, color: '#30845a', paddingVertical: 6 },
});
