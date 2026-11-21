import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { Tab } from './AppContext';
import { useI18n } from './i18n';

const primary: Tab[] = ['Market', 'Categories', 'Bookings', 'Wallet'];
const extra: { tab: Exclude<Tab, 'Market' | 'Categories' | 'Bookings' | 'Wallet' | 'Cart'> }[] = [
  { tab: 'Planner' },
  { tab: 'Sell' },
  { tab: 'Riders' },
  { tab: 'Drive' },
  { tab: 'Inbox' },
  { tab: 'Account' },
];
const paths: Partial<Record<Tab, string>> = {
  Market: 'M3 11 12 3l9 8M5 9.5V20h5v-6h4v6h5V9.5',
  Categories: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  Planner: 'M5 4h14v17H5zM9 2v4m6-4v4M8.5 11l2 2 4-4M8.5 17h7',
  Cart: 'M3 4h2l2.4 11h10.2L20 8H6.2',
  Bookings: 'M6 4h12v17H6zM9 2v4m6-4v4M9 10h6m-6 4h6m-6 4h4',
  Wallet: 'M20 8V5H5a2 2 0 0 1 0-4h13M3 3v16a2 2 0 0 0 2 2h15V8H5M20 12h-6v5h6',
  Sell: 'M3 12 9 3h10l2 10-9 8zM15 7h.01',
  Riders: 'M4 20h16M6 16l4-11 4 7 5-3-5 10',
  Drive: 'M3 16h2m4 0h6m4 0h2M5 12l3-6h8l3 6M3 12h18v6H3zM8 6V4h8v2',
  Inbox: 'M4 4h16v13H9l-5 4zM8 8h8m-8 4h5',
  Account: 'M5 21v-3a7 7 0 0 1 14 0v3M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
};
function Icon({ name, active = false }: { name: Tab | 'More'; active?: boolean }) {
  const color = active ? '#26408f' : '#707689';
  return (
    <Svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      {name === 'More' ? (
        [5, 12, 19].map((x) => <Circle key={x} cx={x} cy={12} r={1.6} fill={color} stroke="none" />)
      ) : (
        <Path d={paths[name]} />
      )}
    </Svg>
  );
}

