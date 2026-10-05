import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut, SlideInDown } from 'react-native-reanimated';

import { useMotion } from '@/lib/motion';
import { radius, shadow, useTheme } from '@/lib/theme';
import { dismissUndo, getUndo, performUndo, subscribeUndo } from '@/lib/undo';
import { MIN_TOUCH, useTabBarHeight } from './ui';

/** How long the undo stays up; longer with a screen reader, which needs time to reach the button. */
const VISIBLE_MS = 5000;
const VISIBLE_MS_SCREEN_READER = 10000;
/** The floating + button: 60 tall, 20 above the tab bar. */
const ABOVE_FAB = 20 + 60 + 12;

/**
 * "Marked done · Undo" bar. Mounted once at the root, above the tab bar and the + button.
 * One at a time: a new offer replaces the current one (see lib/undo.ts).
 */
export function UndoSnackbar() {
  const { c, onColor } = useTheme();
  const motion = useMotion();
  const { height: tabBar } = useTabBarHeight();
  const offer = useSyncExternalStore(subscribeUndo, getUndo, getUndo);
  const [screenReader, setScreenReader] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => sub.remove();
  }, []);

  const id = offer?.id;
  const message = offer?.message;
  useEffect(() => {
    if (id === undefined) return;
    AccessibilityInfo.announceForAccessibility(`${message}. Undo available.`);
    const timer = setTimeout(() => dismissUndo(id), screenReader ? VISIBLE_MS_SCREEN_READER : VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [id, message, screenReader]);

  if (!offer) return null;
  const bg = c.text; // inverted, so it stands out on both themes
  const fg = onColor(bg);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: tabBar + ABOVE_FAB }]}>
      <Animated.View
        key={offer.id}
        entering={motion.slideSnackbar ? SlideInDown.duration(200) : undefined}
        exiting={motion.slideSnackbar ? FadeOut.duration(150) : undefined}
        accessibilityLiveRegion="polite"
        style={[styles.bar, { backgroundColor: bg }, shadow(c, 8, false)]}
      >
        <Text style={[styles.message, { color: fg }]} numberOfLines={3}>
          {offer.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Undo: ${offer.message}`}
          onPress={() => performUndo(offer.id)}
          style={({ pressed }) => [styles.undo, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.undoText, { color: fg }]}>Undo</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => dismissUndo(offer.id)}
          style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="close" size={20} color={fg} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  bar: {
    width: '100%',
    maxWidth: 520,
    minHeight: 52,
    borderRadius: radius.md,
    paddingLeft: 16,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  message: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 8 },
  undo: { minWidth: MIN_TOUCH + 12, minHeight: MIN_TOUCH, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  undoText: { fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
