import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { openAppSettings, useReminderPermission } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import { radius, useTheme } from '@/lib/theme';
import { MIN_TOUCH } from './ui';

/** True when reminders are set up in the app but the phone blocks notifications. */
export function useRemindersBlocked(): boolean {
  const permission = useReminderPermission();
  const enabled = useStore((s) => s.settings.remindersEnabled);
  return enabled && permission === 'denied';
}

/** "Reminders are off — enable in Settings", with a button to the phone's app settings. */
export function RemindersOffNote({ compact = false }: { compact?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.note, compact && styles.compact, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
    >
      <Ionicons name="notifications-off-outline" size={20} color={c.textMuted} />
      <Text style={[styles.text, { color: c.text }]}>Reminders are off — enable in Settings</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open phone settings for this app"
        onPress={openAppSettings}
        style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: c.accent }]}>Open settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    marginTop: 12,
  },
  compact: { marginTop: 0, marginBottom: 10 },
  text: { flex: 1, fontSize: 14, lineHeight: 19 },
  button: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 10 },
  buttonText: { fontSize: 14, fontWeight: '700' },
});
