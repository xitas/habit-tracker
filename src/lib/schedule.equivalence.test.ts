// Proves the optimized, cached schedule.ts returns exactly what the original
// code returned (testing/scheduleReference.ts), on the large dataset
// (30 habits × 2 years with notes), before and after changes made through the
// real store, and that a change to one habit leaves the others' caches untouched.

import { addDays } from './dates';
import { LEGACY_STORAGE_KEY, type AppStore } from './persistence/core';
import { makeDevice, makeLegacyData } from './persistence/testing/harness';
import * as opt from './schedule';
import * as ref from './testing/scheduleReference';
import { logOf, serialize, type AppData, type Habit } from './types';

let fails = 0;
let checks = 0;
function same(what: string, a: unknown, b: unknown) {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fails++;
    if (fails <= 20) console.log(`    FAIL ${what}: optimized ${JSON.stringify(a)} vs reference ${JSON.stringify(b)}`);
  }
}

const TODAY = '2026-10-03';

/** Compares every result type for every habit against the reference implementation. */
function compareAll(label: string, data: AppData, opts: { dueDays: number; stateDays: number }) {
  const before = fails;
  const flat = serialize(data).entries;
  for (const ws of [0, 1] as const) {
    for (const h of data.habits) {
      const log = logOf(data.entries, h.id);
      const start = ref.habitStart(h, flat);
      same(`${h.id} start`, opt.habitStart(h, log), start);
      same(`${h.id} streaks ws${ws}`, opt.computeStreaks(h, log, TODAY, ws), ref.computeStreaks(h, flat, TODAY, ws));
      for (const span of [7, 30, 90, 730]) {
        const from = addDays(TODAY, -(span - 1));
        same(`${h.id} tally ${span}d ws${ws}`, opt.habitTally(h, log, from, TODAY, TODAY, ws), ref.habitTally(h, flat, from, TODAY, TODAY, ws));
      }
      for (let i = 0; i < opts.dueDays; i++) {
        const d = addDays(TODAY, -i);
        same(`${h.id} due ${d} ws${ws}`, opt.isDueOn(h, log, d, ws), ref.isDueOn(h, flat, d, ws));
        same(`${h.id} remaining ${d} ws${ws}`, opt.weeklyRemaining(h, log, d, ws), ref.weeklyRemaining(h, flat, d, ws));
      }
      if (ws === 1) {
        for (let i = -3; i < opts.stateDays; i++) {
          const d = addDays(TODAY, -i);
          same(`${h.id} dayState ${d}`, opt.dayState(h, log, d, TODAY, start), ref.dayState(h, flat, d, TODAY, start));
        }
      }
    }
    for (let i = 0; i < opts.dueDays; i++) {
      const d = addDays(TODAY, -i);
      same(`dayTally ${d} ws${ws}`, opt.dayTally(data.habits, data.entries, d, ws), ref.dayTally(data.habits, flat, d, ws));
    }
  }
  console.log(`${fails === before ? 'PASS' : 'FAIL'} ${label}`);
}

/** Snapshot of each habit's cached results, to check which were recomputed. */
function cachedResults(data: AppData) {
  return new Map(
    data.habits.map((h) => {
      const log = logOf(data.entries, h.id);
      return [h.id, { streaks: opt.computeStreaks(h, log, TODAY, 1), tally: opt.habitTally(h, log, addDays(TODAY, -29), TODAY, TODAY, 1) }];
    }),
  );
}

function onlyChanged(label: string, before: ReturnType<typeof cachedResults>, after: ReturnType<typeof cachedResults>, changed: string[]) {
  let reused = 0;
  let recomputed = 0;
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) continue;
    const isSame = a.streaks === b.streaks && a.tally === b.tally;
    if (changed.includes(id)) recomputed += isSame ? 0 : 1;
    else if (isSame) reused++;
    else {
      fails++;
      console.log(`    FAIL ${label}: ${id} was recomputed although it didn't change`);
    }
  }
  checks++;
  console.log(`${'PASS'} ${label}: ${reused} habits reused from cache, ${recomputed} recomputed`);
}

async function main() {
  const device = makeDevice();
  const legacy = makeLegacyData(30, 730);
  device.kv.map.set(LEGACY_STORAGE_KEY, JSON.stringify(legacy));
  const store: AppStore = await device.launch();
  const s = () => store.getState();
  const habit = (i: number): Habit => s().habits[i];
  console.log(`dataset: ${s().habits.length} habits, ${Object.keys(legacy.entries).length.toLocaleString()} entries`);

  compareAll('loaded data: every result matches the original code (both week starts)', s(), { dueDays: 45, stateDays: 400 });

  // Changes through the real store; after each, the optimized results must still match,
  // and only the changed habit may be recomputed.
  const steps: [string, () => string[]][] = [
    ['log today (yes/no habit)', () => (store.markDone(habit(0), TODAY), [habit(0).id])],
    ['add to a measurable habit', () => (store.setValue(habit(1), TODAY, 3), [habit(1).id])],
    ['skip a times-per-week habit', () => (store.markSkipped(habit(2), addDays(TODAY, -1)), [habit(2).id])],
    ['clear an old day', () => (store.clearStatus(habit(3), addDays(TODAY, -40)), [habit(3).id])],
    ['backfill before the start date', () => (store.markDone(habit(4), '2024-01-15'), [habit(4).id])],
    ['add a note', () => (store.setNote(habit(5), addDays(TODAY, -2), 'note'), [habit(5).id])],
    ['change a habit to Mon/Wed/Fri', () => (store.updateHabit(habit(6).id, { frequency: { kind: 'weekdays', days: [1, 3, 5] } }), [habit(6).id])],
  ];
  for (const [label, act] of steps) {
    const before = cachedResults(s());
    const changed = act();
    const after = cachedResults(s());
    onlyChanged(`${label}: only that habit recalculated`, before, after, changed);
    compareAll(`${label}: results still match the original code`, s(), { dueDays: 10, stateDays: 60 });
  }

  // Deleting a habit removes its log; everything else stays cached.
  {
    const id = habit(7).id;
    const before = cachedResults(s());
    store.deleteHabit(id);
    const after = cachedResults(s());
    onlyChanged('delete a habit: other habits reused', before, after, [id]);
    compareAll('delete a habit: results still match the original code', s(), { dueDays: 10, stateDays: 60 });
  }

  // A write replaces only the touched habit's log object.
  {
    const logsBefore = { ...s().entries };
    store.markDone(habit(9), TODAY);
    const changedLogs = Object.keys(s().entries).filter((id) => s().entries[id] !== logsBefore[id]);
    checks++;
    const ok = changedLogs.length === 1 && changedLogs[0] === habit(9).id;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} a tap replaces exactly one habit's entries object (${changedLogs.length} changed)`);
  }

  await store.close();
  device.cleanup();
  console.log(`${checks.toLocaleString()} comparisons`);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
