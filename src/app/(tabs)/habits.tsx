import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fab, ScreenHeader, SectionLabel } from '@/components/ui';
import { formatTime } from '@/lib/dates';
import { computeStreaks, frequencyLabel } from '@/lib/schedule';
import { useStore } from '@/lib/store';
import { alpha, radius, shadow, useTheme } from '@/lib/theme';
import type { Habit } from '@/lib/types';
import { useToday } from '@/lib/useToday';

export default function HabitsScreen() {
  const { c, tag } = useTheme();
  const today = useToday();
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const [showArchived, setShowArchived] = useState(false);

  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);

  const row = (h: Habit) => {
    const streak = computeStreaks(h, entries, today, weekStartsOn);
    const details = [
      frequencyLabel(h),
      h.type === 'measurable' ? `${h.target} ${h.unit}` : null,
      h.reminderTime ? `🔔 ${formatTime(h.reminderTime)}` : null,
    ].filter(Boolean);
    return (
      <Pressable
        key={h.id}
        onPress={() => router.push(`/habit/${h.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${h.name}, ${details.join(', ')}, streak ${streak.current}`}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: c.surface, opacity: pressed ? 0.85 : h.archived ? 0.7 : 1 },
          shadow(c),
        ]}
      >
        <View style={[styles.icon, { backgroundColor: alpha(tag(h.color), 0.15) }]}>
          <Text style={{ fontSize: 22 }}>{h.icon}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>
            {h.name}
          </Text>
          <Text numberOfLines={1} style={[styles.meta, { color: c.textMuted }]}>
            {details.join(' · ')}
          </Text>
        </View>
        <View style={styles.streak}>
          <Text style={[styles.streakNum, { color: c.text }]}>{streak.current}</Text>
          <Text style={[styles.streakUnit, { color: c.textMuted }]}>
            {streak.unit === 'week' ? 'wk' : 'day'} streak
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Habits" subtitle={`${active.length} active`} />
        <View style={styles.content}>
          {active.length === 0 ? (
            <Text style={[styles.empty, { color: c.textMuted }]}>No active habits. Tap + to create one.</Text>
          ) : (
            active.map(row)
          )}

          {archived.length > 0 ? (
            <>
              <Pressable
                onPress={() => setShowArchived((v) => !v)}
                accessibilityRole="button"
                style={styles.archivedToggle}
              >
                <SectionLabel>Archived ({archived.length})</SectionLabel>
                <Ionicons name={showArchived ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
              </Pressable>
              {showArchived ? archived.map(row) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
      <Fab label="Add habit" onPress={() => router.push('/habit/new')} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, marginBottom: 10, minHeight: 72 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13, marginTop: 3 },
  streak: { alignItems: 'flex-end' },
  streakNum: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  streakUnit: { fontSize: 11 },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 32 },
  archivedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingRight: 6 },
});
