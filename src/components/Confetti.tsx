import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { HABIT_COLORS, useTheme } from '@/lib/theme';

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

/** One-shot confetti burst. Change `burstKey` to fire again. */
export function Confetti({ burstKey }: { burstKey: number }) {
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
  if (burstKey === 0) return null;
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
});
