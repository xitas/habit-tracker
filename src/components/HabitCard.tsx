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

import { useMotion } from '@/lib/motion';
import { alpha, radius, shadow, useTheme } from '@/lib/theme';
import type { Entry, Habit } from '@/lib/types';
import { Emoji, IconButton, MIN_TOUCH } from './ui';

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
  const { checkPop } = useMotion();

  const tx = useSharedValue(0);
  const pop = useSharedValue(1);
  const wasDone = useRef(done);
  const [guard] = useState(createSwipeGuard);

  // Check-mark pop when the habit flips to done.
  useEffect(() => {
    if (done && !wasDone.current && checkPop) {
      pop.value = withSequence(withTiming(0.6, { duration: 80 }), withSpring(1.15, { damping: 6 }), withSpring(1));
    }
    wasDone.current = done;
  }, [done, pop, checkPop]);

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
  const progressText = `${value} / ${habit.target} ${habit.unit}`.trim();

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
            accessibilityLabel={`${habit.name}, ${a11yState}. ${measurable ? `${progressText}. ` : ''}${subtitle}`}
            accessibilityHint={
              measurable
                ? 'Double tap to add one step. Actions: complete, skip, details.'
                : `Double tap to ${done ? 'mark not done' : 'complete'}. Actions: complete, skip, details.`
            }
            // Screen-reader actions (swipe up/down on Android, rotor on iPhone) instead of the swipe gestures.
            accessibilityActions={[
              ...(done ? [] : [{ name: 'complete', label: 'Complete' }]),
              { name: 'skip', label: skipped ? 'Unskip' : 'Skip' },
              { name: 'longpress', label: 'Details and notes' },
            ]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'complete') complete();
              else if (e.nativeEvent.actionName === 'skip') skip();
              else if (e.nativeEvent.actionName === 'longpress') onLongPress(habit);
            }}
            style={styles.row}
          >
            <View style={[styles.icon, { backgroundColor: alpha(color, 0.15) }, skipped && { opacity: 0.5 }]}>
              <Emoji size={24}>{habit.icon}</Emoji>
            </View>
            <View style={styles.body}>
              <Text
                style={[
                  styles.name,
                  { color: skipped ? c.textMuted : c.text },
                  skipped && { textDecorationLine: 'line-through' },
                ]}
              >
                {habit.name}
              </Text>
              <Text style={[styles.sub, { color: c.textMuted }]}>
                {subtitle}
              </Text>
            </View>

            {measurable ? null : (
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
            // Second row: the full value and target always fit (they wrap rather than truncate),
            // and the name above gets the card's full width.
            <View style={styles.measureRow}>
              {skipped ? null : (
                <IconButton name="remove" label={`Decrease ${habit.name}`} onPress={() => onStep(habit, -stepFor(habit.target))} />
              )}
              <View style={styles.measureBody}>
                <Animated.View style={done ? popStyle : undefined}>
                  <Text style={[styles.progressText, { color: skipped ? c.textMuted : c.text }]}>
                    <Text style={styles.progressValue}>{value}</Text> / {habit.target} {habit.unit}
                  </Text>
                </Animated.View>
                <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
                  <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: color }]} />
                </View>
              </View>
              {skipped ? null : (
                <IconButton
                  name="add"
                  label={`Increase ${habit.name}`}
                  bg={alpha(color, 0.15)}
                  color={tagInk(habit.color)}
                  onPress={() => onStep(habit, stepFor(habit.target))}
                />
              )}
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
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 3 },
  check: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  measureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, marginTop: -4 },
  measureBody: { flex: 1, gap: 6 },
  progressText: { fontSize: 15, textAlign: 'center' },
  progressValue: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
