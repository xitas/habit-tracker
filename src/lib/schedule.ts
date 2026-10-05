// Frequency-aware scheduling, streaks and completion stats.
//
// Rules:
// - "skipped" is excused: it never breaks a streak and is left out of rates.
// - Only scheduled days count. A Mon/Wed/Fri habit ignores Tue/Thu/Sat/Sun.
// - Today is "in progress": not finishing it yet never breaks a streak.
// - "X times per week" habits are judged per week, so their streaks are in weeks.
//
// Performance: every function works on one habit's own log (its entries by
// date), never on all entries. Results are cached per (log, habit) pair. Logs
// and habits are immutable, so a change to one habit creates new objects for
// that habit only: its cache misses, and every other habit's cache stays valid.
// The math is unchanged; testing/scheduleReference.ts is the original, and the
// tests check both return identical results.

import { addDays, forEachDay, startOfWeek, toKey, weekdayOf } from './dates';
import { type EntriesByHabit, type Entry, type Habit, type HabitLog, logOf } from './types';

type WeekStart = 0 | 1;

// ---- Per-habit cache ----

const caches = new WeakMap<HabitLog, WeakMap<Habit, Map<string, unknown>>>();

function cached<T>(habit: Habit, log: HabitLog, key: string, compute: () => T): T {
  let byHabit = caches.get(log);
  if (!byHabit) caches.set(log, (byHabit = new WeakMap()));
  let results = byHabit.get(habit);
  if (!results) byHabit.set(habit, (results = new Map()));
  if (results.has(key)) return results.get(key) as T;
  const value = compute();
  results.set(key, value);
  return value;
}

export function getEntry(entries: EntriesByHabit, habitId: string, date: string): Entry | undefined {
  return entries[habitId]?.[date];
}

export const isDone = (e?: Entry) => e?.status === 'done';
export const isSkipped = (e?: Entry) => e?.status === 'skipped';

/** First day the habit is tracked: its creation day, or an earlier backfilled entry. */
export function habitStart(habit: Habit, log: HabitLog): string {
  return cached(habit, log, 'start', () => {
    let start = toKey(new Date(habit.createdAt));
    for (const date in log) if (date < start) start = date;
    return start;
  });
}

/** Whether the habit falls on this weekday at all (times-per-week habits can be done any day). */
export function isScheduledOn(habit: Habit, date: string): boolean {
  return scheduledOnWeekday(habit, weekdayOf(date));
}

function scheduledOnWeekday(habit: Habit, weekday: number): boolean {
  const f = habit.frequency;
  return f.kind !== 'weekdays' || f.days.includes(weekday as never);
}

interface WeekTally {
  done: number;
  skipped: number;
}

function tallyWeek(log: HabitLog, date: string, weekStartsOn: WeekStart, exclude?: string): WeekTally {
  const start = startOfWeek(date, weekStartsOn);
  const t: WeekTally = { done: 0, skipped: 0 };
  forEachDay(start, addDays(start, 6), (day) => {
    if (day === exclude) return;
    const e = log[day];
    if (isDone(e)) t.done++;
    else if (isSkipped(e)) t.skipped++;
  });
  return t;
}

/** Remaining completions needed this week for a times-per-week habit. */
export function weeklyRemaining(habit: Habit, log: HabitLog, date: string, weekStartsOn: WeekStart): number {
  const f = habit.frequency;
  if (f.kind !== 'timesPerWeek') return 0;
  return cached(habit, log, `remaining|${date}|${weekStartsOn}`, () => {
    const t = tallyWeek(log, date, weekStartsOn);
    return Math.max(0, f.count - t.skipped - t.done);
  });
}

/**
 * Whether the habit should appear as a to-do on this day.
 * Times-per-week habits are due until the weekly quota is met by other days.
 */
export function isDueOn(habit: Habit, log: HabitLog, date: string, weekStartsOn: WeekStart): boolean {
  return cached(habit, log, `due|${date}|${weekStartsOn}`, () => {
    if (date < habitStart(habit, log)) return false;
    const f = habit.frequency;
    if (f.kind !== 'timesPerWeek') return isScheduledOn(habit, date);
    if (log[date]) return true;
    const t = tallyWeek(log, date, weekStartsOn, date);
    return t.done + t.skipped < f.count;
  });
}

export interface Streaks {
  current: number;
  best: number;
  unit: 'day' | 'week';
}

export function computeStreaks(habit: Habit, log: HabitLog, today: string, weekStartsOn: WeekStart): Streaks {
  return cached(habit, log, `streaks|${today}|${weekStartsOn}`, () => {
    const start = habitStart(habit, log);
    if (habit.frequency.kind === 'timesPerWeek') {
      return weeklyStreaks(log, start, today, weekStartsOn, habit.frequency.count);
    }
    let run = 0;
    let best = 0;
    forEachDay(start, today, (day, weekday) => {
      if (!scheduledOnWeekday(habit, weekday)) return;
      const e = log[day];
      if (isDone(e)) run++;
      else if (isSkipped(e) || day === today) return;
      else run = 0;
      best = Math.max(best, run);
    });
    return { current: run, best, unit: 'day' };
  });
}

