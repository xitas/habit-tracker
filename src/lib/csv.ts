import { buildCsv } from './csvFormat';
import { shareTextFile } from './shareFile';
import type { AppData } from './types';

export async function exportCsv(data: AppData): Promise<void> {
  const name = `habits-${new Date().toISOString().slice(0, 10)}.csv`;
  await shareTextFile(name, buildCsv(data), {
    mimeType: 'text/csv',
    uti: 'public.comma-separated-values-text',
    dialogTitle: 'Export habits',
  });
}
