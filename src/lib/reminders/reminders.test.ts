// Reminder planning and syncing tests, against a fake notification system that
// behaves like the phone's: fired notifications disappear, writes can fail.

import { addDays } from '../dates';
import { DEFAULT_SETTINGS } from '../persistence/validate';
import { nestEntries, type AppData, type Entry, type Habit } from '../types';
import { createReminderEngine, type NotificationApi, type PermissionStatus, type ScheduledRequest } from './engine';
import { buildReminderPlan, habitReminderId, MAX_SCHEDULED, nudgeId, routeForNotification, type PlannedReminder } from './plan';

let failures = 0;
function check(what: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    console.log(`    FAIL ${what}${detail ? ` (${detail})` : ''}`);
  }
}
async function test(name: string, fn: () => Promise<void> | void) {
  const before = failures;
  try {
    await fn();
  } catch (err) {
    failures++;
    console.log(`    FAIL threw: ${err instanceof Error ? err.stack : String(err)}`);
  }
  console.log(`${failures === before ? 'PASS' : 'FAIL'} ${name}`);
}

// ---- Fixtures ----

// Saturday 2026-10-03, 08:00 local. Week starts Monday, so the week ends Sunday 10-04.
const TODAY = '2026-10-03';
const at = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

const habit = (id: string, patch: Partial<Habit> = {}): Habit => ({
  id,
  name: `Habit ${id}`,
  icon: '✅',
  color: '#5B6CFF',
  frequency: { kind: 'daily' },
  type: 'boolean',
  target: 1,
  unit: '',
  reminderTime: '09:00',
  createdAt: '2026-09-01T08:00:00.000Z',
  archived: false,
  ...patch,
});
const entry = (habitId: string, date: string, status: Entry['status'] = 'done', value = 1): Entry => ({ habitId, date, status, value });
const data = (habits: Habit[], entries: Entry[] = [], settings = {}): AppData => ({
  version: 1,
  habits,
  entries: nestEntries(entries),
  settings: { ...DEFAULT_SETTINGS, ...settings },
});

/** A fake phone notification system. */
function fakePhone(clock: { now: Date }, permission: PermissionStatus = 'granted') {
  const scheduled = new Map<string, { at: number; fingerprint: string | null }>();
  const phone = {
    permission,
    /** What the user answers to the system prompt. */
    answer: 'granted' as PermissionStatus,
    requests: 0,
    failScheduleAt: 0, // the nth schedule() call throws
    dropScheduleAt: 0, // the nth schedule() call is silently lost
    delayMs: 0,
    scheduleCalls: 0,
    cancelled: [] as string[],
    scheduled,
    /** Notifications still pending (fired ones are gone, like on a real phone). */
    pending: () => [...scheduled].filter(([, v]) => v.at > clock.now.getTime()).map(([id]) => id),
  };
  const wait = () => (phone.delayMs ? new Promise((r) => setTimeout(r, phone.delayMs)) : Promise.resolve());
  const api: NotificationApi = {
    async getPermission() {
      await wait();
      return phone.permission;
    },
    async requestPermission() {
      phone.requests++;
      phone.permission = phone.answer;
      return phone.permission;
    },
    async getScheduled(): Promise<ScheduledRequest[]> {
      await wait();
      return [...scheduled]
        .filter(([, v]) => v.at > clock.now.getTime())
        .map(([id, v]) => ({ id, fingerprint: v.fingerprint }));
    },
    async schedule(item: PlannedReminder) {
      await wait();
      phone.scheduleCalls++;
      if (phone.scheduleCalls === phone.failScheduleAt) throw new Error('Injected: could not schedule');
      if (phone.scheduleCalls === phone.dropScheduleAt) return;
      scheduled.set(item.id, { at: item.at, fingerprint: item.fingerprint });
    },
    async cancel(id: string) {
      await wait();
      phone.cancelled.push(id);
      scheduled.delete(id);
    },
  };
  return { phone, api };
}

