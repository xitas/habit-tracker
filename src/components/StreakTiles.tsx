import { StyleSheet, Text, View } from 'react-native';

import type { Streaks } from '@/lib/schedule';
import { radius, useTheme } from '@/lib/theme';
import { useLargeText } from './ui';

export function StreakTiles({ streaks, rate }: { streaks: Streaks; rate?: number | null }) {
  const { c } = useTheme();
  // Large text: one tile per row, so big numbers never overflow a third of the width.
  const stacked = useLargeText();
  const unit = (n: number) => `${streaks.unit}${n === 1 ? '' : 's'}`;
  const tiles = [
    { label: 'Current streak', value: `${streaks.current > 0 ? '🔥 ' : ''}${streaks.current}`, sub: unit(streaks.current) },
    { label: 'Best streak', value: `${streaks.best}`, sub: unit(streaks.best) },
    ...(rate !== undefined
      ? [{ label: '30-day rate', value: rate === null ? '—' : `${Math.round(rate * 100)}%`, sub: 'completion' }]
      : []),
  ];
  return (
    <View style={stacked ? styles.column : styles.row}>
      {tiles.map((t) => (
        <View key={t.label} style={[styles.tile, { backgroundColor: c.surfaceAlt }]}>
          <Text style={[styles.value, { color: c.text }]}>{t.value}</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>{t.sub}</Text>
          <Text style={[styles.label, { color: c.textMuted }]}>{t.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  column: { gap: 10 },
  tile: { flex: 1, borderRadius: radius.md, padding: 12 },
  value: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 12, fontWeight: '600' },
  label: { fontSize: 12, marginTop: 6 },
});
