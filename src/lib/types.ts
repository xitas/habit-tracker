/** 0 = Sunday … 6 = Saturday (same as Date#getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Frequency =
  | { kind: 'daily' }
  | { kind: 'weekdays'; days: Weekday[] }
  | { kind: 'timesPerWeek'; count: number };

export type HabitType = 'boolean' | 'measurable';

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: Frequency;
  type: HabitType;
  /** Target per day for measurable habits; 1 for yes/no habits. */
  target: number;
  unit: string;
  /** "HH:MM" in 24h local time, or null for no reminder. */
  reminderTime: string | null;
  createdAt: string;
  archived: boolean;
}

export type EntryStatus = 'done' | 'skipped' | 'missed';

export interface Entry {
  habitId: string;
  /** Local calendar day, "YYYY-MM-DD". */
  date: string;
  value: number;
  status: EntryStatus;
  note?: string;
}

export interface Settings {
  weekStartsOn: 0 | 1;
  remindersEnabled: boolean;
  /** "HH:MM" for the evening nudge about incomplete habits. */
  nudgeTime: string;
  /** Color theme; 'system' follows the phone's setting. */
  theme: 'system' | 'light' | 'dark';
}

/** One habit's entries, keyed by date. Treated as immutable: a change replaces the object. */
export type HabitLog = Readonly<Record<string, Entry>>;

/** All entries, grouped by habit id. Only the changed habit's log is replaced on a write. */
export type EntriesByHabit = Readonly<Record<string, HabitLog>>;

/** In-memory app data. */
export interface AppData {
  version: 1;
  habits: Habit[];
  entries: EntriesByHabit;
  settings: Settings;
}

/** Saved/exported shape (old AsyncStorage data, backups, web storage): entries keyed by entryKey(). */
export interface SerializedData {
  version: 1;
  habits: Habit[];
  entries: Record<string, Entry>;
  settings: Settings;
}

export const entryKey = (habitId: string, date: string) => `${habitId}|${date}`;

/** Shared empty log, so habits without entries still have a stable cache key. */
export const EMPTY_LOG: HabitLog = Object.freeze({});

export const logOf = (entries: EntriesByHabit, habitId: string): HabitLog => entries[habitId] ?? EMPTY_LOG;

export function nestEntries(list: Iterable<Entry>): EntriesByHabit {
  const out: Record<string, Record<string, Entry>> = {};
  for (const e of list) (out[e.habitId] ??= {})[e.date] = e;
  return out;
}

export function allEntries(entries: EntriesByHabit): Entry[] {
  const out: Entry[] = [];
  for (const id in entries) for (const date in entries[id]) out.push(entries[id][date]);
  return out;
}

export function serialize(data: AppData): SerializedData {
  const flat: Record<string, Entry> = {};
  for (const e of allEntries(data.entries)) flat[entryKey(e.habitId, e.date)] = e;
  return { version: 1, habits: data.habits, entries: flat, settings: data.settings };
}
