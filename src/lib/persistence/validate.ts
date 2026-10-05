// Strict validation for data read from storage. Anything that doesn't match
// the model throws a DataError, so a damaged record stops the load (and shows
// the recovery screen) instead of being silently dropped or overwritten.

import { allEntries, type AppData, type Entry, type EntryStatus, type Frequency, type Habit, type Settings, type Weekday } from '../types';

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

export const DEFAULT_SETTINGS: Settings = {
  weekStartsOn: 1,
  remindersEnabled: true,
  nudgeTime: '20:00',
  theme: 'system',
  lastBackupAt: null,
};

export const emptyData = (): AppData => ({
  version: 1,
  habits: [],
  entries: {},
  settings: { ...DEFAULT_SETTINGS },
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const STATUSES: EntryStatus[] = ['done', 'skipped', 'missed'];

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function fail(where: string, problem: string): never {
  throw new DataError(`${where}: ${problem}`);
}

function validateFrequency(x: unknown, where: string): Frequency {
  if (!isObject(x)) fail(where, 'frequency is missing');
  if (x.kind === 'daily') return { kind: 'daily' };
  if (x.kind === 'weekdays') {
    const days = x.days;
    if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      fail(where, 'weekday list is invalid');
    }
    return { kind: 'weekdays', days: days as Weekday[] };
  }
  if (x.kind === 'timesPerWeek') {
    if (!Number.isInteger(x.count) || (x.count as number) < 1 || (x.count as number) > 7) fail(where, 'times per week is invalid');
    return { kind: 'timesPerWeek', count: x.count as number };
  }
  return fail(where, `unknown frequency "${String(x.kind)}"`);
}

export function validateHabit(x: unknown, where = 'habit'): Habit {
  if (!isObject(x)) fail(where, 'not an object');
  const str = (k: string) => {
    if (typeof x[k] !== 'string') fail(where, `${k} is missing`);
    return x[k] as string;
  };
  const id = str('id');
  if (!id) fail(where, 'id is empty');
  const type = x.type;
  if (type !== 'boolean' && type !== 'measurable') fail(where, 'type is invalid');
  if (!isFiniteNumber(x.target) || x.target <= 0) fail(where, 'target is invalid');
  const reminder = x.reminderTime;
  if (reminder !== null && !(typeof reminder === 'string' && TIME.test(reminder))) fail(where, 'reminder time is invalid');
  const createdAt = str('createdAt');
  if (Number.isNaN(Date.parse(createdAt))) fail(where, 'creation date is invalid');
  if (typeof x.archived !== 'boolean') fail(where, 'archived flag is invalid');
  return {
    id,
    name: str('name'),
    icon: str('icon'),
    color: str('color'),
    frequency: validateFrequency(x.frequency, where),
    type,
    target: x.target,
    unit: str('unit'),
    reminderTime: reminder as string | null,
    createdAt,
    archived: x.archived,
  };
}

export function validateEntry(x: unknown, where = 'entry'): Entry {
  if (!isObject(x)) fail(where, 'not an object');
  if (typeof x.habitId !== 'string' || !x.habitId) fail(where, 'habit id is missing');
  if (typeof x.date !== 'string' || !DATE.test(x.date)) fail(where, 'date is invalid');
  if (!isFiniteNumber(x.value) || x.value < 0) fail(where, 'value is invalid');
  if (!STATUSES.includes(x.status as EntryStatus)) fail(where, 'status is invalid');
  if (x.note !== undefined && x.note !== null && typeof x.note !== 'string') fail(where, 'note is invalid');
  return {
    habitId: x.habitId,
    date: x.date,
    value: x.value,
    status: x.status as EntryStatus,
    ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}),
  };
}

/** Settings aren't precious: unknown or invalid values fall back to defaults. */
export function normalizeSettings(x: unknown): Settings {
  const s = isObject(x) ? x : {};
  return {
    weekStartsOn: s.weekStartsOn === 0 || s.weekStartsOn === 1 ? s.weekStartsOn : DEFAULT_SETTINGS.weekStartsOn,
    remindersEnabled: typeof s.remindersEnabled === 'boolean' ? s.remindersEnabled : DEFAULT_SETTINGS.remindersEnabled,
    nudgeTime: typeof s.nudgeTime === 'string' && TIME.test(s.nudgeTime) ? s.nudgeTime : DEFAULT_SETTINGS.nudgeTime,
    theme: s.theme === 'light' || s.theme === 'dark' || s.theme === 'system' ? s.theme : DEFAULT_SETTINGS.theme,
    lastBackupAt:
      typeof s.lastBackupAt === 'string' && !Number.isNaN(Date.parse(s.lastBackupAt)) ? s.lastBackupAt : DEFAULT_SETTINGS.lastBackupAt,
  };
}

/** Builds validated AppData from habit and entry lists. Throws on duplicates or bad records. */
export function assembleData(habits: unknown[], entries: unknown[], settings: unknown, source: string): AppData {
  const seen = new Set<string>();
  const validHabits = habits.map((h, i) => {
    const habit = validateHabit(h, `${source} habit #${i + 1}`);
    if (seen.has(habit.id)) fail(`${source} habit #${i + 1}`, `duplicate id "${habit.id}"`);
    seen.add(habit.id);
    return habit;
  });
  // Grouped by habit, then by date (see EntriesByHabit). A repeated habit/date keeps the last one, as before.
  const byHabit: Record<string, Record<string, Entry>> = {};
  entries.forEach((e, i) => {
    const entry = validateEntry(e, `${source} entry #${i + 1}`);
    (byHabit[entry.habitId] ??= {})[entry.date] = entry;
  });
  return { version: 1, habits: validHabits, entries: byHabit, settings: normalizeSettings(settings) };
}

/** Parses a SerializedData document (the old AsyncStorage format, also used by backups and web storage). */
export function parseAppData(raw: string, source: string): AppData {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new DataError(`${source}: the saved data is not valid JSON (${raw.length.toLocaleString()} characters)`);
  }
  if (!isObject(doc)) fail(source, 'the saved data is not an object');
  if (!Array.isArray(doc.habits)) fail(source, 'the habit list is missing');
  if (!isObject(doc.entries)) fail(source, 'the entry list is missing');
  return assembleData(doc.habits, Object.values(doc.entries), doc.settings, source);
}

export function countEntries(data: AppData): number {
  let n = 0;
  for (const id in data.entries) n += Object.keys(data.entries[id]).length;
  return n;
}

export { allEntries };

export const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));
