// Local notifications: one reminder per habit at its reminder time, plus a
// gentle evening nudge on days when habits are still open.
//
// Local notifications can't check app state when they fire, so the nudge is
// scheduled per day and rescheduled whenever data changes: finishing all of
// today's habits cancels today's nudge.

import { isRunningInExpoGo } from 'expo';
import type * as NotificationsModule from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { addDays, fromKey, parseTime, todayKey } from './dates';
import { dayTally } from './schedule';
import { getState, useStore } from './store';
import type { AppData } from './types';
import { useToday } from './useToday';

const CHANNEL_ID = 'reminders';
const NUDGE_DAYS = 7;
// Expo Go on Android (SDK 53+) throws as soon as expo-notifications is imported,
// so reminders there need a development build.
const expoGoAndroid = Platform.OS === 'android' && isRunningInExpoGo();
const supported = (Platform.OS === 'ios' || Platform.OS === 'android') && !expoGoAndroid;

// Loaded lazily so unsupported environments never evaluate the module.
// Every use below is behind a `supported` check.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications: typeof NotificationsModule = supported ? require('expo-notifications') : null!;

type Plan = { id: string; title: string; body: string; trigger: NotificationsModule.NotificationTriggerInput };

let configured = false;
function configure() {
  if (configured || !supported) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Habit reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => {});
  }
}

/** Ask for notification permission if we don't have it yet. Returns whether granted. */
export async function ensurePermission(): Promise<boolean> {
  if (!supported) return false;
  configure();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
}

function buildPlan(data: AppData, now: Date): Plan[] {
  if (!data.settings.remindersEnabled) return [];
  const plan: Plan[] = [];
  const habits = data.habits.filter((h) => !h.archived);
  const channel = Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {};

  for (const h of habits) {
    if (!h.reminderTime) continue;
    const { hour, minute } = parseTime(h.reminderTime);
    const content = {
      title: `${h.icon} ${h.name}`,
      body: h.type === 'measurable' ? `Goal today: ${h.target} ${h.unit}` : 'Time for your habit',
    };
    if (h.frequency.kind === 'weekdays') {
      for (const day of h.frequency.days) {
        plan.push({
          id: `habit-${h.id}-${day}`,
          ...content,
          // expo-notifications weekdays are 1 (Sunday) … 7 (Saturday).
          trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: day + 1, hour, minute, ...channel },
        });
      }
    } else {
      plan.push({
        id: `habit-${h.id}`,
        ...content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, ...channel },
      });
    }
  }

  const { hour, minute } = parseTime(data.settings.nudgeTime);
  const today = todayKey();
  for (let i = 0; i < NUDGE_DAYS; i++) {
    const day = addDays(today, i);
    const at = fromKey(day);
    at.setHours(hour, minute, 0, 0);
    if (at <= now) continue;
    const tally = dayTally(habits, data.entries, day, data.settings.weekStartsOn);
    const left = tally.expected - tally.done;
    if (left <= 0) continue;
    // Future days haven't been logged yet, so only today's count is meaningful.
    const body =
      i === 0
        ? `${left} habit${left === 1 ? '' : 's'} still open today. There's still time 🌙`
        : 'Some habits are still open today. There’s still time 🌙';
    plan.push({
      id: `nudge-${day}`,
      title: 'Evening check-in',
      body,
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, ...channel },
    });
  }
  return plan;
}

async function apply(plan: Plan[]) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (plan.length === 0) return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  for (const p of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: { title: p.title, body: p.body },
      trigger: p.trigger,
    });
  }
}

/** Keeps scheduled notifications in sync with habits, settings and today's progress. */
export function useNotificationSync(enabled: boolean) {
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const settings = useStore((s) => s.settings);
  const today = useToday();
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!supported || !enabled) return;
    configure();
    const timer = setTimeout(() => {
      const plan = buildPlan(getState(), new Date());
      const signature = JSON.stringify(plan);
      if (signature === lastSignature.current) return;
      lastSignature.current = signature;
      apply(plan).catch((err) => console.warn('Failed to schedule notifications', err));
    }, 800);
    return () => clearTimeout(timer);
  }, [enabled, habits, entries, settings, today]);
}

export const notificationsSupported = supported;

/** Why reminders can't run here, or null when they can. */
export const notificationsUnavailableReason = supported
  ? null
  : expoGoAndroid
    ? 'Reminders don’t work in Expo Go on Android. Use a development build (npx expo run:android) to get them.'
    : 'Notifications are only available in the phone app.';
