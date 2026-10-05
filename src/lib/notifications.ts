// Reminders on the phone: connects the reminder engine (reminders/engine.ts) to
// expo-notifications, the app's data, permission prompts and notification taps.

import { isRunningInExpoGo } from 'expo';
import { router } from 'expo-router';
import type * as NotificationsModule from 'expo-notifications';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { createReminderEngine, type NotificationApi, type PermissionStatus, type ReminderEngine } from './reminders/engine';
import { routeForNotification } from './reminders/plan';
import { getState, useStore } from './store';
import { useToday } from './useToday';

const CHANNEL_ID = 'reminders';
// Expo Go on Android (SDK 53+) throws as soon as expo-notifications is imported,
// so reminders there need a development build.
const expoGoAndroid = Platform.OS === 'android' && isRunningInExpoGo();
const supported = (Platform.OS === 'ios' || Platform.OS === 'android') && !expoGoAndroid;

// Loaded lazily so unsupported environments never evaluate the module.
// Every use below is behind a `supported` check.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications: typeof NotificationsModule = supported ? require('expo-notifications') : null!;

export const notificationsSupported = supported;

/** Why reminders can't run here, or null when they can. */
export const notificationsUnavailableReason = supported
  ? null
  : expoGoAndroid
    ? 'Reminders don’t work in Expo Go on Android. Use a development build (npx expo run:android) to get them.'
    : 'Notifications are only available in the phone app.';

// ---- expo-notifications adapter ----

function toStatus(p: NotificationsModule.NotificationPermissionsStatus): PermissionStatus {
  if (Platform.OS === 'ios' && p.ios) {
    // iOS: rely on ios.status. Provisional and ephemeral authorizations deliver notifications too.
    const s = p.ios.status;
    const S = Notifications.IosAuthorizationStatus;
    if (s === S.AUTHORIZED || s === S.PROVISIONAL || s === S.EPHEMERAL) return 'granted';
    return s === S.DENIED ? 'denied' : 'undetermined';
  }
  if (p.granted) return 'granted';
  return p.status === 'denied' ? 'denied' : 'undetermined';
}

const expoApi: NotificationApi = {
  async getPermission() {
    return toStatus(await Notifications.getPermissionsAsync());
  },
  async requestPermission() {
    return toStatus(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
  },
  async getScheduled() {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.map((r) => {
      const fp = (r.content.data as { fp?: unknown } | null)?.fp;
      return { id: r.identifier, fingerprint: typeof fp === 'string' ? fp : null };
    });
  },
  async schedule(item) {
    await Notifications.scheduleNotificationAsync({
      identifier: item.id,
      content: { title: item.title, body: item.body, data: { ...item.data, fp: item.fingerprint } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.at,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
  },
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
};

let engine: ReminderEngine | null = null;
function getEngine(): ReminderEngine | null {
  if (!supported) return null;
  if (!engine) {
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
    engine = createReminderEngine({ api: expoApi, getData: getState });
  }
  return engine;
}

// ---- Permission explanation (shown before the system prompt) ----

type ExplainerState = { visible: boolean; resolve: ((ok: boolean) => void) | null };
let explainer: ExplainerState = { visible: false, resolve: null };
const explainerListeners = new Set<() => void>();
const setExplainer = (next: ExplainerState) => {
  explainer = next;
  explainerListeners.forEach((l) => l());
};
const subscribeExplainer = (l: () => void) => {
  explainerListeners.add(l);
  return () => {
    explainerListeners.delete(l);
  };
};

/** State for the explanation sheet, and the function its buttons call. */
export function useReminderExplainer() {
  const state = useSyncExternalStore(subscribeExplainer, () => explainer, () => explainer);
  return {
    visible: state.visible,
    answer(ok: boolean) {
      state.resolve?.(ok);
      setExplainer({ visible: false, resolve: null });
    },
  };
}

/**
 * Turns reminders on: explains why, then shows the system prompt. Does nothing if
 * permission is already granted, was denied (never re-asks), or the user chose
 * "Not now" earlier in this session.
 */
export async function askForReminders(): Promise<PermissionStatus | 'unavailable'> {
  const e = getEngine();
  if (!e) return 'unavailable';
  return e.askWithExplanation(() => new Promise<boolean>((resolve) => setExplainer({ visible: true, resolve })));
}

const subscribeEngine = (l: () => void) => getEngine()?.subscribe(l) ?? (() => {});

/** Notification permission: 'granted' | 'denied' | 'undetermined', or null before the first check / when unsupported. */
export function useReminderPermission(): PermissionStatus | null {
  return useSyncExternalStore(
    subscribeEngine,
    () => getEngine()?.getStatus().permission ?? null,
    () => null,
  );
}

/** Opens this app's page in the phone's Settings, where notifications can be turned on. */
export function openAppSettings() {
  Linking.openSettings().catch(() => {});
}

// ---- Keeping the schedule in sync ----

/**
 * Keeps scheduled reminders equal to the plan: on launch, whenever habits,
 * entries or settings change, at midnight, and when the app comes back to the
 * foreground (also re-checking permission then).
 */
export function useReminderSync(enabled: boolean) {
  const habits = useStore((s) => s.habits);
  const entries = useStore((s) => s.entries);
  const settings = useStore((s) => s.settings);
  const today = useToday(); // changes at midnight

  // Launch and foreground: re-check permission (it may have been changed in Settings) and refresh.
  useEffect(() => {
    const e = getEngine();
    if (!e || !enabled) return;
    void e.refreshPermission().then(() => e.requestSync());
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void e.refreshPermission().then(() => e.requestSync());
    });
    return () => sub.remove();
  }, [enabled]);

  // Every change and midnight: cancel reminders that are no longer needed right away
  // (e.g. the habit was just completed), then reconcile the rest.
  useEffect(() => {
    const e = getEngine();
    if (!e || !enabled) return;
    const timer = setTimeout(() => void e.cancelNoLongerNeeded(), 150);
    return () => clearTimeout(timer);
  }, [enabled, habits, entries, settings, today]);
}

// ---- Notification taps ----

const handledResponses = new Set<string>();

/**
 * Opens the right screen when a notification is tapped: the habit's detail for a
 * habit reminder, Today for the evening nudge. Covers taps that launch the app
 * from closed, bring it back from the background, or arrive while it's open.
 * Call once the app is ready (data loaded, navigator mounted).
 */
export function useNotificationTaps(ready: boolean) {
  useEffect(() => {
    if (!supported || !ready) return;
    getEngine();
    const handle = (response: NotificationsModule.NotificationResponse) => {
      const key = `${response.notification.request.identifier}|${response.notification.date}|${response.actionIdentifier}`;
      if (handledResponses.has(key)) return; // the launch tap can be reported twice
      handledResponses.add(key);
      router.navigate(routeForNotification(response.notification.request.content.data, getState().habits) as never);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    let active = true;
    // A tap that launched the app from closed.
    Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (active && r) handle(r);
      })
      .catch(() => {});
    // Taps while running (foreground or background).
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => {
      active = false;
      sub.remove();
    };
  }, [ready]);
}
