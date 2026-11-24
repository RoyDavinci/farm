import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Show or hide the wallet balance (for using the app where others can see the screen).
 * Shared by the top wallet pill and the Wallet screen, and remembered on this device.
 */
const KEY = 'ahia-hide-balance';
let hidden = false;
const listeners = new Set<(v: boolean) => void>();
void (async () => {
  try {
    const v =
      Platform.OS === 'web' ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    hidden = v === '1';
    listeners.forEach((l) => l(hidden));
  } catch {
    // No storage: the balance shows.
  }
})();

function setHidden(v: boolean) {
  hidden = v;
  listeners.forEach((l) => l(v));
  try {
    if (Platform.OS === 'web') localStorage.setItem(KEY, v ? '1' : '0');
    else void SecureStore.setItemAsync(KEY, v ? '1' : '0');
  } catch {
    // Not remembered; it still applies until the app closes.
  }
}

export function useBalanceHidden() {
  const [value, setValue] = useState(hidden);
  useEffect(() => {
    listeners.add(setValue);
    setValue(hidden);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return [value, () => setHidden(!value)] as const;
}

/** The amount, or dots when the balance is hidden. */
export const masked = (text: string, isHidden: boolean) => (isHidden ? '₦ ••••••' : text);

/** An eye button: open eye = shown, crossed eye = hidden. */
export function BalanceEye({ color = '#dcf7ea', size = 22 }: { color?: string; size?: number }) {
  const [isHidden, toggle] = useBalanceHidden();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isHidden ? 'Show balance' : 'Hide balance'}
      hitSlop={10}
      onPress={toggle}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <Circle cx={12} cy={12} r={3} />
        {isHidden && <Path d="M3 3l18 18" />}
      </Svg>
    </Pressable>
  );
}
