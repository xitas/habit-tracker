import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { useMotion } from '@/lib/motion';
import { HABIT_COLORS, radius, shadow, useTheme } from '@/lib/theme';

const PIECES = 48;

/** Deterministic 0..1 noise from integer seeds, so rendering stays pure. */
function noise(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
const DURATION = 2200;

function Piece({ x, delay, color, drift, spin, size, height }: {
  x: number; delay: number; color: string; drift: number; spin: number; size: number; height: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: DURATION, easing: Easing.out(Easing.quad) }));
  }, [t, delay]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.85 ? 1 : (1 - t.value) / 0.15,
    transform: [
      { translateX: x + drift * t.value },
      { translateY: -40 + (height + 80) * t.value },
      { rotate: `${spin * t.value}deg` },
    ],
  }));

  return <Animated.View style={[styles.piece, { width: size, height: size * 0.45, backgroundColor: color }, style]} />;
}

/** How long the reduced-motion "All done" confirmation stays. */
const STATIC_MS = 3000;

/**
 * One-shot celebration when the day is complete. Change `burstKey` to fire again.
 * Falling confetti normally; with "reduce motion" on, a still "All done for today" badge instead.
 */
export function Confetti({ burstKey }: { burstKey: number }) {
  const { confetti } = useMotion();
  useEffect(() => {
    if (burstKey === 0) return;
    // After the undo snackbar's own announcement.
    const t = setTimeout(() => AccessibilityInfo.announceForAccessibility('All habits done for today'), 1200);
    return () => clearTimeout(t);
  }, [burstKey]);
  if (burstKey === 0) return null;
  return confetti ? <ConfettiBurst burstKey={burstKey} /> : <StaticCelebration key={burstKey} />;
}

function StaticCelebration() {
  const { c, onColor } = useTheme();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), STATIC_MS);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <View pointerEvents="none" style={[styles.badgeWrap, { top: insets.top + 12 }]} importantForAccessibility="no-hide-descendants">
      <View style={[styles.badge, { backgroundColor: c.success }, shadow(c, 6, false)]}>
        <Text style={[styles.badgeText, { color: onColor(c.success) }]}>🎉 All done for today</Text>
      </View>
    </View>
  );
}

function ConfettiBurst({ burstKey }: { burstKey: number }) {
  const { width, height } = useWindowDimensions();
  const { tag } = useTheme();
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        id: `${burstKey}-${i}`,
        x: noise(burstKey, i * 5) * width,
        delay: noise(burstKey, i * 5 + 1) * 300,
        color: tag(HABIT_COLORS[i % HABIT_COLORS.length]),
        drift: (noise(burstKey, i * 5 + 2) - 0.5) * 120,
        spin: (noise(burstKey, i * 5 + 3) - 0.5) * 720,
        size: 8 + noise(burstKey, i * 5 + 4) * 6,
      })),
    [burstKey, width, tag],
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map(({ id, ...p }) => (
        <Piece key={id} {...p} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', top: 0, left: 0, borderRadius: 2 },
  badgeWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  badge: { borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 10 },
  badgeText: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
});
