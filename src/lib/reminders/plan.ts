// Which reminders should exist right now. Pure: no React Native, so it can be tested.
//
// Every reminder is a one-off notification for a specific day in the next
// DAYS_AHEAD days. That lets the plan leave out days that are already done or
// skipped, and weeks whose "X times per week" goal is met. The plan is rebuilt
// on app open, on every change and at midnight.

import { addDays, fromKey, parseTime, toKey } from '../dates';
import { dayTally, habitStart, isScheduledOn, weeklyRemaining } from '../schedule';
import { logOf, type AppData, type Habit } from '../types';

/** iOS keeps at most 64 pending local notifications per app; stay safely below it on every platform. */
export const MAX_SCHEDULED = 60;
export const DAYS_AHEAD = 7;

export type ReminderData = { kind: 'habit'; habitId: string; date: string } | { kind: 'nudge'; date: string };

export interface PlannedReminder {
  id: string;
  /** Delivery time, ms since epoch. */
  at: number;
  title: string;
  body: string;
  data: ReminderData;
  /** Changes whenever time or text changes, so an edited reminder is rescheduled. */
  fingerprint: string;
}

export interface ReminderPlan {
  items: PlannedReminder[];
  /** Reminders that didn't fit under MAX_SCHEDULED; they're added on a later refresh. */
  deferred: number;
}

export const habitReminderId = (habitId: string, date: string) => `habit:${habitId}:${date}`;
export const nudgeId = (date: string) => `nudge:${date}`;

function at(date: string, hhmm: string): number {
  const { hour, minute } = parseTime(hhmm);
  const d = fromKey(date);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function make(id: string, time: number, title: string, body: string, data: ReminderData): PlannedReminder {
  return { id, at: time, title, body, data, fingerprint: JSON.stringify([time, title, body]) };
}

/** Whether this habit should remind on this day, given what's already logged. */
export function needsReminder(habit: Habit, data: AppData, date: string): boolean {
  const log = logOf(data.entries, habit.id);
  if (date < habitStart(habit, log)) return false;
  const entry = log[date];
  if (entry?.status === 'done' || entry?.status === 'skipped') return false;
  if (habit.frequency.kind === 'timesPerWeek') {
    // Stop once the week's goal is met (done + excused days); resumes when the next week starts.
    return weeklyRemaining(habit, log, date, data.settings.weekStartsOn) > 0;
  }
  return isScheduledOn(habit, date);
}

export function buildReminderPlan(data: AppData, now: Date, limit = MAX_SCHEDULED, days = DAYS_AHEAD): ReminderPlan {
  if (!data.settings.remindersEnabled) return { items: [], deferred: 0 };
  const nowMs = now.getTime();
  const today = toKey(now);
  const habits = data.habits.filter((h) => !h.archived);
  const all: PlannedReminder[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);

    for (const h of habits) {
      if (!h.reminderTime) continue;
      const time = at(date, h.reminderTime);
      if (time <= nowMs || !needsReminder(h, data, date)) continue;
      const body = h.type === 'measurable' ? `Goal today: ${h.target} ${h.unit}` : 'Time for your habit';
      all.push(make(habitReminderId(h.id, date), time, `${h.icon} ${h.name}`, body, { kind: 'habit', habitId: h.id, date }));
    }

    const nudgeAt = at(date, data.settings.nudgeTime);
    if (nudgeAt > nowMs) {
      const tally = dayTally(habits, data.entries, date, data.settings.weekStartsOn);
      const left = tally.expected - tally.done;
      if (left > 0) {
        // Future days haven't been logged yet, so only today's count is meaningful.
        const body =
          i === 0
            ? `${left} habit${left === 1 ? '' : 's'} still open today. There's still time 🌙`
            : 'Some habits are still open today. There’s still time 🌙';
        all.push(make(nudgeId(date), nudgeAt, 'Evening check-in', body, { kind: 'nudge', date }));
      }
    }
  }

  // Soonest first; anything past the limit waits for a later refresh.
  all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return { items: all.slice(0, limit), deferred: Math.max(0, all.length - limit) };
}

/** Where tapping a notification should take the user. */
export function routeForNotification(data: unknown, habits: Habit[]): string {
  const d = data as Partial<ReminderData> | null | undefined;
  if (d?.kind === 'habit' && typeof d.habitId === 'string' && habits.some((h) => h.id === d.habitId)) {
    return `/habit/${d.habitId}`;
  }
  return '/';
}
