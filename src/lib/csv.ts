import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { frequencyLabel } from './schedule';
import type { AppData } from './types';

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per entry, joined with its habit's details. */
export function buildCsv(data: AppData): string {
  const habits = new Map(data.habits.map((h) => [h.id, h]));
  const header = ['date', 'habit', 'icon', 'status', 'value', 'target', 'unit', 'frequency', 'archived', 'note'];
  const rows = Object.values(data.entries)
    .sort((a, b) => (a.date === b.date ? a.habitId.localeCompare(b.habitId) : a.date.localeCompare(b.date)))
    .map((e) => {
      const h = habits.get(e.habitId);
      return [
        e.date,
        h?.name ?? '(deleted)',
        h?.icon,
        e.status,
        e.value,
        h?.target,
        h?.unit,
        h ? frequencyLabel(h) : '',
        h?.archived ? 'yes' : 'no',
        e.note,
      ];
    });
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export async function exportCsv(data: AppData): Promise<void> {
  const csv = buildCsv(data);
  const name = `habits-${new Date().toISOString().slice(0, 10)}.csv`;

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export habits', UTI: 'public.comma-separated-values-text' });
}
