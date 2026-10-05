import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { alpha, radius, shadow, useTheme } from '@/lib/theme';
import type { Entry, Habit } from '@/lib/types';
import { IconButton, MIN_TOUCH } from './ui';

const SWIPE_THRESHOLD = 90;
/** Presses landing this soon after a swipe belong to the swipe, not a tap. */
const PRESS_GUARD_MS = 400;

/** Tracks swipe timing so the press that ends a swipe isn't also treated as a tap. */
function createSwipeGuard() {
  let swiping = false;
  let endedAt = 0;
  return {
    start: () => {
      swiping = true;
    },
    end: () => {
      swiping = false;
      endedAt = Date.now();
    },
    blocks: () => swiping || Date.now() - endedAt < PRESS_GUARD_MS,
  };
}

/** Sensible +/− increment for a measurable target (8 glasses → 1, 30 min → 5, 10000 steps → 1000). */
export function stepFor(target: number): number {
  if (target <= 10) return 1;
  if (target <= 60) return 5;
  return Math.pow(10, Math.floor(Math.log10(target)) - 1);
}

type Props = {
  habit: Habit;
  entry?: Entry;
  subtitle: string;
  // Handlers receive the habit, so the parent can pass the same functions to every card
  // and React.memo can skip cards whose habit, entry and subtitle didn't change.
  onComplete: (habit: Habit) => void;
  onSkip: (habit: Habit) => void;
  onTap: (habit: Habit) => void;
  onLongPress: (habit: Habit) => void;
  onStep: (habit: Habit, delta: number) => void;
};

export const HabitCard = memo(function HabitCard({
  habit,
  entry,
  subtitle,
  onComplete,
  onSkip,
  onTap,
  onLongPress,
  onStep,
}: Props) {
  const complete = () => onComplete(habit);
  const skip = () => onSkip(habit);
  const { c, tag, tagInk, onColor } = useTheme();
  const color = tag(habit.color);
  const done = entry?.status === 'done';
  const skipped = entry?.status === 'skipped';
  const value = entry?.value ?? 0;
  const measurable = habit.type === 'measurable';

  const tx = useSharedValue(0);
  const pop = useSharedValue(1);
  const wasDone = useRef(done);
  const [guard] = useState(createSwipeGuard);

  // Check-mark pop when the habit flips to done.
  useEffect(() => {
    if (done && !wasDone.current) {
      pop.value = withSequence(withTiming(0.6, { duration: 80 }), withSpring(1.15, { damping: 6 }), withSpring(1));
    }
    wasDone.current = done;
  }, [done, pop]);

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onStart(() => {
      scheduleOnRN(guard.start);
    })
    .onUpdate((e) => {
      tx.value = e.translationX;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD) scheduleOnRN(complete);
      else if (e.translationX < -SWIPE_THRESHOLD) scheduleOnRN(skip);
      tx.value = withSpring(0, { damping: 18, stiffness: 180 });
    })
    .onFinalize((_e, success) => {
      if (success) scheduleOnRN(guard.end);
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const doneBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, SWIPE_THRESHOLD], [0, 1], 'clamp'),
  }));
  const skipBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_THRESHOLD, 0], [1, 0], 'clamp'),
  }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const progress = measurable ? Math.min(1, value / habit.target) : done ? 1 : 0;
  const a11yState = done ? 'done' : skipped ? 'skipped' : 'not done';

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.behind, { backgroundColor: c.success }, doneBgStyle]}>
        <Ionicons name="checkmark-circle" size={26} color={onColor(c.success)} />
        <Text style={[styles.behindText, { color: onColor(c.success) }]}>Done</Text>
      </Animated.View>
      <Animated.View style={[styles.behind, styles.behindRight, { backgroundColor: c.warning }, skipBgStyle]}>
        <Text style={[styles.behindText, { color: onColor(c.warning) }]}>Skip</Text>
        <Ionicons name="play-skip-forward" size={22} color={onColor(c.warning)} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.card, { backgroundColor: c.surface }, shadow(c), cardStyle]}>
          <Pressable
            onPress={() => !guard.blocks() && onTap(habit)}
            onLongPress={() => !guard.blocks() && onLongPress(habit)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={`${habit.name}, ${a11yState}. ${subtitle}`}
            accessibilityHint="Swipe right to complete, left to skip. Long press for details and notes."
            style={styles.row}
          >
            <View style={[styles.icon, { backgroundColor: alpha(color, 0.15) }, skipped && { opacity: 0.5 }]}>
              <Text style={styles.emoji}>{habit.icon}</Text>
            </View>
            <View style={styles.body}>
              <Text
                numberOfLines={1}
                style={[
                  styles.name,
                  { color: skipped ? c.textMuted : c.text },
                  skipped && { textDecorationLine: 'line-through' },
                ]}
              >
                {habit.name}
              </Text>
              <Text numberOfLines={1} style={[styles.sub, { color: c.textMuted }]}>
                {subtitle}
              </Text>
            </View>

            {measurable && !skipped ? (
              <View style={styles.stepper}>
                <IconButton name="remove" label={`Decrease ${habit.name}`} onPress={() => onStep(habit, -stepFor(habit.target))} />
                <Animated.View style={done ? popStyle : undefined}>
                  <Text style={[styles.value, { color: c.text }]}>{value}</Text>
                </Animated.View>
                <IconButton
                  name="add"
                  label={`Increase ${habit.name}`}
                  bg={alpha(color, 0.15)}
                  color={tagInk(habit.color)}
                  onPress={() => onStep(habit, stepFor(habit.target))}
                />
              </View>
            ) : (
              <Animated.View
                style={[
                  styles.check,
                  { borderColor: done ? color : c.border, backgroundColor: done ? color : 'transparent' },
                  popStyle,
                ]}
              >
                {done ? <Ionicons name="checkmark" size={26} color={onColor(color)} /> : null}
                {skipped ? <Ionicons name="play-skip-forward" size={18} color={c.warningText} /> : null}
              </Animated.View>
            )}
          </Pressable>
          {measurable ? (
            <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
              <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: color }]} />
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  behind: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    gap: 8,
  },
  behindRight: { justifyContent: 'flex-end' },
  behindText: { fontWeight: '700', fontSize: 16 },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, minHeight: 76, gap: 12 },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24 },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontSize: 18, fontWeight: '800', minWidth: 34, textAlign: 'center', fontVariant: ['tabular-nums'] },
  check: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { height: 4, marginHorizontal: 14, marginBottom: 10, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
