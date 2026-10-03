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

export interface AppData {
  version: 1;
  habits: Habit[];
  /** Keyed by entryKey(habitId, date). */
  entries: Record<string, Entry>;
  settings: Settings;
}

export const entryKey = (habitId: string, date: string) => `${habitId}|${date}`;
