import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MONTHS, orderedWeekdays, toKey, WEEKDAY_LETTER } from '@/lib/dates';
import { dayState, habitStart, type DayState } from '@/lib/schedule';
import { mix, useTheme } from '@/lib/theme';
import type { Habit, HabitLog } from '@/lib/types';
import { IconButton } from './ui';

/** Accent strength for partial days, by thirds of the target. */
const PARTIAL_LEVELS = [0.3, 0.5, 0.7];

type Props = {
  habit: Habit;
  /** This habit's entries by date. */
  log: HabitLog;
  year: number;
  month: number;
  today: string;
  weekStartsOn: 0 | 1;
  selected?: string | null;
  onMonthChange: (year: number, month: number) => void;
  onDayPress?: (date: string) => void;
};

/** One month of a habit as a GitHub-style calendar heatmap. */
export function Heatmap({ habit, log, year, month, today, weekStartsOn, selected, onMonthChange, onDayPress }: Props) {
  const { c, onColor } = useTheme();
  const start = habitStart(habit, log);
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toKey(new Date(year, month, i + 1))),
  ];
  while (cells.length % 7) cells.push(null);

  const isCurrentMonth = toKey(first).slice(0, 7) === today.slice(0, 7);
  const shift = (n: number) => {
    const d = new Date(year, month + n, 1);
    onMonthChange(d.getFullYear(), d.getMonth());
  };

  // Accent ramp blended from the surface: pale→deep in light mode, dim→bright in dark mode.
  const heat = (strength: number) => mix(c.surface, c.accent, strength);
  const fill = (state: DayState, date: string) => {
    if (state === 'done') return c.accent;
    if (state === 'partial') {
      const ratio = (log[date]?.value ?? 0) / habit.target;
      return heat(PARTIAL_LEVELS[Math.min(2, Math.floor(ratio * 3))]);
    }
    if (state === 'missed' || state === 'open') return c.surfaceAlt;
    return 'transparent';
  };

  return (
    <View>
      <View style={styles.nav}>
        <IconButton name="chevron-back" label="Previous month" onPress={() => shift(-1)} />
        <Text style={[styles.month, { color: c.text }]}>
          {MONTHS[month]} {year}
        </Text>
        <IconButton
          name="chevron-forward"
          label="Next month"
          onPress={() => shift(1)}
          disabled={isCurrentMonth}
        />
      </View>

      <View style={styles.row}>
        {orderedWeekdays(weekStartsOn).map((d) => (
          <Text key={d} style={[styles.weekday, { color: c.textMuted }]}>
            {WEEKDAY_LETTER[d]}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((date, i) => {
          if (!date) return <View key={`blank-${i}`} style={styles.cell} />;
          const state = dayState(habit, log, date, today, start);
          const bg = fill(state, date);
          const filled = state === 'done' || state === 'partial';
          const ink = filled ? onColor(bg) : state === 'future' ? c.textFaint : c.textMuted;
          const hasNote = !!log[date]?.note;
          const disabled = !onDayPress || state === 'future';
          return (
            <Pressable
              key={date}
              disabled={disabled}
              onPress={() => onDayPress?.(date)}
              accessibilityRole={disabled ? undefined : 'button'}
              accessibilityLabel={`${date}: ${state === 'open' ? 'not logged' : state === 'off' ? 'not scheduled' : state}`}
              style={styles.cell}
            >
              <View
                style={[
                  styles.square,
                  { backgroundColor: bg },
                  state === 'skipped' && { borderWidth: 1.5, borderColor: c.warningText, borderStyle: 'dashed' },
                  date === today && state !== 'done' && { borderWidth: 2, borderColor: c.accent },
                  selected === date && { borderWidth: 2, borderColor: c.text },
                ]}
              >
                <Text style={[styles.dayNum, { color: ink }]}>
                  {Number(date.slice(8))}
                </Text>
                {hasNote ? <View style={[styles.noteDot, { backgroundColor: ink }]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legend}>
        <Legend swatch={<View style={[styles.legendSq, { backgroundColor: c.accent }]} />} label="Done" />
        <Legend swatch={<View style={[styles.legendSq, { backgroundColor: heat(PARTIAL_LEVELS[1]) }]} />} label="Partial" />
        <Legend
          swatch={<View style={[styles.legendSq, { borderWidth: 1.5, borderColor: c.warningText, borderStyle: 'dashed' }]} />}
          label="Skipped"
        />
        <Legend swatch={<View style={[styles.legendSq, { backgroundColor: c.surfaceAlt }]} />} label="Missed" />
      </View>
    </View>
  );
}

function Legend({ swatch, label }: { swatch: ReactNode; label: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.legendItem}>
      {swatch}
      <Text style={{ color: c.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  month: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2.5 },
  square: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayNum: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  noteDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSq: { width: 12, height: 12, borderRadius: 3 },
});