function setup(initial: AppData, permission: PermissionStatus = 'granted', now = at(TODAY, '08:00')) {
  const clock = { now };
  const state = { data: initial };
  const { phone, api } = fakePhone(clock, permission);
  const timers: (() => void)[] = [];
  const engine = createReminderEngine({
    api,
    getData: () => state.data,
    now: () => clock.now,
    setTimer: (fn) => {
      timers.push(fn);
      return () => {
        const i = timers.indexOf(fn);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    log: () => {},
  });
  return { clock, state, phone, engine, timers };
}

const planIds = (d: AppData, now: Date) => buildReminderPlan(d, now).items.map((i) => i.id).sort();
const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function main() {
  // ---------- Planning ----------

  await test('one-off reminders for the next 7 days, soonest first, only in the future', () => {
    const d = data([habit('a', { reminderTime: '07:00' }), habit('b', { reminderTime: '21:00' })]);
    const plan = buildReminderPlan(d, at(TODAY, '08:00'));
    const ids = plan.items.map((i) => i.id);
    check("today's 07:00 reminder already passed", !ids.includes(habitReminderId('a', TODAY)));
    check("today's 21:00 reminder planned", ids.includes(habitReminderId('b', TODAY)));
    check('7 days ahead', ids.includes(habitReminderId('a', addDays(TODAY, 6))) && !ids.includes(habitReminderId('a', addDays(TODAY, 7))));
    check('sorted by time', plan.items.every((it, i) => i === 0 || plan.items[i - 1].at <= it.at));
  });

  await test('no reminder on a day that is already done or skipped; partial still reminds', () => {
    const d = data(
      [habit('done'), habit('skip'), habit('part', { type: 'measurable', target: 8, unit: 'glasses' })],
      [entry('done', TODAY, 'done'), entry('skip', TODAY, 'skipped'), entry('part', TODAY, 'missed', 3)],
    );
    const ids = planIds(d, at(TODAY, '08:00'));
    check('done today: no reminder today', !ids.includes(habitReminderId('done', TODAY)));
    check('done today: still reminded tomorrow', ids.includes(habitReminderId('done', addDays(TODAY, 1))));
    check('skipped today: no reminder today', !ids.includes(habitReminderId('skip', TODAY)));
    check('partly done: still reminded', ids.includes(habitReminderId('part', TODAY)));
  });

  await test('weekday habits only on their days; archived habits and disabled reminders never', () => {
    const mwf = habit('mwf', { frequency: { kind: 'weekdays', days: [1, 3, 5] } });
    const d = data([mwf, habit('arch', { archived: true }), habit('none', { reminderTime: null })]);
    const ids = planIds(d, at(TODAY, '08:00'));
    const days = ids.filter((id) => id.startsWith('habit:mwf:')).map((id) => new Date(id.slice(-10) + 'T12:00').getDay());
    check('only Mon/Wed/Fri', days.length === 3 && days.every((x) => [1, 3, 5].includes(x)), JSON.stringify(days));
    check('no archived', !ids.some((id) => id.includes(':arch:')));
    check('no reminderless', !ids.some((id) => id.includes(':none:')));
    check('reminders off in Settings → nothing', buildReminderPlan(data([habit('a')], [], { remindersEnabled: false }), at(TODAY, '08:00')).items.length === 0);
  });

  await test('times-per-week: stops once the weekly goal is met, resumes next week', () => {
    const tpw = habit('w', { frequency: { kind: 'timesPerWeek', count: 2 } });
    // Week of Mon 09-28 .. Sun 10-04: done Tue and Thu → goal met.
    const met = data([tpw], [entry('w', '2026-09-29'), entry('w', '2026-10-01')]);
    const ids = planIds(met, at(TODAY, '08:00'));
    check('no reminder Sat (goal met)', !ids.includes(habitReminderId('w', TODAY)));
    check('no reminder Sun (goal met)', !ids.includes(habitReminderId('w', '2026-10-04')));
    check('reminds again Monday (new week)', ids.includes(habitReminderId('w', '2026-10-05')));
    const notMet = data([tpw], [entry('w', '2026-09-29')]);
    check('goal not met: reminds today', planIds(notMet, at(TODAY, '08:00')).includes(habitReminderId('w', TODAY)));
  });

  await test('iOS limit: 30 habits on daily and weekday schedules plus nudges stay under 64, soonest included', () => {
    const habits = Array.from({ length: 30 }, (_, i) =>
      habit(`h${i}`, {
        frequency: i % 2 ? { kind: 'weekdays', days: [1, 2, 3, 4, 5] } : { kind: 'daily' },
        reminderTime: `${String(7 + (i % 14)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
      }),
    );
    const d = data(habits);
    for (let hour = 0; hour < 24 * 7; hour += 5) {
      const now = new Date(at(TODAY, '00:00').getTime() + hour * 3600_000);
      const plan = buildReminderPlan(d, now);
      const all = buildReminderPlan(d, now, Infinity);
      check(`under 64 at +${hour}h`, plan.items.length <= MAX_SCHEDULED && MAX_SCHEDULED < 64, `${plan.items.length}`);
      const last = plan.items[plan.items.length - 1]?.at ?? 0;
      const omitted = all.items.filter((i) => !plan.items.some((p) => p.id === i.id));
      check(`soonest kept at +${hour}h`, omitted.every((o) => o.at >= last));
      check(`deferred counted at +${hour}h`, plan.deferred === omitted.length);
      if (hour === 0) {
        const nudgesInPlan = plan.items.filter((i) => i.data.kind === 'nudge').length;
        console.log(`    ${all.items.length} wanted, ${plan.items.length} scheduled (${nudgesInPlan} nudge), ${plan.deferred} deferred to a later refresh`);
      }
    }
  });

  await test('tapping a notification goes to the habit, or Today', () => {
    const hs = [habit('a')];
    check('habit reminder → detail', routeForNotification({ kind: 'habit', habitId: 'a', date: TODAY }, hs) === '/habit/a');
    check('deleted habit → Today', routeForNotification({ kind: 'habit', habitId: 'gone', date: TODAY }, hs) === '/');
    check('nudge → Today', routeForNotification({ kind: 'nudge', date: TODAY }, hs) === '/');
    check('unknown → Today', routeForNotification(undefined, hs) === '/');
  });

  // ---------- Syncing ----------

  await test('granted: schedule matches the plan exactly and is verified', async () => {
    const { phone, engine, state, clock } = setup(data([habit('a'), habit('b', { reminderTime: '20:00' })]));
    await engine.requestSync();
    check('scheduled = plan', sameSet(phone.pending(), planIds(state.data, clock.now)));
    check('recorded as synced', engine.getStatus().syncedAt !== null && engine.getStatus().error === null);
    const calls = phone.scheduleCalls;
    await engine.requestSync();
    check('nothing rescheduled when nothing changed', phone.scheduleCalls === calls);
  });

  await test('denied: nothing scheduled, not recorded as done; granted later → scheduled right away', async () => {
    const { phone, engine, state, clock } = setup(data([habit('a')]), 'denied');
    await engine.requestSync();
    check('nothing scheduled', phone.pending().length === 0);
    check('not marked as synced', engine.getStatus().syncedAt === null);
    check('permission known as denied', engine.getStatus().permission === 'denied');
    // User enables notifications in phone Settings, then returns to the app.
    phone.permission = 'granted';
    await engine.refreshPermission();
    await engine.idle();
    check('scheduled after coming back', sameSet(phone.pending(), planIds(state.data, clock.now)) && phone.pending().length > 0);
  });

  await test('asking: explains first, never re-asks after a denial, respects "Not now"', async () => {
    // Undetermined → explanation → system prompt → granted → scheduled.
    {
      const { phone, engine } = setup(data([habit('a')]), 'undetermined');
      let explained = 0;
      const result = await engine.askWithExplanation(async () => (explained++, true));
      check('explained once', explained === 1);
      check('system prompt shown once', phone.requests === 1);
      check('granted', result === 'granted');
      check('scheduled', phone.pending().length > 0);
    }
    // Denied → no explanation, no prompt.
    {
      const { phone, engine } = setup(data([habit('a')]), 'denied');
      let explained = 0;
      const result = await engine.askWithExplanation(async () => (explained++, true));
      check('denied: no explanation', explained === 0);
      check('denied: no system prompt', phone.requests === 0);
      check('stays denied', result === 'denied');
    }
    // "Not now" → no prompt, and not explained again this session.
    {
      const { phone, engine } = setup(data([habit('a')]), 'undetermined');
      let explained = 0;
      await engine.askWithExplanation(async () => (explained++, false));
      await engine.askWithExplanation(async () => (explained++, true));
      check('"Not now": no system prompt', phone.requests === 0);
      check('"Not now": not explained again', explained === 1);
    }
    // User says no to the system prompt → denied, never asked again.
    {
      const { phone, engine } = setup(data([habit('a')]), 'undetermined');
      phone.answer = 'denied';
      await engine.askWithExplanation(async () => true);
      await engine.askWithExplanation(async () => true);
      check('asked only once', phone.requests === 1);
      check('nothing scheduled', phone.pending().length === 0);
    }
  });

  await test('a failed schedule is not recorded as done, and a retry finishes it', async () => {
    const { phone, engine, state, clock, timers } = setup(data([habit('a'), habit('b')]));
    phone.failScheduleAt = 3;
    await engine.requestSync();
    check('not marked as synced', engine.getStatus().syncedAt === null && !!engine.getStatus().error);
    check('retry scheduled', timers.length === 1);
    timers.shift()!(); // the retry fires
    await engine.idle();
    check('complete after retry', sameSet(phone.pending(), planIds(state.data, clock.now)));
    check('marked as synced', engine.getStatus().syncedAt !== null && engine.getStatus().error === null);
  });

  await test('a silently lost schedule fails verification and is retried', async () => {
    const { phone, engine, state, clock, timers } = setup(data([habit('a'), habit('b')]));
    phone.dropScheduleAt = 2;
    await engine.requestSync();
    check('verification caught it', /don't match/.test(engine.getStatus().error ?? ''), engine.getStatus().error ?? '');
    check('not marked as synced', engine.getStatus().syncedAt === null);
    timers.shift()?.();
    await engine.idle();
    check('complete after retry', sameSet(phone.pending(), planIds(state.data, clock.now)));
  });

  await test('overlapping updates run one at a time, then once more with the latest data', async () => {
    const habits = Array.from({ length: 6 }, (_, i) => habit(`h${i}`));
    const { phone, engine, state, clock } = setup(data(habits));
    phone.delayMs = 3;
    const first = engine.requestSync();
    // Changes keep arriving while the first sync is running.
    for (let i = 0; i < 5; i++) {
      state.data = data(habits.slice(0, 5 - i));
      void engine.requestSync();
      await new Promise((r) => setTimeout(r, 2));
    }
    await first;
    await engine.idle();
    check('never more than one sync at a time', engine.stats.maxConcurrent === 1, `${engine.stats.maxConcurrent}`);
    check('coalesced into at most 2 runs', engine.stats.runs <= 2, `${engine.stats.runs} runs`);
    check('final schedule matches the latest data', sameSet(phone.pending(), planIds(state.data, clock.now)));
    check('latest data = 1 habit', phone.pending().filter((id) => id.startsWith('habit:')).every((id) => id.startsWith('habit:h0:')));
  });

  await test('completing a habit cancels today\'s pending reminder immediately', async () => {
    const { phone, engine, state } = setup(data([habit('a'), habit('b')]));
    await engine.requestSync();
    check('today scheduled', phone.pending().includes(habitReminderId('a', TODAY)));
    state.data = data([habit('a'), habit('b')], [entry('a', TODAY)]);
    phone.delayMs = 20; // every phone call takes 20 ms, so a full sync takes 100+ ms
    const cancelling = engine.cancelNoLongerNeeded();
    await new Promise((r) => setTimeout(r, 45));
    check('cancelled first', phone.cancelled[0] === habitReminderId('a', TODAY), JSON.stringify(phone.cancelled));
    check('…while the full sync is still running', engine.stats.active === 1);
    await cancelling;
    check("a's reminder gone today", !phone.pending().includes(habitReminderId('a', TODAY)));
    check("a's reminder kept tomorrow", phone.pending().includes(habitReminderId('a', addDays(TODAY, 1))));
    check("b's reminder kept", phone.pending().includes(habitReminderId('b', TODAY)));
  });

  await test('archived and deleted habits lose their reminders; old repeating reminders are removed', async () => {
    const { phone, engine, state, clock } = setup(data([habit('a'), habit('b'), habit('c')]));
    // Leftovers from the previous app version (repeating, no fingerprint).
    for (const id of ['habit-a', 'habit-b-3', 'nudge-2026-10-03']) phone.scheduled.set(id, { at: at('2026-10-09', '09:00').getTime(), fingerprint: null });
    await engine.requestSync();
    check('old repeating reminders removed', !phone.pending().some((id) => id.startsWith('habit-') || id.startsWith('nudge-')));
    state.data = data([habit('a', { archived: true }), habit('c')]); // a archived, b deleted
    await engine.cancelNoLongerNeeded();
    check('archived habit: none left', !phone.pending().some((id) => id.startsWith('habit:a:')));
    check('deleted habit: none left', !phone.pending().some((id) => id.startsWith('habit:b:')));
    check('others kept', phone.pending().some((id) => id.startsWith('habit:c:')));
    check('exactly the plan', sameSet(phone.pending(), planIds(state.data, clock.now)));
  });

  await test('editing a reminder time reschedules it', async () => {
    const { phone, engine, state, clock } = setup(data([habit('a', { reminderTime: '18:00' })]));
    await engine.requestSync();
    state.data = data([habit('a', { reminderTime: '19:30' })]);
    await engine.requestSync();
    const today = phone.scheduled.get(habitReminderId('a', TODAY));
    check('moved to 19:30', today?.at === at(TODAY, '19:30').getTime());
    check('matches plan', sameSet(phone.pending(), planIds(state.data, clock.now)));
  });

  await test('midnight rollover and the iOS limit: refreshes fill the next days without passing 60', async () => {
    const habits = Array.from({ length: 30 }, (_, i) => habit(`h${i}`, { reminderTime: `${String(6 + (i % 15)).padStart(2, '0')}:00` }));
    const { phone, engine, state, clock } = setup(data(habits));
    for (let day = 0; day < 4; day++) {
      clock.now = at(addDays(TODAY, day), '00:00');
      clock.now.setSeconds(30); // just after midnight
      await engine.requestSync();
      const pending = phone.pending();
      check(`day ${day}: under the limit`, pending.length <= MAX_SCHEDULED, `${pending.length}`);
      check(`day ${day}: today's reminders all scheduled`, habits.every((h) => pending.includes(habitReminderId(h.id, addDays(TODAY, day)))));
      check(`day ${day}: matches the plan`, sameSet(pending, planIds(state.data, clock.now)));
    }
  });

  await test('nudge: only while habits are open, gone once the day is finished', async () => {
    const { phone, engine, state } = setup(data([habit('a')]));
    await engine.requestSync();
    check('nudge today', phone.pending().includes(nudgeId(TODAY)));
    state.data = data([habit('a')], [entry('a', TODAY)]);
    await engine.cancelNoLongerNeeded();
    check('nudge cancelled when all done', !phone.pending().includes(nudgeId(TODAY)));
  });

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
