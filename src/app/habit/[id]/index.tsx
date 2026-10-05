import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EntrySheet } from '@/components/EntrySheet';
import { RemindersOffNote, useRemindersBlocked } from '@/components/RemindersOffNote';
import { Heatmap } from '@/components/Heatmap';
import { StreakTiles } from '@/components/StreakTiles';
import { Button, Card, IconButton, SectionLabel } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { addDays, formatLong, formatTime, fromKey } from '@/lib/dates';
import { computeStreaks, dayState, frequencyLabel, habitStart, habitTally, rate, type DayState } from '@/lib/schedule';
import { deleteHabit, updateHabit, useStore } from '@/lib/store';
import { alpha, radius, useTheme } from '@/lib/theme';
import { EMPTY_LOG, type Entry, type Habit } from '@/lib/types';
import { useToday } from '@/lib/useToday';

const PAGE = 30;

type HistoryItem = { date: string; state: DayState; entry: Entry | undefined };

/** One history row. Memoized: re-renders only when its own day changes. */
const HistoryRow = memo(function HistoryRow({
  habit,
  item: { date, state, entry },
  isToday,
  first,
  last,
  onPress,
}: {
  habit: Habit;
  item: HistoryItem;
  isToday: boolean;
  first: boolean;
  last: boolean;
  onPress: (date: string) => void;
}) {
  const { c, tagInk } = useTheme();
  const label = {
    done: { icon: 'checkmark-circle', color: tagInk(habit.color), text: 'Done' },
    partial: { icon: 'ellipse-outline', color: tagInk(habit.color), text: 'Partial' },
    skipped: { icon: 'play-skip-forward-circle', color: c.warningText, text: 'Skipped' },
    missed: { icon: 'close-circle', color: c.dangerText, text: 'Missed' },
    open: { icon: 'ellipse-outline', color: c.textFaint, text: 'Not logged' },
    off: { icon: 'remove-circle-outline', color: c.textFaint, text: 'Not scheduled' },
    future: { icon: 'ellipse-outline', color: c.textFaint, text: '' },
  } as const;
  const s = label[state];
  return (
    <Pressable
      onPress={() => onPress(date)}
      accessibilityRole="button"
      accessibilityLabel={`${formatLong(date)}, ${s.text}${entry?.note ? `, note: ${entry.note}` : ''}`}
      // Rows together look like one card: shared side borders, rounded first and last rows.
      style={[
        styles.historyRow,
        { backgroundColor: c.surface, borderColor: c.border },
        first ? styles.historyFirst : { borderTopWidth: StyleSheet.hairlineWidth },
        last && styles.historyLast,
      ]}
    >
      <Ionicons name={s.icon} size={24} color={s.color} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.historyDate, { color: c.text }]}>{isToday ? 'Today' : formatLong(date)}</Text>
        {entry?.note ? (
          <Text numberOfLines={2} style={[styles.note, { color: c.textMuted }]}>
            “{entry.note}”
          </Text>
        ) : null}
      </View>
      <Text style={[styles.historyValue, { color: c.textMuted }]}>
        {habit.type === 'measurable' && entry && entry.value > 0 ? `${entry.value} ${habit.unit}` : s.text}
      </Text>
    </Pressable>
  );
});

