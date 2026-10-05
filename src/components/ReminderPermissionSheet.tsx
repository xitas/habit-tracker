import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReminderExplainer } from '@/lib/notifications';
import { radius, useTheme } from '@/lib/theme';
import { Button } from './ui';

/**
 * Short explanation shown before the system's notification prompt, so the
 * request isn't a surprise. "Not now" skips the system prompt entirely.
 */
export function ReminderPermissionSheet() {
  const { c, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { visible, answer } = useReminderExplainer();
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => answer(false)}>
      <View style={styles.fill}>
        <Pressable style={[styles.fill, { backgroundColor: c.overlay }]} onPress={() => answer(false)} accessibilityLabel="Not now" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 },
            isDark && { borderWidth: 1, borderBottomWidth: 0, borderColor: c.border },
          ]}
        >
          <View style={[styles.badge, { backgroundColor: c.surfaceAlt }]}>
            <Ionicons name="notifications-outline" size={30} color={c.accent} />
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
            Turn on reminders?
          </Text>
          <Text style={[styles.body, { color: c.textMuted }]}>
            Your habits can remind you at the times you choose, plus a gentle evening nudge if something’s still open.
            Reminders you’ve already done are skipped automatically.
          </Text>
          <Text style={[styles.body, { color: c.textMuted }]}>Your phone will ask for permission next.</Text>
          <View style={styles.row}>
            <Button label="Not now" variant="secondary" onPress={() => answer(false)} style={{ flex: 1 }} />
            <Button label="Continue" onPress={() => answer(true)} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
    alignItems: 'stretch',
  },
  badge: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
