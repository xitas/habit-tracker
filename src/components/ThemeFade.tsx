import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '@/lib/theme';

const DURATION = 250;

/**
 * Softens theme switches: when the background token changes, a layer in the
 * previous background color covers the screen and fades out over the new theme.
 * The layer is rendered in the same commit as the new colors, so the new theme
 * never shows unfaded for a frame.
 */
export function ThemeFade() {
  const { c } = useTheme();
  const [seenBg, setSeenBg] = useState(c.bg);
  const [fade, setFade] = useState<{ id: number; from: string } | null>(null);
  const clear = useCallback(() => setFade(null), []);

  // Adjusting state during render when an input changes (React's documented pattern).
  if (seenBg !== c.bg) {
    setSeenBg(c.bg);
    setFade({ id: (fade?.id ?? 0) + 1, from: seenBg });
  }

  if (!fade) return null;
  return <FadeLayer key={fade.id} color={fade.from} onDone={clear} />;
}

function FadeLayer({ color, onDone }: { color: string; onDone: () => void }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withTiming(0, { duration: DURATION, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) scheduleOnRN(onDone);
    });
  }, [opacity, onDone]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }, style]} />;
}