export default function HabitDetailScreen() {
  const { c, tag } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const habit = useStore((s) => s.habits.find((h) => h.id === id));
  // Only this habit's entries: changes to other habits don't re-render this screen.
  const log = useStore((s) => s.entries[id] ?? EMPTY_LOG);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const remindersBlocked = useRemindersBlocked();

  const [month, setMonth] = useState(() => {
    const d = fromKey(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [historyDays, setHistoryDays] = useState(PAGE);

  const history = useMemo(() => {
    if (!habit) return [];
    const start = habitStart(habit, log);
    const rows: HistoryItem[] = [];
    for (let i = 0; i < historyDays; i++) {
      const date = addDays(today, -i);
      const state = dayState(habit, log, date, today, start);
      const entry = log[date];
      if (state === 'off' && !entry?.note) continue;
      if (state === 'open' && !entry?.note && date !== today) continue;
      rows.push({ date, state, entry });
    }
    return rows;
  }, [habit, log, today, historyDays]);

  const renderRow = useCallback(
    ({ item, index }: { item: HistoryItem; index: number }) =>
      habit ? (
        <View style={styles.side}>
          <HistoryRow
            habit={habit}
            item={item}
            isToday={item.date === today}
            first={index === 0}
            last={index === history.length - 1}
            onPress={setSheetDate}
          />
        </View>
      ) : null,
    [habit, today, history.length],
  );

  if (!habit) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: c.textMuted }}>This habit no longer exists.</Text>
      </View>
    );
  }

  const streaks = computeStreaks(habit, log, today, weekStartsOn);
  const rate30 = rate(habitTally(habit, log, addDays(today, -29), today, today, weekStartsOn));
  const canLoadMore = addDays(today, -historyDays) >= addDays(habitStart(habit, log), -1);

  const header = (
    <View style={styles.side}>
      <View style={styles.hero}>
        <View style={[styles.icon, { backgroundColor: alpha(tag(habit.color), 0.15) }]}>
          <Text style={{ fontSize: 34 }}>{habit.icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: c.text }]}>{habit.name}</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            {frequencyLabel(habit)}
            {habit.type === 'measurable' ? ` · ${habit.target} ${habit.unit} / day` : ''}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            {habit.reminderTime ? `🔔 ${formatTime(habit.reminderTime)}` : 'No reminder'}
            {habit.archived ? ' · Archived' : ''}
          </Text>
        </View>
      </View>
      {habit.reminderTime && remindersBlocked ? <RemindersOffNote compact /> : null}

      <StreakTiles streaks={streaks} rate={rate30} />

      <SectionLabel>Calendar</SectionLabel>
      <Card>
        <Heatmap
          habit={habit}
          log={log}
          year={month.year}
          month={month.month}
          today={today}
          weekStartsOn={weekStartsOn}
          selected={sheetDate}
          onMonthChange={(year, m) => setMonth({ year, month: m })}
          onDayPress={setSheetDate}
        />
        <Text style={[styles.hint, { color: c.textMuted }]}>Tap any past day to log it, skip it or add a note.</Text>
      </Card>

      <SectionLabel>History</SectionLabel>
      {history.length === 0 ? (
        <Card>
          <Text style={{ color: c.textMuted }}>No history yet.</Text>
        </Card>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.side}>
      {canLoadMore ? (
        <Button label="Show earlier days" variant="ghost" onPress={() => setHistoryDays((n) => n + PAGE)} />
      ) : null}

      <View style={styles.actions}>
        <Button
          label={habit.archived ? 'Restore habit' : 'Archive habit'}
          variant="secondary"
          icon={habit.archived ? 'arrow-undo-outline' : 'archive-outline'}
          onPress={() => {
            updateHabit(habit.id, { archived: !habit.archived });
            if (!habit.archived) router.back();
          }}
        />
        <Button
          label="Delete habit"
          variant="ghost"
          icon="trash-outline"
          onPress={() =>
            confirm(
              `Delete “${habit.name}”?`,
              'This removes the habit and its entire history. Archive it instead to keep the history.',
              'Delete',
              () => {
                router.back();
                deleteHabit(habit.id);
              },
            )
          }
          style={{ opacity: 0.9 }}
        />
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: habit.name,
          headerRight: () => (
            <IconButton name="create-outline" label="Edit habit" onPress={() => router.push(`/habit/${habit.id}/edit`)} />
          ),
        }}
      />
      <FlatList
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={styles.content}
        data={history}
        keyExtractor={(item) => item.date}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        initialNumToRender={12}
        windowSize={7}
      />

      {sheetDate ? (
        <EntrySheet
          key={sheetDate}
          habit={habit}
          date={sheetDate}
          isToday={sheetDate === today}
          entry={log[sheetDate]}
          onClose={() => setSheetDate(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: 16, paddingBottom: 40 },
  side: { paddingHorizontal: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  icon: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontWeight: '800' },
  meta: { fontSize: 14, marginTop: 3 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 10 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 52,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  historyFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  historyLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  historyDate: { fontSize: 15, fontWeight: '600' },
  note: { fontSize: 13, marginTop: 2, fontStyle: 'italic' },
  historyValue: { fontSize: 14, fontWeight: '600' },
  actions: { marginTop: 24, gap: 8 },
});