export default function BottomNavigation({
  tab,
  onNavigate,
  hidden = [],
  payments = false,
}: {
  tab: Tab;
  onNavigate: (tab: Tab) => void;
  /** Tabs whose feature is switched off in this deployment. */
  hidden?: Tab[];
  /** Wallet feature off: the Wallet tab holds payments, refunds and payouts instead. */
  payments?: boolean;
}) {
  const { t } = useI18n();
  const label = (name: Tab) =>
    name === 'Wallet' && payments ? t('tab.Payments') : t(`tab.${name}`);
  const [visible, setVisible] = useState(false),
    [reducedMotion, setReducedMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const closeButton = useRef<ComponentRef<typeof Pressable>>(null);
  const moreActive = !primary.includes(tab);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    const animation = reducedMotion
      ? Animated.timing(progress, {
          toValue: 1,
          duration: 0,
          useNativeDriver: Platform.OS !== 'web',
        })
      : Animated.spring(progress, {
          toValue: 1,
          damping: 23,
          stiffness: 240,
          mass: 0.8,
          useNativeDriver: Platform.OS !== 'web',
        });
    animation.start();
    return () => animation.stop();
  }, [visible, reducedMotion, progress]);
  const dismiss = useCallback(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: reducedMotion ? 0 : 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [progress, reducedMotion]);
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, dismiss]);
  return (
    <>
      <View style={styles.bar}>
        {primary.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityLabel={label(name)}
            accessibilityState={{ selected: tab === name }}
            onPress={() => onNavigate(name)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <View style={[styles.icon, tab === name && styles.selectedIcon]}>
              <Icon name={name} active={tab === name} />
            </View>
            <Text style={[styles.label, tab === name && styles.selectedLabel]}>{label(name)}</Text>
            {tab === name && <View style={styles.underline} />}
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tab.More')}
          accessibilityState={{ expanded: visible }}
          onPress={() => setVisible(true)}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
        >
          <View style={[styles.icon, (moreActive || visible) && styles.selectedIcon]}>
            <Icon name="More" active={moreActive || visible} />
          </View>
          <Text style={[styles.label, (moreActive || visible) && styles.selectedLabel]}>
            {t('tab.More')}
          </Text>
          {moreActive && <View style={styles.activeDot} />}
        </Pressable>
      </View>
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={dismiss}
        onShow={() => {
          if (Platform.OS === 'web') closeButton.current?.focus();
        }}
      >
        <View style={styles.modal}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.38] }) },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss more menu"
              onPress={dismiss}
              style={styles.backdrop}
            />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                opacity: progress,
                transform: [
                  {
                    translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [44, 0] }),
                  },
                ],
              },
            ]}
          >
            <SafeAreaView>
              <View style={styles.handle} />
              <View style={styles.heading}>
                <View style={styles.itemCopy}>
                  <Text accessibilityRole="header" style={styles.title}>
                    {t('nav.moreTitle')}
                  </Text>
                  <Text style={styles.subtitle}>{t('nav.moreSubtitle')}</Text>
                </View>
                <Pressable
                  ref={closeButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close more menu"
                  onPress={dismiss}
                  style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                >
                  <Text style={styles.closeText}>×</Text>
                </Pressable>
              </View>
            </SafeAreaView>
            <ScrollView contentContainerStyle={styles.items} keyboardShouldPersistTaps="handled">
              {extra
                .filter((item) => !hidden.includes(item.tab))
                .map((item) => (
                  <Pressable
                    key={item.tab}
                    accessibilityRole="button"
                    accessibilityState={{ selected: tab === item.tab }}
                    onPress={() => {
                      onNavigate(item.tab);
                      dismiss();
                    }}
                    style={({ pressed }) => [
                      styles.item,
                      tab === item.tab && styles.selectedItem,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.itemIcon}>
                      <Icon name={item.tab} active />
                    </View>
                    <View style={styles.itemCopy}>
                      <Text style={styles.itemTitle}>{t(`tab.${item.tab}`)}</Text>
                      <Text style={styles.itemDescription}>{t(`nav.${item.tab}`)}</Text>
                    </View>
                    <Text style={styles.chevron}>{tab === item.tab ? '✓' : '›'}</Text>
                  </Pressable>
                ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingBottom: 9,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#dde1ed',
    backgroundColor: '#fff',
  },
  tab: { flex: 1, alignItems: 'center', minHeight: 58, gap: 3, borderRadius: 14 },
  icon: { width: 52, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  selectedIcon: { backgroundColor: '#e6eaf6' },
  label: { fontSize: 11, color: '#697087', fontWeight: '500' },
  selectedLabel: { color: '#26408f', fontWeight: '700' },
  underline: {
    position: 'absolute',
    bottom: -9,
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#26408f',
  },
  activeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#26408f' },
  pressed: { opacity: 0.7 },
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: '#121f4a' },
  sheet: {
    backgroundColor: '#fbfbfe',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccd1e0',
    alignSelf: 'center',
    marginTop: 12,
  },
  heading: {
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 23, fontWeight: '700', color: '#1f2b4f' },
  subtitle: { fontSize: 12, color: '#69728b', marginTop: 5 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e6e9f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 28, color: '#414d71', lineHeight: 32 },
  items: { paddingHorizontal: 18, paddingBottom: 30, gap: 7 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 74,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedItem: { backgroundColor: '#e4e8f4', borderColor: '#ced4e8' },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#e4e8f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCopy: { flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '600', color: '#222e53' },
  itemDescription: { fontSize: 12, lineHeight: 17, color: '#69728b', marginTop: 4 },
  chevron: { fontSize: 24, color: '#576691', width: 22, textAlign: 'center' },
});
