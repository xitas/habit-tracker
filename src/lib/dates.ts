// All dates in the app are local calendar days stored as "YYYY-MM-DD" strings.
// Avoid `new Date("YYYY-MM-DD")`, which parses as UTC and shifts the day.

import type { Weekday } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

export function weekdayOf(key: string): Weekday {
  return fromKey(key).getDay() as Weekday;
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);
}

export function startOfWeek(key: string, weekStartsOn: 0 | 1): string {
  const offset = (weekdayOf(key) - weekStartsOn + 7) % 7;
  return addDays(key, -offset);
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  forEachDay(from, to, (key) => out.push(key));
  return out;
}

/**
 * Calls `fn` for each day from `from` to `to` (inclusive) with its weekday.
 * Same calendar arithmetic as addDays (new Date(y, m, d + i)), but it parses the
 * start only once instead of once per day, which matters in long streak loops.
 */
export function forEachDay(from: string, to: string, fn: (key: string, weekday: Weekday) => void): void {
  const [y, m, d] = from.split('-').map(Number);
  for (let i = 0; ; i++) {
    const date = new Date(y, m - 1, d + i);
    const key = toKey(date);
    if (key > to) return;
    fn(key, date.getDay() as Weekday);
  }
}

/** Weekdays in display order for the chosen week start. */
export function orderedWeekdays(weekStartsOn: 0 | 1): Weekday[] {
  return Array.from({ length: 7 }, (_, i) => ((i + weekStartsOn) % 7) as Weekday);
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatLong(key: string): string {
  const d = fromKey(key);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${suffix}`;
}

export function parseTime(hhmm: string): { hour: number; minute: number } {
  const [hour, minute] = hhmm.split(':').map(Number);
  return { hour, minute };
}

export function makeTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}
