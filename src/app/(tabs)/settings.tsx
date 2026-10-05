import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RemindersOffNote, useRemindersBlocked } from '@/components/RemindersOffNote';
import { Card, ScreenHeader, Segmented, SectionLabel, ThemedSwitch, TimeStepper, useLargeText } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { exportCsv } from '@/lib/csv';
import { askForReminders, notificationsUnavailableReason } from '@/lib/notifications';
import { countEntries } from '@/lib/persistence/validate';
import { getState, resetAll, updateSettings, useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { c } = useTheme();
  const settings = useStore((s) => s.settings);
  const entryCount = useStore((s) => countEntries(s));
  const remindersBlocked = useRemindersBlocked();
  const [message, setMessage] = useState<string | null>(null);

  const toggleReminders = async (on: boolean) => {
    updateSettings({ remindersEnabled: on });
    setMessage(null);
    // Explains first, then asks; never re-asks after a denial (the note below covers that).
    if (on) await askForReminders();
  };

  const doExport = async () => {
    try {
      await exportCsv(getState());
      setMessage(null);
    } catch (err) {
      setMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <ScreenHeader title="Settings" />
      <View style={styles.content}>
        <SectionLabel>Appearance</SectionLabel>
        <Card style={{ gap: 10 }}>
          <Text style={[styles.label, { color: c.text }]}>Theme</Text>
          <Segmented
            options={[
              { label: 'Light', value: 'light' as const },
              { label: 'Dark', value: 'dark' as const },
              { label: 'System', value: 'system' as const },
            ]}
            value={settings.theme}
            onChange={(v) => updateSettings({ theme: v })}
          />
          {settings.theme === 'system' ? (
            <Text style={[styles.help, { color: c.textMuted }]}>Matches your phone’s light or dark setting.</Text>
          ) : null}
        </Card>

        <SectionLabel>Calendar</SectionLabel>
        <Card style={{ gap: 10 }}>
          <Text style={[styles.label, { color: c.text }]}>Week starts on</Text>
          <Segmented
            options={[
              { label: 'Monday', value: 1 as const },
              { label: 'Sunday', value: 0 as const },
            ]}
            value={settings.weekStartsOn}
            onChange={(v) => updateSettings({ weekStartsOn: v })}
          />
        </Card>

        <SectionLabel>Reminders</SectionLabel>
        <Card style={{ gap: 12 }}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.text }]}>Reminders</Text>
              <Text style={[styles.help, { color: c.textMuted }]}>Habit reminders and the evening nudge</Text>
            </View>
            <ThemedSwitch value={settings.remindersEnabled} onValueChange={toggleReminders} label="Reminders" />
          </View>
          {settings.remindersEnabled ? (
            <>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Text style={[styles.label, { color: c.text }]}>Evening nudge</Text>
              <Text style={[styles.help, { color: c.textMuted, marginTop: -8 }]}>
                A gentle reminder if habits are still open
              </Text>
              <TimeStepper value={settings.nudgeTime} onChange={(t) => updateSettings({ nudgeTime: t })} />
            </>
          ) : null}
          {remindersBlocked ? <RemindersOffNote compact /> : null}
          {notificationsUnavailableReason ? (
            <Text style={[styles.help, { color: c.textMuted }]}>{notificationsUnavailableReason}</Text>
          ) : null}
        </Card>

        <SectionLabel>Data</SectionLabel>
        <Card style={{ paddingVertical: 4 }}>
          <Row icon="download-outline" label="Export data as CSV" detail={`${entryCount} entries`} onPress={doExport} />
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <Row
            icon="trash-outline"
            label="Reset all data"
            danger
            onPress={() =>
              confirm(
                'Reset all data?',
                'This permanently deletes every habit, entry and note on this device. Consider exporting first.',
                'Reset',
                () => {
                  resetAll();
                  setMessage('All data has been reset.');
                },
              )
            }
          />
        </Card>

        {message ? <Text style={[styles.message, { color: c.textMuted }]}>{message}</Text> : null}

        <Text style={[styles.footer, { color: c.textMuted }]}>
          Everything is stored on this device only. No account, works offline.
        </Text>
      </View>
    </ScrollView>
  );
}

function Row({
  icon,
  label,
  detail,
  danger,
  onPress,
}: {
  icon: 'download-outline' | 'trash-outline';
  label: string;
  detail?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const stacked = useLargeText();
  const color = danger ? c.dangerText : c.text;
  const detailText = detail ? <Text style={[styles.help, { color: c.textMuted }]}>{detail}</Text> : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color }]}>{label}</Text>
        {stacked ? detailText : null}
      </View>
      {stacked ? null : detailText}
      <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16 },
  label: { fontSize: 16, fontWeight: '600' },
  help: { fontSize: 13, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  divider: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  message: { fontSize: 14, textAlign: 'center', marginTop: 16, lineHeight: 20 },
  footer: { fontSize: 13, textAlign: 'center', marginTop: 28 },
});
