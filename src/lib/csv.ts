import { frequencyLabel } from './schedule';
import { shareTextFile } from './shareFile';
import { allEntries, type AppData } from './types';

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per entry, joined with its habit's details. */
export function buildCsv(data: AppData): string {
  const habits = new Map(data.habits.map((h) => [h.id, h]));
  const header = ['date', 'habit', 'icon', 'status', 'value', 'target', 'unit', 'frequency', 'archived', 'note'];
  const rows = allEntries(data.entries)
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
  const name = `habits-${new Date().toISOString().slice(0, 10)}.csv`;
  await shareTextFile(name, buildCsv(data), {
    mimeType: 'text/csv',
    uti: 'public.comma-separated-values-text',
    dialogTitle: 'Export habits',
  });
}
