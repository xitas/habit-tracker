// Keeps the phone's scheduled notifications equal to the reminder plan.
// Pure TypeScript with an injected notification API, so it's tested in Node.
//
// Guarantees:
// - One sync at a time. Changes that arrive during a sync trigger exactly one
//   more sync afterwards, with the latest data.
// - A sync is only recorded as done after the scheduled notifications were
//   read back and match the plan exactly (same ids, same times and text).
//   Anything else (a failure, a mismatch, no permission) is retried later.
// - Anything scheduled that isn't in the plan is cancelled: reminders for
//   archived or deleted habits, finished days, and the repeating reminders
//   older app versions used.

import type { AppData } from '../types';
import { buildReminderPlan, type PlannedReminder, type ReminderPlan } from './plan';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface ScheduledRequest {
  id: string;
  /** The fingerprint stored with the notification, or null if it isn't one of ours. */
  fingerprint: string | null;
}

export interface NotificationApi {
  getPermission(): Promise<PermissionStatus>;
  requestPermission(): Promise<PermissionStatus>;
  getScheduled(): Promise<ScheduledRequest[]>;
  schedule(item: PlannedReminder): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface ReminderStatus {
  /** null until the first check. */
  permission: PermissionStatus | null;
  /** The phone's schedule matched the latest plan at this time (ms). */
  syncedAt: number | null;
  /** Why the latest sync didn't finish; it will be retried. */
  error: string | null;
  scheduled: number;
  deferred: number;
}

export interface EngineOptions {
  api: NotificationApi;
  getData: () => AppData;
  now?: () => Date;
  /** Delay before retrying a failed sync. */
  retryDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => () => void;
  log?: (msg: string, err?: unknown) => void;
}

const signature = (plan: ReminderPlan) => plan.items.map((i) => `${i.id}=${i.fingerprint}`).join('\n');

function matches(scheduled: ScheduledRequest[], plan: ReminderPlan): boolean {
  if (scheduled.length !== plan.items.length) return false;
  const want = new Map(plan.items.map((i) => [i.id, i.fingerprint]));
  return scheduled.every((s) => want.get(s.id) === s.fingerprint);
}

export function createReminderEngine(options: EngineOptions) {
  const { api, getData } = options;
  const now = options.now ?? (() => new Date());
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  const log = options.log ?? ((msg: string, err?: unknown) => console.warn(msg, err));

  let status: ReminderStatus = { permission: null, syncedAt: null, error: null, scheduled: 0, deferred: 0 };
  const listeners = new Set<() => void>();
  const setStatus = (patch: Partial<ReminderStatus>) => {
    status = { ...status, ...patch };
    listeners.forEach((l) => l());
  };

  /** Signature of the plan the phone's schedule was last verified against. */
  let applied: string | null = null;
  /** Ids in that verified plan (for immediate cancels). */
  let appliedIds = new Set<string>();
  let running: Promise<void> | null = null;
  let dirty = false;
  let cancelRetry: (() => void) | null = null;
  const stats = { runs: 0, active: 0, maxConcurrent: 0 };
  /** The in-app explanation was declined this session: don't show it again until next launch. */
  let explanationDeclined = false;

  async function refreshPermission(): Promise<PermissionStatus> {
    const before = status.permission;
    const p = await api.getPermission();
    setStatus({ permission: p });
    // Granted while the app was in the background (e.g. in phone Settings): schedule right away.
    if (p === 'granted' && before !== 'granted') void requestSync();
    return p;
  }

  async function syncOnce() {
    stats.runs++;
    stats.active++;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.active);
    try {
      const permission = await api.getPermission();
      setStatus({ permission });
      if (permission !== 'granted') {
        // Not done: it runs again when permission is granted.
        applied = null;
        return;
      }
      const plan = buildReminderPlan(getData(), now());
      const sig = signature(plan);
      const current = await api.getScheduled();
      if (sig === applied && matches(current, plan)) return;

      // Reconcile: cancel what shouldn't be there (or changed), schedule what's missing.
      const want = new Map(plan.items.map((i) => [i.id, i]));
      const have = new Map(current.map((s) => [s.id, s.fingerprint]));
      for (const s of current) {
        if (want.get(s.id)?.fingerprint !== s.fingerprint) await api.cancel(s.id);
      }
      for (const item of plan.items) {
        if (have.get(item.id) !== item.fingerprint) await api.schedule(item);
      }

      // Verify before recording success.
      const after = await api.getScheduled();
      if (!matches(after, plan)) {
        throw new Error(`Scheduled notifications don't match the plan (${after.length} scheduled, ${plan.items.length} planned)`);
      }
      applied = sig;
      appliedIds = new Set(plan.items.map((i) => i.id));
      cancelRetry?.();
      cancelRetry = null;
      setStatus({ syncedAt: now().getTime(), error: null, scheduled: plan.items.length, deferred: plan.deferred });
    } catch (err) {
      applied = null;
      log('Reminder sync failed; will retry', err);
      setStatus({ error: err instanceof Error ? err.message : String(err) });
      cancelRetry?.();
      cancelRetry = setTimer(() => void requestSync(), retryDelayMs);
    } finally {
      stats.active--;
    }
  }

  /** Brings the schedule up to date. Calls during a sync coalesce into one more run. */
  function requestSync(): Promise<void> {
    dirty = true;
    if (!running) {
      running = (async () => {
        while (dirty) {
          dirty = false;
          await syncOnce();
        }
      })().finally(() => {
        running = null;
      });
    }
    return running;
  }

  /**
   * Immediately cancels reminders that were scheduled but are no longer planned
   * (e.g. the habit was just completed or skipped, or the weekly goal was just met),
   * then queues a full sync. Safe to call on every change.
   */
  async function cancelNoLongerNeeded(): Promise<void> {
    if (appliedIds.size === 0) return void requestSync();
    const plan = buildReminderPlan(getData(), now());
    const keep = new Set(plan.items.map((i) => i.id));
    const gone = [...appliedIds].filter((id) => !keep.has(id));
    for (const id of gone) {
      try {
        await api.cancel(id);
        appliedIds.delete(id);
      } catch (err) {
        log('Immediate cancel failed; the full sync will retry', err);
      }
    }
    if (gone.length) applied = null;
    await requestSync();
  }

  /**
   * Asks for permission, explaining first. Never shows the system prompt when the
   * user already denied it, and doesn't re-explain after "Not now" in this session.
   */
  async function askWithExplanation(explain: () => Promise<boolean>): Promise<PermissionStatus> {
    const p = await refreshPermission();
    if (p !== 'undetermined' || explanationDeclined) return p;
    if (!(await explain())) {
      explanationDeclined = true;
      return p;
    }
    const result = await api.requestPermission();
    setStatus({ permission: result });
    if (result === 'granted') await requestSync();
    return result;
  }

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refreshPermission,
    requestSync,
    cancelNoLongerNeeded,
    askWithExplanation,
    /** Resolves when no sync is running or queued. */
    idle: () => running ?? Promise.resolve(),
    stats,
  };
}

export type ReminderEngine = ReturnType<typeof createReminderEngine>;
