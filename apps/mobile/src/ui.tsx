import { statusLabel } from '@zuru/shared';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
export const categories = ['All', 'Vegetables', 'Fruit', 'Grains', 'Tubers', 'Livestock', 'Other'];
export const produceIcon = (category: string) =>
  ({
    Vegetables: '🥬',
    Fruit: '🍌',
    Grains: '🌽',
    Tubers: '🥔',
    Livestock: '🥚',
    'Phones & electronics': '📱',
    'Fashion & accessories': '👕',
    'Home & kitchen': '🏠',
    Furniture: '🪑',
    'Beauty & personal care': '🧴',
    'Books & stationery': '📚',
    Other: '📦',
  })[category] || '📦';
export function Field({ label, ...props }: any) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }]}
        placeholderTextColor="#a1a697"
        {...props}
      />
    </View>
  );
}
export function Button({
  title,
  onPress,
  disabled,
  secondary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>
    </Pressable>
  );
}
export function Chip({
  title,
  active,
  onPress,
}: {
  title: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && { color: '#fff' }]}>{title}</Text>
    </Pressable>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <View
      style={[
        s.badge,
        ['APPROVED', 'ACTIVE', 'COMPLETED', 'PAID'].includes(status) && {
          backgroundColor: '#edf4e5',
        },
      ]}
    >
      <Text style={s.badgeText}>• {statusLabel(status)}</Text>
    </View>
  );
}
export function Alert({ text, error }: { text: string; error?: boolean }) {
  return (
    <View accessibilityRole="alert" style={[s.alert, error && { backgroundColor: '#f9eade' }]}>
      <Text style={[s.alertText, error && { color: '#9b553c' }]}>{text}</Text>
    </View>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyIcon}>♧</Text>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={[s.body, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}
export function Back({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 6 }}>
      <Text style={s.link}>← Back</Text>
    </Pressable>
  );
}
export const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#fafbf6' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 15,
    backgroundColor: '#fafbf6',
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 23,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#edf0e6',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logo: { fontSize: 30, color: '#375d36' },
  brand: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.7,
    color: '#264a30',
  },
  avatar: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: '#eae7d5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 22,
    gap: 17,
    width: '100%',
    maxWidth: 780,
    alignSelf: 'center',
    paddingBottom: 25,
  },
  auth: {
    padding: 28,
    paddingTop: 38,
    gap: 19,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  authHero: { marginTop: 28, paddingBottom: 5 },
  authTitle: {
    fontSize: 38,
    fontWeight: '700',
    lineHeight: 45,
    color: '#294c31',
    letterSpacing: -1.2,
    marginVertical: 15,
  },
  harvest: {
    fontSize: 48,
    marginTop: 24,
    marginBottom: 6,
    textAlign: 'center',
  },
  authTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#e0e5d5',
    marginBottom: 5,
  },
  authTab: { flex: 1, padding: 13, alignItems: 'center' },
  authTabActive: { borderBottomWidth: 2, borderColor: '#365b37' },
  greeting: { gap: 9 },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: '#7e8d66',
    fontWeight: '600',
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: '#294b31',
    letterSpacing: -1,
    lineHeight: 39,
  },
  subtitle: { fontSize: 12, lineHeight: 20, color: '#88917d', marginBottom: 3 },
  body: { fontSize: 13, lineHeight: 22, color: '#77836d' },
  bold: { fontSize: 13, fontWeight: '600', color: '#3f5337' },
  muted: { fontSize: 12, color: '#87917e', lineHeight: 20 },
  small: { fontSize: 10, color: '#8a947e', lineHeight: 17 },
  fine: { fontSize: 10, color: '#8c957f', lineHeight: 18 },
  hero: {
    backgroundColor: '#2d5538',
    padding: 23,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 5,
    overflow: 'hidden',
    minHeight: 174,
  },
  heroEyebrow: { color: '#bed09e', fontSize: 8, letterSpacing: 1.3 },
  heroTitle: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '600',
    color: '#edf3da',
    marginVertical: 12,
    letterSpacing: -0.6,
  },
  heroText: { fontSize: 11, lineHeight: 18, color: '#aabc98', maxWidth: 240 },
  heroEmoji: {
    fontSize: 76,
    marginLeft: 10,
    transform: [{ rotate: '-12deg' }],
  },
  search: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e8d9',
    borderRadius: 9,
    padding: 14,
    fontSize: 12,
    color: '#3f5337',
  },
  cityInput: {
    fontSize: 11,
    color: '#6e805e',
    paddingHorizontal: 5,
    paddingBottom: 2,
  },
  chipRow: { gap: 8, paddingVertical: 3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#f0f2e8',
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e8ecdf',
  },
  chipActive: { backgroundColor: '#3b5f3a', borderColor: '#3b5f3a' },
  chipText: { fontSize: 10, color: '#7f8a72' },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#3b5134',
    marginTop: 10,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 13 },
  product: {
    width: '47.8%',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e8eddf',
  },
  productPicture: {
    height: 143,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  productEmoji: { fontSize: 68 },
  freshTag: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: '#ffffffc9',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 6,
    letterSpacing: 0.8,
    color: '#6e8058',
    fontWeight: '700',
  },
  productBody: { padding: 13, gap: 7 },
  productName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#405438',
    lineHeight: 18,
  },
  productPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#47613a',
    marginTop: 4,
  },
  price: {
    fontSize: 22,
    fontWeight: '600',
    color: '#47613a',
    letterSpacing: -0.5,
  },
  detailHero: {
    padding: 30,
    backgroundColor: '#edf1df',
    borderRadius: 15,
    alignItems: 'center',
    gap: 20,
  },
  detailEmoji: { fontSize: 110 },
  field: { gap: 8 },
  label: { fontSize: 11, fontWeight: '600', color: '#657756' },
  input: {
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dfe6d4',
    borderRadius: 8,
    fontSize: 13,
    color: '#344b2e',
  },
  button: {
    backgroundColor: '#365b38',
    borderRadius: 8,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#f2f6e8', fontSize: 12, fontWeight: '600' },
  secondary: {
    backgroundColor: '#f3f5ec',
    borderWidth: 1,
    borderColor: '#e2e8d7',
  },
  secondaryText: { color: '#758565' },
  sellerInfo: {
    gap: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e3e9d8',
    paddingVertical: 20,
    marginVertical: 5,
  },
  sellerStrip: { gap: 12 },
  orderCard: {
    padding: 19,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4e9db',
    borderRadius: 12,
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#405438',
    flexShrink: 1,
  },
  orderSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f0f3e9',
  },
  badge: {
    backgroundColor: '#f5f1df',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  badgeText: { color: '#7e885f', fontSize: 9, textTransform: 'capitalize' },
  actions: { gap: 12, marginTop: 8 },
  inlineActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  locationBox: {
    padding: 13,
    backgroundColor: '#f7f8f0',
    borderRadius: 7,
    gap: 7,
  },
  codeBox: {
    alignItems: 'center',
    padding: 18,
    borderWidth: 1,
    borderColor: '#dce7c9',
    backgroundColor: '#f6f9ee',
    borderRadius: 8,
    gap: 10,
  },
  pickupCode: {
    fontSize: 34,
    letterSpacing: 7,
    color: '#49663c',
    fontWeight: '700',
  },
  link: {
    fontSize: 11,
    fontWeight: '600',
    color: '#66834e',
    paddingVertical: 4,
  },
  alert: { backgroundColor: '#edf3e3', padding: 14, borderRadius: 8 },
  alertText: { fontSize: 12, lineHeight: 19, color: '#5c7d46' },
  demo: { backgroundColor: '#f3efdf', padding: 9, borderRadius: 5 },
  demoText: {
    color: '#978456',
    fontSize: 8,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  balanceCard: {
    padding: 26,
    backgroundColor: '#2f5538',
    borderRadius: 13,
    gap: 15,
    marginVertical: 5,
  },
  balance: {
    fontSize: 39,
    color: '#edf4df',
    fontWeight: '600',
    letterSpacing: -1,
  },
  walletEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: '#e6ebdd',
    gap: 12,
  },
  timeline: { borderLeftWidth: 2, borderColor: '#b4c69a', padding: 15, gap: 8 },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 10,
  },
  emptyIcon: { fontSize: 35, color: '#9aab83' },
  bottomNote: {
    fontSize: 9,
    color: '#a3ad95',
    textAlign: 'center',
    paddingVertical: 18,
  },
});
