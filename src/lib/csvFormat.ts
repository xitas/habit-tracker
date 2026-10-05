// The app's CSV format: building the export and importing it back. Pure: tested in Node
// (sharing the file lives in csv.ts).
//
// Habits are matched by name (case-insensitive). The CSV carries each habit's
// icon, target, unit, frequency and archived flag; it doesn't carry colors,
// reminder times or creation dates, so new habits get a palette color, no
// reminder, and their first entry's day as creation date.

import { describeError, parseAppData } from './persistence/validate';
import { frequencyLabel } from './schedule';
import { HABIT_COLORS } from './tokens';
import { allEntries, entryKey, serialize, type AppData, type Entry, type EntryStatus, type Frequency, type Habit, type Weekday } from './types';

export const CSV_COLUMNS = ['date', 'habit', 'icon', 'status', 'value', 'target', 'unit', 'frequency', 'archived', 'note'] as const;

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per entry, joined with its habit's details. */
export function buildCsv(data: AppData): string {
  const habits = new Map(data.habits.map((h) => [h.id, h]));
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
  return [[...CSV_COLUMNS], ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Reverses frequencyLabel(): "Every day", "Weekdays", "Weekends", "3× per week", "Mon, Wed, Fri". */
export function parseFrequency(label: string): Frequency | null {
  const s = label.trim();
  if (s === 'Every day') return { kind: 'daily' };
  if (s === 'Weekdays') return { kind: 'weekdays', days: [1, 2, 3, 4, 5] };
  if (s === 'Weekends') return { kind: 'weekdays', days: [6, 0] };
  const times = /^(\d)\s*[×x]\s*per week$/i.exec(s);
  if (times) {
    const count = Number(times[1]);
    return count >= 1 && count <= 7 ? { kind: 'timesPerWeek', count } : null;
  }
  const parts = s.split(',').map((p) => p.trim());
  const days = parts.map((p) => DAY_NAMES.indexOf(p));
  if (parts.length && days.every((d) => d >= 0)) return { kind: 'weekdays', days: days as Weekday[] };
  return null;
}

export interface CsvIssue {
  /** Line number in the file (the header is line 1). */
  line: number;
  reason: string;
}

export interface CsvImportPlan {
  ok: true;
  mode: 'add' | 'replace';
  /** Data rows read (excluding the header and blank lines). */
  rows: number;
  /** Entries that will be imported. */
  entries: number;
  /** Of those, entries that replace an existing day (add mode). */
  updatedEntries: number;
  /** Habits in the file, and which ones are new. */
  habits: { name: string; isNew: boolean }[];
  /** Rows that can't be imported, and why. */
  issues: CsvIssue[];
  /** The data after the import. */
  result: AppData;
}

export type CsvImportResult = CsvImportPlan | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: EntryStatus[] = ['done', 'skipped', 'missed'];

interface HabitSpec {
  name: string;
  icon: string;
  target: number;
  unit: string;
  frequency: Frequency;
  archived: boolean;
  firstDate: string;
}

/** Works out the result of importing `text` into `current`, without changing anything. */
export function planCsvImport(
  text: string,
  current: AppData,
  mode: 'add' | 'replace',
  opts: { newId: () => string },
): CsvImportResult {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return {
      ok: false,
      error: `This isn’t a Habits CSV export: it’s missing the column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. Nothing was changed.`,
    };
  }
  const col = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof CSV_COLUMNS)[number], number>;

  const issues: CsvIssue[] = [];
  const specs = new Map<string, HabitSpec>();
  const rows: { key: string; date: string; status: EntryStatus; value: number; note?: string }[] = [];
  let dataRows = 0;

  // Physical line numbers, counting line breaks inside quoted fields.
  let line = 1 + (table[0]?.join(',').split('\n').length ?? 1) - 1;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const startLine = line + 1;
    line += cells.join(',').split('\n').length;
    if (cells.every((c) => c.trim() === '')) continue;
    dataRows++;
    const get = (k: (typeof CSV_COLUMNS)[number]) => (cells[col[k]] ?? '').trim();
    const problem = (reason: string) => issues.push({ line: startLine, reason });

    const date = get('date');
    const name = get('habit');
    const status = get('status') as EntryStatus;
    const value = Number(get('value'));
    const target = Number(get('target'));
    const unit = get('unit');
    const frequency = parseFrequency(get('frequency'));
    const archived = get('archived').toLowerCase();
    const note = cells[col.note] ?? '';

    if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) { problem(`invalid date “${date}”`); continue; }
    if (!name) { problem('habit name is empty'); continue; }
    if (name === '(deleted)') { problem('the habit had been deleted when this file was exported'); continue; }
    if (!STATUSES.includes(status)) { problem(`unknown status “${get('status')}” (expected done, skipped or missed)`); continue; }
    if (get('value') === '' || !Number.isFinite(value) || value < 0) { problem(`invalid value “${get('value')}”`); continue; }
    if (!Number.isFinite(target) || target <= 0) { problem(`invalid target “${get('target')}”`); continue; }
    if (!frequency) { problem(`unknown frequency “${get('frequency')}”`); continue; }
    if (archived !== '' && archived !== 'yes' && archived !== 'no') { problem(`archived must be yes or no, not “${get('archived')}”`); continue; }

    const key = name.toLowerCase();
    const spec = specs.get(key);
    if (!spec) {
      specs.set(key, { name, icon: get('icon') || '✅', target, unit, frequency, archived: archived === 'yes', firstDate: date });
    } else if (date < spec.firstDate) spec.firstDate = date;
    rows.push({ key, date, status, value, ...(note ? { note } : {}) });
  }

  // Habits: keep existing ones (add mode), create the rest.
  const habits: Habit[] = mode === 'add' ? current.habits.map((h) => ({ ...h })) : [];
  const idByKey = new Map<string, string>();
  const habitList: { name: string; isNew: boolean }[] = [];
  let newCount = 0;
  for (const [key, spec] of specs) {
    const existing = habits.find((h) => h.name.trim().toLowerCase() === key);
    if (existing) {
      idByKey.set(key, existing.id);
      habitList.push({ name: existing.name, isNew: false });
      continue;
    }
    const measurable = spec.unit !== '' || spec.target !== 1;
    const habit: Habit = {
      id: opts.newId(),
      name: spec.name,
      icon: spec.icon,
      color: HABIT_COLORS[newCount++ % HABIT_COLORS.length],
      frequency: spec.frequency,
      type: measurable ? 'measurable' : 'boolean',
      target: spec.target,
      unit: spec.unit,
      reminderTime: null,
      createdAt: new Date(`${spec.firstDate}T12:00:00`).toISOString(),
      archived: spec.archived,
    };
    habits.push(habit);
    idByKey.set(key, habit.id);
    habitList.push({ name: spec.name, isNew: true });
  }

  // Entries: the file's rows win over existing ones for the same habit and day.
  const flat: Record<string, Entry> = mode === 'add' ? { ...serialize(current).entries } : {};
  let updated = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const habitId = idByKey.get(row.key)!;
    const k = entryKey(habitId, row.date);
    if (mode === 'add' && flat[k] && !seen.has(k)) updated++;
    seen.add(k);
    flat[k] = { habitId, date: row.date, value: row.value, status: row.status, ...(row.note ? { note: row.note } : {}) };
  }

  try {
    // Final check with the same strict validation used everywhere else.
    const result = parseAppData(JSON.stringify({ version: 1, habits, entries: flat, settings: current.settings }), 'import');
    return {
      ok: true,
      mode,
      rows: dataRows,
      entries: seen.size,
      updatedEntries: updated,
      habits: habitList,
      issues,
      result,
    };
  } catch (err) {
    return { ok: false, error: `The file couldn’t be imported (${describeError(err)}). Nothing was changed.` };
  }
}
