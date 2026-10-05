import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addDays, formatLong, fromKey, startOfWeek, WEEKDAY_SHORT } from '@/lib/dates';
import { dayTally } from '@/lib/schedule';
import { useTheme } from '@/lib/theme';
import type { EntriesByHabit, Habit } from '@/lib/types';
import { FONT_CAPS, IconButton } from './ui';

const CHART_HEIGHT = 120;

/** Daily completion % for one week, with week navigation and tap-to-inspect bars. */
export function WeekBars({
  habits,
  entries,
  today,
  weekStartsOn,
}: {
  habits: Habit[];
  entries: EntriesByHabit;
  today: string;
  weekStartsOn: 0 | 1;
}) {
  const { c } = useTheme();
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const weekStart = addDays(startOfWeek(today, weekStartsOn), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const data = days.map((d) => ({ date: d, ...dayTally(habits, entries, d, weekStartsOn), future: d > today }));

  const pickedRow = data.find((d) => d.date === picked);
  const title =
    offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `Week of ${formatLong(weekStart).slice(5)}`;

  return (
    <View>
      <View style={styles.nav}>
        <IconButton name="chevron-back" label="Previous week" onPress={() => { setOffset((o) => o - 1); setPicked(null); }} />
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        <IconButton
          name="chevron-forward"
          label="Next week"
          disabled={offset === 0}
          onPress={() => { setOffset((o) => o + 1); setPicked(null); }}
        />
      </View>

      <Text style={[styles.readout, { color: c.textMuted }]}>
        {pickedRow
          ? pickedRow.expected
            ? `${formatLong(pickedRow.date)} · ${pickedRow.done} of ${pickedRow.expected} done (${Math.round((pickedRow.done / pickedRow.expected) * 100)}%)`
            : `${formatLong(pickedRow.date)} · nothing due`
          : 'Tap a bar for details'}
      </Text>

      <View style={[styles.chart, { borderBottomColor: c.border }]}>
        {data.map((d) => {
          const pct = d.expected ? d.done / d.expected : 0;
          const isPicked = d.date === picked;
          return (
            <Pressable
              key={d.date}
              style={styles.col}
              onPress={() => setPicked(isPicked ? null : d.date)}
              accessibilityRole="button"
              accessibilityLabel={`${formatLong(d.date)}: ${d.expected ? `${Math.round(pct * 100)} percent` : 'nothing due'}`}
            >
              <View style={styles.barArea}>
                <View style={[styles.track, { backgroundColor: c.surfaceAlt }]} />
                {!d.future && d.expected > 0 ? (
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, pct * CHART_HEIGHT),
                        backgroundColor: pct >= 1 ? c.success : c.accent,
                        opacity: picked && !isPicked ? 0.45 : 1,
                      },
                    ]}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.labels}>
        {days.map((d) => (
          <Text
            maxFontSizeMultiplier={FONT_CAPS.grid}
            key={d}
            style={[styles.dayLabel, { color: d === today ? c.text : c.textMuted, fontWeight: d === today ? '800' : '600' }]}
          >
            {WEEKDAY_SHORT[fromKey(d).getDay()].slice(0, 2)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '700' },
  readout: { fontSize: 13, textAlign: 'center', marginVertical: 8, minHeight: 18 },
  chart: { flexDirection: 'row', height: CHART_HEIGHT, borderBottomWidth: StyleSheet.hairlineWidth },
  col: { flex: 1, alignItems: 'center' },
  barArea: { width: 22, height: '100%', justifyContent: 'flex-end' },
  track: { ...StyleSheet.absoluteFill, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  labels: { flexDirection: 'row', marginTop: 6 },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 12 },
});