function weeklyStreaks(log: HabitLog, start: string, today: string, weekStartsOn: WeekStart, count: number): Streaks {
  const firstWeek = startOfWeek(start, weekStartsOn);
  const thisWeek = startOfWeek(today, weekStartsOn);
  let run = 0;
  let best = 0;
  for (let week = firstWeek; week <= thisWeek; week = addDays(week, 7)) {
    const t = tallyWeek(log, week, weekStartsOn);
    const required = Math.max(0, count - t.skipped);
    const met = required === 0 ? t.done > 0 : t.done >= required;
    // Fully excused weeks, the week still in progress, and the partial first week are neutral.
    const neutral = (required === 0 && t.done === 0) || week === thisWeek || (week === firstWeek && week < start);
    if (met) run++;
    else if (!neutral) run = 0;
    best = Math.max(best, run);
  }
  return { current: run, best, unit: 'week' };
}

export interface Tally {
  done: number;
  expected: number;
}

/** Completions vs. expected completions for one habit over [from, to]. */
export function habitTally(
  habit: Habit,
  log: HabitLog,
  from: string,
  to: string,
  today: string,
  weekStartsOn: WeekStart,
): Tally {
  return cached(habit, log, `tally|${from}|${to}|${today}|${weekStartsOn}`, () => {
    const start = habitStart(habit, log);
    const lo = from > start ? from : start;
    const hi = to < today ? to : today;
    const out: Tally = { done: 0, expected: 0 };
    if (lo > hi) return out;

    const f = habit.frequency;
    if (f.kind !== 'timesPerWeek') {
      forEachDay(lo, hi, (day, weekday) => {
        if (!scheduledOnWeekday(habit, weekday)) return;
        const e = log[day];
        if (isSkipped(e)) return;
        if (isDone(e)) {
          out.done++;
          out.expected++;
        } else if (day !== today) {
          out.expected++;
        }
      });
      return out;
    }

    // Per week: expect a prorated share of the quota for the days covered.
    for (let week = startOfWeek(lo, weekStartsOn); week <= hi; week = addDays(week, 7)) {
      let covered = 0;
      let done = 0;
      let skipped = 0;
      for (let i = 0; i < 7; i++) {
        const day = addDays(week, i);
        if (day < lo || day > hi) continue;
        const e = log[day];
        if (isDone(e)) done++;
        else if (isSkipped(e)) skipped++;
        if (day !== today || isDone(e)) covered++;
      }
      const expected = Math.max(0, (f.count * covered) / 7 - skipped);
      out.expected += Math.max(expected, Math.min(done, f.count));
      out.done += Math.min(done, f.count);
    }
    return out;
  });
}

export function rate(t: Tally): number | null {
  return t.expected > 0 ? Math.min(1, t.done / t.expected) : null;
}

/** One habit's contribution to a day's totals: 1 if due (and not skipped), 1 if done. */
function dayContribution(habit: Habit, log: HabitLog, date: string, weekStartsOn: WeekStart): Tally {
  return cached(habit, log, `day|${date}|${weekStartsOn}`, () => {
    if (!isDueOn(habit, log, date, weekStartsOn)) return { done: 0, expected: 0 };
    const e = log[date];
    if (isSkipped(e)) return { done: 0, expected: 0 };
    return { done: isDone(e) ? 1 : 0, expected: 1 };
  });
}

/** For one day across habits: how many were due and how many got done. Skips are excluded. */
export function dayTally(habits: Habit[], entries: EntriesByHabit, date: string, weekStartsOn: WeekStart): Tally {
  const out: Tally = { done: 0, expected: 0 };
  for (const h of habits) {
    const c = dayContribution(h, logOf(entries, h.id), date, weekStartsOn);
    out.done += c.done;
    out.expected += c.expected;
  }
  return out;
}

export type DayState = 'done' | 'partial' | 'skipped' | 'missed' | 'open' | 'off' | 'future';

/** Visual state of one habit on one day, for calendars and history. */
export function dayState(habit: Habit, log: HabitLog, date: string, today: string, start: string): DayState {
  if (date > today) return 'future';
  const e = log[date];
  if (isDone(e)) return 'done';
  if (isSkipped(e)) return 'skipped';
  if (e && e.value > 0) return 'partial';
  if (date < start || !isScheduledOn(habit, date)) return 'off';
  if (date === today || habit.frequency.kind === 'timesPerWeek') return 'open';
  return 'missed';
}

export function frequencyLabel(habit: Habit): string {
  const f = habit.frequency;
  if (f.kind === 'daily') return 'Every day';
  if (f.kind === 'timesPerWeek') return `${f.count}× per week`;
  if (f.days.length === 7) return 'Every day';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sorted = order.filter((d) => f.days.includes(d as never));
  if (sorted.join() === '1,2,3,4,5') return 'Weekdays';
  if (sorted.join() === '6,0') return 'Weekends';
  return sorted.map((d) => names[d]).join(', ');
}
