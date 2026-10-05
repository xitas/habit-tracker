// FROZEN REFERENCE: the scheduling code exactly as it was before the performance work
// (commit 5279796), kept only so tests and the benchmark can prove the optimized
// version in schedule.ts returns identical results. Do not edit or import from app code.

// Frequency-aware scheduling, streaks and completion stats.
//
// Rules:
// - "skipped" is excused: it never breaks a streak and is left out of rates.
// - Only scheduled days count. A Mon/Wed/Fri habit ignores Tue/Thu/Sat/Sun.
// - Today is "in progress": not finishing it yet never breaks a streak.
// - "X times per week" habits are judged per week, so their streaks are in weeks.

import { addDays, dayRange, startOfWeek, toKey, weekdayOf } from '../dates';
import { entryKey, type Entry, type Habit } from '../types';

export type FlatEntries = Record<string, Entry>;
type Entries = FlatEntries;
type WeekStart = 0 | 1;

export function getEntry(entries: Entries, habitId: string, date: string): Entry | undefined {
  return entries[entryKey(habitId, date)];
}

export const isDone = (e?: Entry) => e?.status === 'done';
export const isSkipped = (e?: Entry) => e?.status === 'skipped';

/** First day the habit is tracked: its creation day, or an earlier backfilled entry. */
export function habitStart(habit: Habit, entries: Entries): string {
  let start = toKey(new Date(habit.createdAt));
  const prefix = `${habit.id}|`;
  for (const key in entries) {
    if (key.startsWith(prefix) && entries[key].date < start) start = entries[key].date;
  }
  return start;
}

/** Whether the habit falls on this weekday at all (times-per-week habits can be done any day). */
export function isScheduledOn(habit: Habit, date: string): boolean {
  const f = habit.frequency;
  if (f.kind === 'weekdays') return f.days.includes(weekdayOf(date));
  return true;
}

interface WeekTally {
  done: number;
  skipped: number;
}

function tallyWeek(
  habit: Habit,
  entries: Entries,
  date: string,
  weekStartsOn: WeekStart,
  exclude?: string,
): WeekTally {
  const start = startOfWeek(date, weekStartsOn);
  const t: WeekTally = { done: 0, skipped: 0 };
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    if (day === exclude) continue;
    const e = getEntry(entries, habit.id, day);
    if (isDone(e)) t.done++;
    else if (isSkipped(e)) t.skipped++;
  }
  return t;
}

/** Remaining completions needed this week for a times-per-week habit. */
export function weeklyRemaining(habit: Habit, entries: Entries, date: string, weekStartsOn: WeekStart) {
  if (habit.frequency.kind !== 'timesPerWeek') return 0;
  const t = tallyWeek(habit, entries, date, weekStartsOn);
  return Math.max(0, habit.frequency.count - t.skipped - t.done);
}

/**
 * Whether the habit should appear as a to-do on this day.
 * Times-per-week habits are due until the weekly quota is met by other days.
 */
export function isDueOn(
  habit: Habit,
  entries: Entries,
  date: string,
  weekStartsOn: WeekStart,
  start = habitStart(habit, entries),
): boolean {
  if (date < start) return false;
  const f = habit.frequency;
  if (f.kind !== 'timesPerWeek') return isScheduledOn(habit, date);
  if (getEntry(entries, habit.id, date)) return true;
  const t = tallyWeek(habit, entries, date, weekStartsOn, date);
  return t.done + t.skipped < f.count;
}

export interface Streaks {
  current: number;
  best: number;
  unit: 'day' | 'week';
}

export function computeStreaks(
  habit: Habit,
  entries: Entries,
  today: string,
  weekStartsOn: WeekStart,
): Streaks {
  const start = habitStart(habit, entries);
  if (habit.frequency.kind === 'timesPerWeek') {
    return weeklyStreaks(habit, entries, start, today, weekStartsOn, habit.frequency.count);
  }

  let run = 0;
  let best = 0;
  for (const day of dayRange(start, today)) {
    if (!isScheduledOn(habit, day)) continue;
    const e = getEntry(entries, habit.id, day);
    if (isDone(e)) run++;
    else if (isSkipped(e) || day === today) continue;
    else run = 0;
    best = Math.max(best, run);
  }
  return { current: run, best, unit: 'day' };
}

function weeklyStreaks(
  habit: Habit,
  entries: Entries,
  start: string,
  today: string,
  weekStartsOn: WeekStart,
  count: number,
): Streaks {
  const firstWeek = startOfWeek(start, weekStartsOn);
  const thisWeek = startOfWeek(today, weekStartsOn);
  let run = 0;
  let best = 0;
  for (let week = firstWeek; week <= thisWeek; week = addDays(week, 7)) {
    const t = tallyWeek(habit, entries, week, weekStartsOn);
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
  entries: Entries,
  from: string,
  to: string,
  today: string,
  weekStartsOn: WeekStart,
): Tally {
  const start = habitStart(habit, entries);
  const lo = from > start ? from : start;
  const hi = to < today ? to : today;
  const out: Tally = { done: 0, expected: 0 };
  if (lo > hi) return out;

  const f = habit.frequency;
  if (f.kind !== 'timesPerWeek') {
    for (const day of dayRange(lo, hi)) {
      if (!isScheduledOn(habit, day)) continue;
      const e = getEntry(entries, habit.id, day);
      if (isSkipped(e)) continue;
      if (isDone(e)) {
        out.done++;
        out.expected++;
      } else if (day !== today) {
        out.expected++;
      }
    }
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
      const e = getEntry(entries, habit.id, day);
      if (isDone(e)) done++;
      else if (isSkipped(e)) skipped++;
      if (day !== today || isDone(e)) covered++;
    }
    const expected = Math.max(0, (f.count * covered) / 7 - skipped);
    out.expected += Math.max(expected, Math.min(done, f.count));
    out.done += Math.min(done, f.count);
  }
  return out;
}

export function rate(t: Tally): number | null {
  return t.expected > 0 ? Math.min(1, t.done / t.expected) : null;
}

/** For one day across habits: how many were due and how many got done. Skips are excluded. */
export function dayTally(
  habits: Habit[],
  entries: Entries,
  date: string,
  weekStartsOn: WeekStart,
): Tally {
  const out: Tally = { done: 0, expected: 0 };
  for (const h of habits) {
    if (!isDueOn(h, entries, date, weekStartsOn)) continue;
    const e = getEntry(entries, h.id, date);
    if (isSkipped(e)) continue;
    out.expected++;
    if (isDone(e)) out.done++;
  }
  return out;
}

export type DayState = 'done' | 'partial' | 'skipped' | 'missed' | 'open' | 'off' | 'future';

/** Visual state of one habit on one day, for calendars and history. */
export function dayState(
  habit: Habit,
  entries: Entries,
  date: string,
  today: string,
  start: string,
): DayState {
  if (date > today) return 'future';
  const e = getEntry(entries, habit.id, date);
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
