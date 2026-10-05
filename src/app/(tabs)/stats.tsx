import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Heatmap } from '@/components/Heatmap';
import { StreakTiles } from '@/components/StreakTiles';
import { Card, Chip, Emoji, ScreenHeader, Segmented, SectionLabel } from '@/components/ui';
import { WeekBars } from '@/components/WeekBars';
import { addDays, fromKey } from '@/lib/dates';
import { computeStreaks, habitTally, rate, type Tally } from '@/lib/schedule';
import { logOf, type Habit } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { useToday } from '@/lib/useToday';

type Range = 7 | 30 | 90;

/** One habit's completion bar. Memoized: re-renders only when its habit or tally changes. */
const RateRow = memo(function RateRow({ habit, tally }: { habit: Habit; tally: Tally }) {
  const { c, tag } = useTheme();
  const r = rate(tally);
  return (
    <Pressable
      onPress={() => router.push(`/habit/${habit.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${habit.name}: ${r === null ? 'no data' : `${Math.round(r * 100)} percent`}`}
      style={styles.rateRow}
    >
      <View style={styles.rateIcon}>
        <Emoji size={22}>{habit.icon}</Emoji>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rateHead}>
          <Text style={[styles.rateName, { color: c.text }]}>
            {habit.name}
          </Text>
          <Text style={[styles.ratePct, { color: c.text }]}>{r === null ? '—' : `${Math.round(r * 100)}%`}</Text>
        </View>
        <View style={[styles.rateTrack, { backgroundColor: c.surfaceAlt }]}>
          <View style={[styles.rateFill, { width: `${(r ?? 0) * 100}%`, backgroundColor: tag(habit.color) }]} />
        </View>
      </View>
    </Pressable>
  );
});

export default function StatsScreen() {
  const { c, tag } = useTheme();
  const today = useToday();
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const active = useMemo(() => habits.filter((h) => !h.archived), [habits]);

  const [range, setRange] = useState<Range>(30);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = active.find((h) => h.id === selectedId) ?? active[0];
  const [month, setMonth] = useState(() => {
    const d = fromKey(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const from = addDays(today, -(range - 1));
  // Cached per habit: after a change, only that habit's tally is recomputed.
  const perHabit = useMemo(
    () => active.map((h) => ({ habit: h, tally: habitTally(h, logOf(entries, h.id), from, today, today, weekStartsOn) })),
    [active, entries, from, today, weekStartsOn],
  );
  const overall = perHabit.reduce<Tally>(
    (acc, { tally }) => ({ done: acc.done + tally.done, expected: acc.expected + tally.expected }),
    { done: 0, expected: 0 },
  );
  const overallRate = rate(overall);

  if (active.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: c.bg }]}>
        <ScreenHeader title="Stats" />
        <View style={styles.empty}>
          <Text style={{ fontSize: 44 }}>📈</Text>
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            Your streaks and charts will appear here once you add a habit.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenHeader title="Stats" />
      <View style={styles.content}>
        <Segmented
          options={[
            { label: '7 days', value: 7 as Range },
            { label: '30 days', value: 30 as Range },
            { label: '90 days', value: 90 as Range },
          ]}
          value={range}
          onChange={setRange}
        />

        <Card style={{ marginTop: 12 }}>
          <Text style={[styles.kicker, { color: c.textMuted }]}>Overall completion</Text>
          <Text style={[styles.hero, { color: c.text }]}>
            {overallRate === null ? '—' : `${Math.round(overallRate * 100)}%`}
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 14 }}>
            {Math.round(overall.done)} of {Math.round(overall.expected)} check-ins · last {range} days
          </Text>

          <View style={{ marginTop: 16, gap: 12 }}>
            {perHabit.map(({ habit, tally }) => (
              <RateRow key={habit.id} habit={habit} tally={tally} />
            ))}
          </View>
        </Card>

        <SectionLabel>Weekly completion</SectionLabel>
        <Card>
          <WeekBars habits={active} entries={entries} today={today} weekStartsOn={weekStartsOn} />
        </Card>

        <SectionLabel>By habit</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {active.map((h) => (
            <Chip
              key={h.id}
              label={`${h.icon} ${h.name}`}
              selected={h.id === selected.id}
              color={tag(h.color)}
              onPress={() => setSelectedId(h.id)}
            />
          ))}
        </ScrollView>
        <Card style={{ gap: 16 }}>
          <StreakTiles streaks={computeStreaks(selected, logOf(entries, selected.id), today, weekStartsOn)} />
          <Heatmap
            habit={selected}
            log={logOf(entries, selected.id)}
            year={month.year}
            month={month.month}
            today={today}
            weekStartsOn={weekStartsOn}
            onMonthChange={(year, m) => setMonth({ year, month: m })}
            onDayPress={() => router.push(`/habit/${selected.id}`)}
          />
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 16 },
  empty: { alignItems: 'center', padding: 40, gap: 12 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  kicker: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  hero: { fontSize: 44, fontWeight: '800', marginVertical: 2, fontVariant: ['tabular-nums'] },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  rateIcon: { width: 34, alignItems: 'center' },
  rateHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  rateName: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  ratePct: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rateTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  rateFill: { height: 6, borderRadius: 3 },
  chips: { gap: 8, paddingBottom: 12, paddingHorizontal: 2 },
});
