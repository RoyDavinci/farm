import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from './AppContext';
import { request } from './request';

const FOOD = ['Vegetables', 'Fruit', 'Grains', 'Tubers', 'Livestock', 'Food & groceries'];
export const isFood = (category?: string | null) => !!category && FOOD.includes(category);

const issues = [
  ['MISSING', 'Allergen info is missing'],
  ['INCORRECT', 'Allergen info is wrong'],
  ['REACTION', 'Someone had a reaction'],
  ['OTHER', 'Something else'],
] as const;
const allergens = [
  ['peanut', 'Groundnuts'],
  ['tree_nut', 'Tree nuts'],
  ['milk', 'Milk'],
  ['egg', 'Eggs'],
  ['fish', 'Fish'],
  ['shellfish', 'Shellfish'],
  ['soy', 'Soy'],
  ['wheat', 'Wheat / gluten'],
  ['sesame', 'Sesame'],
] as const;

/**
 * "Report allergen information" link that opens a short form. Reports go to Ahia staff, who check
 * them with the seller; they are not medical advice.
 */
export default function AllergenReport({
  listingId,
  recipe,
}: {
  listingId?: string;
  recipe?: string;
}) {
  const { run, busy } = useApp();
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState<(typeof issues)[number][0]>('MISSING');
  const [chosen, setChosen] = useState<string[]>([]);
  const [details, setDetails] = useState('');
  if (!open)
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text style={styles.link}>Report allergen information</Text>
      </Pressable>
    );
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Report allergen information</Text>
      <View style={styles.chips}>
        {issues.map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: issue === key }}
            onPress={() => setIssue(key)}
            style={[styles.chip, issue === key && styles.on]}
          >
            <Text style={[styles.chipText, issue === key && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {issue === 'REACTION' && (
        <Text style={styles.urgent}>
          If someone is unwell now, get medical help first. We will review this report urgently.
        </Text>
      )}
      <Text style={styles.label}>Which allergens? (optional)</Text>
      <View style={styles.chips}>
        {allergens.map(([key, label]) => {
          const on = chosen.includes(key);
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setChosen(on ? chosen.filter((x) => x !== key) : [...chosen, key])}
              style={[styles.chip, on && styles.on]}
            >
              <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        value={details}
        onChangeText={setDetails}
        multiline
        placeholder="What did you notice? For example: the label lists groundnut oil but the listing doesn't."
        placeholderTextColor="#8a91a6"
        accessibilityLabel="Report details"
      />
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || details.trim().length < 10}
          onPress={() =>
            void run(async () => {
              await request('post', '/planner/allergen-reports', {
                body: {
                  ...(listingId ? { listing_id: listingId } : {}),
                  ...(recipe ? { recipe } : {}),
                  issue,
                  allergens: chosen,
                  details: details.trim(),
                },
              });
              setOpen(false);
              setDetails('');
              setChosen([]);
            }, 'Thank you. Our team will check this with the seller.')
          }
          style={[styles.send, (busy || details.trim().length < 10) && { opacity: 0.5 }]}
        >
          <Text style={styles.sendText}>Send report</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { fontSize: 12, fontWeight: '700', color: '#a33e32', paddingVertical: 4 },
  box: {
    backgroundColor: '#fff7f4',
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#f3d6cc',
  },
  title: { fontSize: 14, fontWeight: '800', color: '#18213a' },
  label: { fontSize: 12, fontWeight: '700', color: '#3d4563' },
  urgent: { fontSize: 12, fontWeight: '700', color: '#a33e32', lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2c8be',
  },
  on: { backgroundColor: '#a33e32', borderColor: '#a33e32' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#6b3a2c' },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#e2c8be',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#fff',
    fontSize: 14,
    color: '#18213a',
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 10 },
  send: {
    backgroundColor: '#a33e32',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  sendText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cancel: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { color: '#6b7390', fontWeight: '700', fontSize: 13 },
});
