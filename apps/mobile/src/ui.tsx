import { statusLabel } from '@ahia/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const nativeDriver = Platform.OS !== 'web';

/** True when the phone asks for reduced motion; animations are skipped then. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** Fades and lifts its content into place (screens, cards). */
export function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: any;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return v.setValue(1);
    Animated.timing(v, {
      toValue: 1,
      duration: 320,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
  }, [reduced, delay, v]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** The Ahia mark and wordmark used in the app header and sign-in screen. */
export function Brand({ size = 30, tagline }: { size?: number; tagline?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <Image
        source={require('../assets/icon.png')}
        style={{ width: size, height: size, borderRadius: size * 0.28 }}
        accessibilityIgnoresInvertColors
      />
      <View>
        <Text style={[s.brand, { fontSize: size * 0.72, lineHeight: size * 0.8 }]}>ahia</Text>
        {tagline && <Text style={s.tagline}>{tagline}</Text>}
      </View>
    </View>
  );
}

/** Gently grows and shrinks its content forever (play buttons, live dots). */
export function Pulse({ children, style }: { children: ReactNode; style?: any }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: nativeDriver,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: nativeDriver,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return (
    <Animated.View
      style={[
        style,
        { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A Pressable that sinks slightly while pressed (cards, tiles). */
export function PressScale({ children, style, wrapStyle, onPress, ...props }: any) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  const to = (toValue: number) =>
    reduced ||
    Animated.spring(v, {
      toValue,
      speed: 40,
      bounciness: 6,
      useNativeDriver: nativeDriver,
    }).start();
  return (
    <Pressable
      {...props}
      style={wrapStyle}
      onPress={onPress}
      onPressIn={() => to(0.96)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
export const categories = ['All', 'Vegetables', 'Fruit', 'Grains', 'Tubers', 'Livestock', 'Other'];
export const produceIcon = (category: string) =>
  ({
    Vegetables: '🥬',
    Fruit: '🍌',
    Grains: '🌽',
    Tubers: '🥔',
    Livestock: '🥚',
    'Phones & electronics': '📱',
    'Auto & spare parts': '🚗',
    'Baby & kids': '🧸',
    'Food & groceries': '🛒',
    'Sports & hobbies': '⚽',
    'Tools & building materials': '🔨',
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
        placeholderTextColor="#92ab9e"
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
  // A gentle spring: the button sinks slightly while pressed and settles back.
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      speed: 40,
      bounciness: to === 1 ? 6 : 0,
      useNativeDriver: nativeDriver,
    }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => !disabled && spring(0.97)}
        onPressOut={() => spring(1)}
        disabled={disabled}
        style={({ pressed }) => [
          s.button,
          secondary && s.secondary,
          disabled && { opacity: 0.45 },
          pressed && { opacity: 0.9 },
        ]}
      >
        <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>
      </Pressable>
    </Animated.View>
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
          backgroundColor: '#e3f6ec',
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
  safe: { flex: 1, backgroundColor: '#f5fcf9' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 15,
    backgroundColor: '#f5fcf9',
  },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5f2ec',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logo: { fontSize: 30, color: '#1f754a' },
  brand: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.7,
    color: '#14472e',
  },
  countBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#f5a524',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  countText: { fontSize: 10, fontWeight: '900', color: '#1b1503' },
  tagline: { fontSize: 10, color: '#587667', fontWeight: '600', marginTop: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f9f5',
  },
  avatar: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: '#1f754a',
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
    color: '#184830',
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
    borderColor: '#d3e7dd',
    marginBottom: 5,
  },
  authTab: { flex: 1, padding: 13, alignItems: 'center' },
  authTabActive: { borderBottomWidth: 2, borderColor: '#1f754a' },
  greeting: { gap: 9 },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: '#487f64',
    fontWeight: '600',
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: '#184730',
    letterSpacing: -1,
    lineHeight: 39,
  },
  subtitle: { fontSize: 12, lineHeight: 20, color: '#5f7e6f', marginBottom: 3 },
  body: { fontSize: 13, lineHeight: 22, color: '#537262' },
  bold: { fontSize: 13, fontWeight: '600', color: '#254c39' },
  muted: { fontSize: 12, color: '#607e6f', lineHeight: 20 },
  small: { fontSize: 10, color: '#5e8270', lineHeight: 17 },
  fine: { fontSize: 10, color: '#5f8471', lineHeight: 18 },
  hero: {
    backgroundColor: '#195135',
    padding: 23,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 5,
    overflow: 'hidden',
    minHeight: 174,
  },
  heroEyebrow: { color: '#8ce2b7', fontSize: 8, letterSpacing: 1.3 },
  heroTitle: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '600',
    color: '#d6f7e6',
    marginVertical: 12,
    letterSpacing: -0.6,
  },
  heroText: { fontSize: 11, lineHeight: 18, color: '#8bc9aa', maxWidth: 240 },
  heroEmoji: {
    fontSize: 76,
    marginLeft: 10,
    transform: [{ rotate: '-12deg' }],
  },
  search: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d7eae0',
    borderRadius: 9,
    padding: 14,
    fontSize: 12,
    color: '#254c39',
  },
  cityInput: {
    fontSize: 11,
    color: '#43735b',
    paddingHorizontal: 5,
    paddingBottom: 2,
  },
  chipRow: { gap: 8, paddingVertical: 3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#e7f3ed',
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#ddeee6',
  },
  chipActive: { backgroundColor: '#237d50', borderColor: '#237d50' },
  chipText: { fontSize: 10, color: '#577867' },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#224b37',
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
    borderColor: '#ddefe6',
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
    color: '#3d7459',
    fontWeight: '700',
  },
  productBody: { padding: 13, gap: 7 },
  productName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#264d39',
    lineHeight: 18,
  },
  productPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#245b40',
    marginTop: 4,
  },
  price: {
    fontSize: 22,
    fontWeight: '600',
    color: '#245b40',
    letterSpacing: -0.5,
  },
  detailHero: {
    padding: 30,
    backgroundColor: '#dcf4e8',
    borderRadius: 15,
    alignItems: 'center',
    gap: 20,
  },
  detailEmoji: { fontSize: 110 },
  field: { gap: 8 },
  label: { fontSize: 11, fontWeight: '600', color: '#3d6b54' },
  input: {
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1e9dd',
    borderRadius: 8,
    fontSize: 13,
    color: '#1e4632',
  },
  button: {
    backgroundColor: '#1f754a',
    borderRadius: 8,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#e6f8ef', fontSize: 12, fontWeight: '600' },
  secondary: {
    backgroundColor: '#ebf6f0',
    borderWidth: 1,
    borderColor: '#d4ebe0',
  },
  secondaryText: { color: '#4a7660' },
  sellerInfo: {
    gap: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#d5ece0',
    paddingVertical: 20,
    marginVertical: 5,
  },
  sellerStrip: { gap: 12 },
  orderCard: {
    padding: 19,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d9ebe2',
    borderRadius: 12,
    gap: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#264d39',
    flexShrink: 1,
  },
  orderSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e8f4ee',
  },
  badge: {
    backgroundColor: '#e0f4ea',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  badgeText: { color: '#427b5f', fontSize: 9, textTransform: 'capitalize' },
  actions: { gap: 12, marginTop: 8 },
  inlineActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  locationBox: {
    padding: 13,
    backgroundColor: '#eff9f4',
    borderRadius: 7,
    gap: 7,
  },
  codeBox: {
    alignItems: 'center',
    padding: 18,
    borderWidth: 1,
    borderColor: '#c4ecd8',
    backgroundColor: '#ecfbf3',
    borderRadius: 8,
    gap: 10,
  },
  pickupCode: {
    fontSize: 34,
    letterSpacing: 7,
    color: '#256042',
    fontWeight: '700',
  },
  link: {
    fontSize: 11,
    fontWeight: '600',
    color: '#307b56',
    paddingVertical: 4,
  },
  alert: { backgroundColor: '#e1f5eb', padding: 14, borderRadius: 8 },
  alertText: { fontSize: 12, lineHeight: 19, color: '#2a7650' },
  demo: { backgroundColor: '#e0f2e9', padding: 9, borderRadius: 5 },
  acting: {
    backgroundColor: '#fff4d6',
    borderColor: '#e9c46a',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actingText: { flex: 1, color: '#5a4200', fontSize: 13, fontWeight: '600' },
  actingSwitch: { color: '#1f754a', fontWeight: '800', fontSize: 13 },
  demoText: {
    color: '#978456',
    fontSize: 8,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  balanceCard: {
    padding: 26,
    backgroundColor: '#1c5036',
    borderRadius: 13,
    gap: 15,
    marginVertical: 5,
  },
  balance: {
    fontSize: 39,
    color: '#dcf7ea',
    fontWeight: '600',
    letterSpacing: -1,
  },
  walletEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: '#dbede4',
    gap: 12,
  },
  timeline: { borderLeftWidth: 2, borderColor: '#8bd5b0', padding: 15, gap: 8 },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 10,
  },
  emptyIcon: { fontSize: 35, color: '#75b997' },
  bottomNote: {
    fontSize: 9,
    color: '#8db5a1',
    textAlign: 'center',
    paddingVertical: 18,
  },
});
