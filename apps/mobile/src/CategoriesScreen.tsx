import { StyleSheet, Text, View } from 'react-native';
import { useApp } from './AppContext';
import { FadeIn, PressScale, produceIcon } from './ui';

// Soft tile colours, repeated in order; the brand blue and market orange stay for actions.
const tints = ['#e8faf1', '#fdf1dc', '#e6f4ee', '#f6e8ef', '#ebfaf2', '#e5f7ee'];

/** Every category as a tile; tapping one opens Home filtered to it. */
export default function CategoriesScreen({
  current,
  onPick,
}: {
  current: string;
  onPick: (category: string) => void;
}) {
  const { settings } = useApp();
  const list = ['', ...(settings?.catalog?.categories || ['Other'])];
  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>
        Categories
      </Text>
      <Text style={styles.subtitle}>Browse everything sold near you.</Text>
      <View style={styles.grid}>
        {list.map((c, i) => (
          <FadeIn key={c || 'all'} delay={Math.min(i, 10) * 40} style={styles.cell}>
            <PressScale
              accessibilityRole="button"
              accessibilityState={{ selected: current === c }}
              accessibilityLabel={c || 'All categories'}
              onPress={() => onPick(c)}
              style={[
                styles.tile,
                { backgroundColor: tints[i % tints.length] },
                current === c && styles.selected,
              ]}
            >
              <Text style={styles.icon}>{c ? produceIcon(c) : '🛍️'}</Text>
              <Text numberOfLines={2} style={styles.name}>
                {c || 'Everything'}
              </Text>
            </PressScale>
          </FadeIn>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 6 },
  title: { fontSize: 26, fontWeight: '800', color: '#143022', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: '#587667', marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '30.8%' },
  tile: {
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
    minHeight: 112,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selected: { borderColor: '#1f754a' },
  icon: { fontSize: 34 },
  name: { fontSize: 12, fontWeight: '700', color: '#1c4a33', textAlign: 'center' },
});
