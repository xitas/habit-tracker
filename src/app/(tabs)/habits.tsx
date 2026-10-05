import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fab, ScreenHeader, SectionLabel } from '@/components/ui';
import { formatTime } from '@/lib/dates';
import { computeStreaks, frequencyLabel, type Streaks } from '@/lib/schedule';
import { useStore } from '@/lib/store';
import { alpha, radius, shadow, useTheme } from '@/lib/theme';
import { logOf, type Habit } from '@/lib/types';
import { useToday } from '@/lib/useToday';

type Row = { kind: 'habit'; habit: Habit } | { kind: 'archived-toggle'; count: number };

/** One habit row. Memoized: re-renders only when its habit or streak changes. */
const HabitRow = memo(function HabitRow({ habit: h, streak }: { habit: Habit; streak: Streaks }) {
  const { c, tag } = useTheme();
  const details = [
    frequencyLabel(h),
    h.type === 'measurable' ? `${h.target} ${h.unit}` : null,
    h.reminderTime ? `🔔 ${formatTime(h.reminderTime)}` : null,
  ].filter(Boolean);
  return (
    <Pressable
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
        <Text style={[styles.streakUnit, { color: c.textMuted }]}>{streak.unit === 'week' ? 'wk' : 'day'} streak</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
    </Pressable>
  );
});

export default function HabitsScreen() {
  const { c } = useTheme();
  const today = useToday();
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => habits.filter((h) => !h.archived), [habits]);
  const archived = useMemo(() => habits.filter((h) => h.archived), [habits]);
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = active.map((habit) => ({ kind: 'habit', habit }));
    if (archived.length > 0) {
      list.push({ kind: 'archived-toggle', count: archived.length });
      if (showArchived) list.push(...archived.map((habit): Row => ({ kind: 'habit', habit })));
    }
    return list;
  }, [active, archived, showArchived]);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'archived-toggle') {
        return (
          <Pressable onPress={() => setShowArchived((v) => !v)} accessibilityRole="button" style={[styles.content, styles.archivedToggle]}>
            <SectionLabel>Archived ({item.count})</SectionLabel>
            <Ionicons name={showArchived ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
          </Pressable>
        );
      }
      // Cached per habit: unchanged habits return the same streak object, so their rows don't re-render.
      const streak = computeStreaks(item.habit, logOf(entries, item.habit.id), today, weekStartsOn);
      return (
        <View style={styles.content}>
          <HabitRow habit={item.habit} streak={streak} />
        </View>
      );
    },
    [entries, today, weekStartsOn, showArchived, c.textMuted],
  );

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'habit' ? r.habit.id : 'archived-toggle')}
        renderItem={renderRow}
        ListHeaderComponent={<ScreenHeader title="Habits" subtitle={`${active.length} active`} />}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: c.textMuted }]}>No active habits. Tap + to create one.</Text>
        }
        contentContainerStyle={{ paddingBottom: 110 }}
        initialNumToRender={12}
        windowSize={7}
      />
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
  archivedToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingRight: 22 },
});
