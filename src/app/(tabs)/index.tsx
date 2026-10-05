import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Confetti } from '@/components/Confetti';
import { EmptyState, remainingSuggestions, SuggestionList } from '@/components/EmptyState';
import { EntrySheet } from '@/components/EntrySheet';
import { HabitCard, stepFor } from '@/components/HabitCard';
import { ProgressRing } from '@/components/ProgressRing';
import { Card, FAB_CLEARANCE, Fab, ScreenHeader, SectionLabel, useLargeText } from '@/components/ui';
import { formatLong } from '@/lib/dates';
import { computeStreaks, dayTally, frequencyLabel, getEntry, isDueOn, weeklyRemaining } from '@/lib/schedule';
import { clearStatus, getState, markDone, markSkipped, setValue, useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { logOf, type Entry, type Habit } from '@/lib/types';
import { useToday } from '@/lib/useToday';

const haptic = (kind: 'light' | 'success') => {
  if (Platform.OS === 'web') return;
  if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

function cardSubtitle(habit: Habit, entry: Entry | undefined, remaining: number, streak: number): string {
  if (entry?.status === 'skipped') return 'Skipped · tap to undo';
  const parts: string[] = [];
  parts.push(frequencyLabel(habit));
  if (habit.frequency.kind === 'timesPerWeek' && entry?.status !== 'done') {
    parts.push(`${remaining} left this week`);
  }
  if (streak >= 2) parts.push(`🔥 ${streak}`);
  return parts.join(' · ');
}

export default function TodayScreen() {
  const { c } = useTheme();
  const today = useToday();
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const [sheetHabit, setSheetHabit] = useState<Habit | null>(null);
  const [burst, setBurst] = useState(0);
  const largeText = useLargeText();

  // Per-habit results are cached in schedule.ts, so after a tap only the changed habit is recomputed.
  const active = useMemo(() => habits.filter((h) => !h.archived), [habits]);
  const due = useMemo(
    () => active.filter((h) => isDueOn(h, logOf(entries, h.id), today, weekStartsOn)),
    [active, entries, today, weekStartsOn],
  );
  const notDue = useMemo(() => active.filter((h) => !due.includes(h)), [active, due]);
  const tally = useMemo(() => dayTally(active, entries, today, weekStartsOn), [active, entries, today, weekStartsOn]);

  const allDone = tally.expected > 0 && tally.done === tally.expected;
  const prevAllDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !prevAllDone.current) {
      setBurst((b) => b + 1);
      haptic('success');
    }
    prevAllDone.current = allDone;
  }, [allDone]);

  const pct = tally.expected ? tally.done / tally.expected : 0;
  // Keep offering the starter habits until the user has a few.
  const suggestions = active.length < 3 ? remainingSuggestions(habits.map((h) => h.name)) : [];

  // Stable handlers: they read the latest entry when called instead of closing over `entries`,
  // so every card gets the same functions and unchanged cards skip re-rendering.
  const current = useCallback((h: Habit) => getEntry(getState().entries, h.id, today), [today]);
  const complete = useCallback(
    (h: Habit) => {
      if (current(h)?.status === 'done') return;
      markDone(h, today);
      haptic('light');
    },
    [current, today],
  );
  const skip = useCallback(
    (h: Habit) => {
      if (current(h)?.status === 'skipped') clearStatus(h, today);
      else markSkipped(h, today);
    },
    [current, today],
  );
  const step = useCallback(
    (h: Habit, delta: number) => {
      const e = current(h);
      const next = (e?.status === 'skipped' ? 0 : (e?.value ?? 0)) + delta;
      setValue(h, today, next);
      if (next >= h.target && (e?.value ?? 0) < h.target) haptic('light');
    },
    [current, today],
  );
  const tap = useCallback(
    (h: Habit) => {
      const e = current(h);
      if (e?.status === 'skipped') return clearStatus(h, today);
      if (h.type === 'measurable') return step(h, stepFor(h.target));
      if (e?.status === 'done') return clearStatus(h, today);
      complete(h);
    },
    [current, today, step, complete],
  );
  const openSheet = useCallback((h: Habit) => setSheetHabit(h), []);

  const renderCard = useCallback(
    ({ item: h }: { item: Habit }) => {
      const log = logOf(entries, h.id);
      const e = log[today];
      const streak = computeStreaks(h, log, today, weekStartsOn);
      return (
        <View style={styles.content}>
          <HabitCard
            habit={h}
            entry={e}
            subtitle={cardSubtitle(h, e, weeklyRemaining(h, log, today, weekStartsOn), streak.current)}
            onComplete={complete}
            onSkip={skip}
            onTap={tap}
            onLongPress={openSheet}
            onStep={step}
          />
        </View>
      );
    },
    [entries, today, weekStartsOn, complete, skip, tap, openSheet, step],
  );

  if (active.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: c.bg }]}>
        <ScrollView>
          <ScreenHeader title="Today" subtitle={formatLong(today)} />
          <EmptyState onCreate={() => router.push('/habit/new')} />
        </ScrollView>
      </View>
    );
  }

  const header = (
    <>
      <ScreenHeader title="Today" subtitle={formatLong(today)} />
      <View style={styles.content}>
        <Card style={[styles.ringCard, largeText && styles.ringCardStacked]}>
          <ProgressRing
            progress={pct}
            label={`${Math.round(pct * 100)}%`}
            caption={tally.expected ? `${tally.done} of ${tally.expected}` : 'Rest day'}
          />
          <View style={largeText ? styles.ringTextStacked : { flex: 1 }}>
            <Text style={[styles.ringTitle, { color: c.text }]}>
              {tally.expected === 0
                ? 'Nothing due today'
                : allDone
                  ? 'All done today!'
                  : tally.done === 0
                    ? 'Let’s get started'
                    : 'Nice, keep going'}
            </Text>
            <Text style={[styles.ringBody, { color: c.textMuted }]}>
              {tally.expected === 0
                ? 'Enjoy the break.'
                : allDone
                  ? 'Every habit checked off. 🎉'
                  : `${tally.expected - tally.done} habit${tally.expected - tally.done === 1 ? '' : 's'} left`}
            </Text>
          </View>
        </Card>

        {due.length > 0 ? (
          <>
            <SectionLabel>Due today</SectionLabel>
            <Text style={[styles.hint, { color: c.textMuted }]}>Swipe right to complete · left to skip</Text>
          </>
        ) : null}
      </View>
    </>
  );

  const footer = (
    <View style={styles.content}>
      {suggestions.length > 0 ? (
        <>
          <SectionLabel>Suggestions</SectionLabel>
          <SuggestionList suggestions={suggestions} />
        </>
      ) : null}

      {notDue.length > 0 ? (
        <>
          <SectionLabel>Not due today</SectionLabel>
          <Card style={{ paddingVertical: 4 }}>
            {notDue.map((h, i) => (
              <Text
                key={h.id}
                onPress={() => router.push(`/habit/${h.id}`)}
                style={[
                  styles.notDue,
                  { color: c.textMuted, borderTopColor: c.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 },
                ]}
              >
                {h.icon}  {h.name}
                <Text style={{ color: c.textMuted }}>
                  {'  ·  '}
                  {h.frequency.kind === 'timesPerWeek' ? 'Weekly goal met' : frequencyLabel(h)}
                </Text>
              </Text>
            ))}
          </Card>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <FlatList
        data={due}
        keyExtractor={(h) => h.id}
        renderItem={renderCard}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: FAB_CLEARANCE }}
        initialNumToRender={10}
        windowSize={7}
      />

      <Fab label="Add habit" onPress={() => router.push('/habit/new')} />
      <Confetti burstKey={burst} />
      {sheetHabit ? (
        <EntrySheet
          key={`${sheetHabit.id}-${today}`}
          habit={sheetHabit}
          date={today}
          isToday
          entry={getEntry(entries, sheetHabit.id, today)}
          onClose={() => setSheetHabit(null)}
          onOpenHabit={() => {
            setSheetHabit(null);
            router.push(`/habit/${sheetHabit.id}`);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 16 },
  ringCard: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  // Large text: the ring sits above the message instead of squeezing it.
  ringCardStacked: { flexDirection: 'column', alignItems: 'center', gap: 12 },
  ringTextStacked: { alignSelf: 'stretch', alignItems: 'center' },
  ringTitle: { fontSize: 20, fontWeight: '800' },
  ringBody: { fontSize: 15, marginTop: 4, lineHeight: 20 },
  hint: { fontSize: 12, marginHorizontal: 4, marginTop: -4, marginBottom: 10 },
  notDue: { fontSize: 15, paddingVertical: 14, minHeight: 48 },
});
