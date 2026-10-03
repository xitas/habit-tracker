import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EntrySheet } from '@/components/EntrySheet';
import { Heatmap } from '@/components/Heatmap';
import { StreakTiles } from '@/components/StreakTiles';
import { Button, Card, IconButton, SectionLabel } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { addDays, formatLong, formatTime, fromKey } from '@/lib/dates';
import { computeStreaks, dayState, frequencyLabel, getEntry, habitStart, habitTally, rate } from '@/lib/schedule';
import { deleteHabit, updateHabit, useStore } from '@/lib/store';
import { alpha, useTheme } from '@/lib/theme';
import { useToday } from '@/lib/useToday';

const PAGE = 30;

export default function HabitDetailScreen() {
  const { c, tag, tagInk } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const habit = useStore((s) => s.habits.find((h) => h.id === id));
  const entries = useStore((s) => s.entries);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);

  const [month, setMonth] = useState(() => {
    const d = fromKey(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [historyDays, setHistoryDays] = useState(PAGE);

  const history = useMemo(() => {
    if (!habit) return [];
    const start = habitStart(habit, entries);
    const rows = [];
    for (let i = 0; i < historyDays; i++) {
      const date = addDays(today, -i);
      const state = dayState(habit, entries, date, today, start);
      const entry = getEntry(entries, habit.id, date);
      if (state === 'off' && !entry?.note) continue;
      if (state === 'open' && !entry?.note && date !== today) continue;
      rows.push({ date, state, entry });
    }
    return rows;
  }, [habit, entries, today, historyDays]);

  if (!habit) {
    return (
      <View style={{ padding: 24 }}>
        <Text style={{ color: c.textMuted }}>This habit no longer exists.</Text>
      </View>
    );
  }

  const streaks = computeStreaks(habit, entries, today, weekStartsOn);
  const rate30 = rate(habitTally(habit, entries, addDays(today, -29), today, today, weekStartsOn));
  const canLoadMore = addDays(today, -historyDays) >= addDays(habitStart(habit, entries), -1);

  const stateLabel = {
    done: { icon: 'checkmark-circle', color: tagInk(habit.color), text: 'Done' },
    partial: { icon: 'ellipse-outline', color: tagInk(habit.color), text: 'Partial' },
    skipped: { icon: 'play-skip-forward-circle', color: c.warningText, text: 'Skipped' },
    missed: { icon: 'close-circle', color: c.dangerText, text: 'Missed' },
    open: { icon: 'ellipse-outline', color: c.textFaint, text: 'Not logged' },
    off: { icon: 'remove-circle-outline', color: c.textFaint, text: 'Not scheduled' },
    future: { icon: 'ellipse-outline', color: c.textFaint, text: '' },
  } as const;

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
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.content}>
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

        <StreakTiles streaks={streaks} rate={rate30} />

        <SectionLabel>Calendar</SectionLabel>
        <Card>
          <Heatmap
            habit={habit}
            entries={entries}
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
        <Card style={{ paddingVertical: 4 }}>
          {history.map(({ date, state, entry }, i) => {
            const s = stateLabel[state];
            return (
              <Pressable
                key={date}
                onPress={() => setSheetDate(date)}
                accessibilityRole="button"
                accessibilityLabel={`${formatLong(date)}, ${s.text}${entry?.note ? `, note: ${entry.note}` : ''}`}
                style={[styles.historyRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
              >
                <Ionicons name={s.icon} size={24} color={s.color} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.historyDate, { color: c.text }]}>
                    {date === today ? 'Today' : formatLong(date)}
                  </Text>
                  {entry?.note ? (
                    <Text numberOfLines={2} style={[styles.note, { color: c.textMuted }]}>
                      “{entry.note}”
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.historyValue, { color: c.textMuted }]}>
                  {habit.type === 'measurable' && entry && entry.value > 0
                    ? `${entry.value} ${habit.unit}`
                    : s.text}
                </Text>
              </Pressable>
            );
          })}
          {history.length === 0 ? (
            <Text style={{ color: c.textMuted, padding: 14 }}>No history yet.</Text>
          ) : null}
        </Card>
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
      </ScrollView>

      {sheetDate ? (
        <EntrySheet
          key={sheetDate}
          habit={habit}
          date={sheetDate}
          isToday={sheetDate === today}
          entry={getEntry(entries, habit.id, sheetDate)}
          onClose={() => setSheetDate(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  icon: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontWeight: '800' },
  meta: { fontSize: 14, marginTop: 3 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 52 },
  historyDate: { fontSize: 15, fontWeight: '600' },
  note: { fontSize: 13, marginTop: 2, fontStyle: 'italic' },
  historyValue: { fontSize: 14, fontWeight: '600' },
  actions: { marginTop: 24, gap: 8 },
});
