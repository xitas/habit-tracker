// Performance benchmark: 30 habits × 2 years with notes (~18,700 entries).
// Run with `npm run bench`.
//
// "Before" replays exactly what the app computed before the performance work:
// the frozen original scheduling code (src/lib/testing/scheduleReference.ts)
// over one flat entry map, plus the old store update (copying the whole map).
// "After" uses the real store and the cached code in src/lib/schedule.ts.
// Each number is the median of several runs, in milliseconds.

import { addDays } from '../src/lib/dates';
import { LEGACY_STORAGE_KEY } from '../src/lib/persistence/core';
import { makeDevice, makeLegacyData } from '../src/lib/persistence/testing/harness';
import * as opt from '../src/lib/schedule';
import * as ref from '../src/lib/testing/scheduleReference';
import { entryKey, logOf, serialize, type AppData, type Entry, type Habit } from '../src/lib/types';

const TODAY = '2026-10-03';
const WS = 1 as const;
const RUNS = 9;

// ---- The screens' computations, before and after (same work as the components do) ----

function subtitle(h: Habit, e: Entry | undefined, remaining: number, streak: number) {
  return `${h.type === 'measurable' ? `${e?.value ?? 0} / ${h.target}` : opt.frequencyLabel(h)} ${remaining} ${streak}`;
}

const before = {
  today(habits: Habit[], flat: ref.FlatEntries) {
    const active = habits.filter((h) => !h.archived);
    const due = active.filter((h) => ref.isDueOn(h, flat, TODAY, WS));
    const notDue = active.filter((h) => !due.includes(h));
    const tally = ref.dayTally(active, flat, TODAY, WS);
    const cards = due.map((h) => {
      const e = ref.getEntry(flat, h.id, TODAY);
      return subtitle(h, e, ref.weeklyRemaining(h, flat, TODAY, WS), ref.computeStreaks(h, flat, TODAY, WS).current);
    });
    return { notDue, tally, cards };
  },
  weekChart: (habits: Habit[], flat: ref.FlatEntries) =>
    Array.from({ length: 7 }, (_, i) => ref.dayTally(habits.filter((h) => !h.archived), flat, addDays(TODAY, -i), WS)),
  stats(habits: Habit[], flat: ref.FlatEntries) {
    const active = habits.filter((h) => !h.archived);
    const rates = active.map((h) => ref.habitTally(h, flat, addDays(TODAY, -29), TODAY, TODAY, WS));
    return [rates, before.weekChart(habits, flat), ref.computeStreaks(active[0], flat, TODAY, WS)];
  },
  habitsTab: (habits: Habit[], flat: ref.FlatEntries) => habits.map((h) => ref.computeStreaks(h, flat, TODAY, WS)),
};

const after = {
  today(s: AppData) {
    const active = s.habits.filter((h) => !h.archived);
    const due = active.filter((h) => opt.isDueOn(h, logOf(s.entries, h.id), TODAY, WS));
    const notDue = active.filter((h) => !due.includes(h));
    const tally = opt.dayTally(active, s.entries, TODAY, WS);
    const cards = due.map((h) => {
      const log = logOf(s.entries, h.id);
      const e = log[TODAY];
      return subtitle(h, e, opt.weeklyRemaining(h, log, TODAY, WS), opt.computeStreaks(h, log, TODAY, WS).current);
    });
    return { notDue, tally, cards };
  },
  weekChart: (s: AppData) =>
    Array.from({ length: 7 }, (_, i) => opt.dayTally(s.habits.filter((h) => !h.archived), s.entries, addDays(TODAY, -i), WS)),
  stats(s: AppData) {
    const active = s.habits.filter((h) => !h.archived);
    const rates = active.map((h) => opt.habitTally(h, logOf(s.entries, h.id), addDays(TODAY, -29), TODAY, TODAY, WS));
    return [rates, after.weekChart(s), opt.computeStreaks(active[0], logOf(s.entries, active[0].id), TODAY, WS)];
  },
  habitsTab: (s: AppData) => s.habits.map((h) => opt.computeStreaks(h, logOf(s.entries, h.id), TODAY, WS)),
};

// ---- Timing helpers ----

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function measure(fn: () => void, runs = RUNS): number {
  fn(); // warm up the JIT
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return median(times);
}

/**
 * First open of a screen: every cache empty. Each run gets a fresh copy with new
 * objects (so every cache misses); the copying itself is not timed.
 */
function measureCold(source: AppData, fn: (s: AppData) => void, runs = RUNS): number {
  fn(structuredClone(source)); // warm up the JIT
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const copy = structuredClone(source);
    const t0 = performance.now();
    fn(copy);
    times.push(performance.now() - t0);
  }
  return median(times);
}

async function main() {
  const device = makeDevice();
  const legacy = makeLegacyData(30, 730);
  device.kv.map.set(LEGACY_STORAGE_KEY, JSON.stringify(legacy));
  await (await device.launch()).close(); // one-time migration into SQLite

  // Launch: open SQLite, check it, load and validate everything.
  const launchTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const st = await device.launch();
    launchTimes.push(performance.now() - t0);
    await st.close();
  }
  const store = await device.launch();
  const state = () => store.getState();
  const habits = state().habits;
  let flat = serialize(state()).entries;
  const tapped = habits[4];
  const n = Object.keys(flat).length;

  const rows: [string, number, number | string, number][] = [];
  const row = (label: string, b: number, cold: number | string, warm: number) => rows.push([label, b, cold, warm]);

  // First Today render after launch.
  row('Launch: first Today screen data', measure(() => before.today(habits, flat), 3), measureCold(state(), after.today, 5), NaN);

  // One tap on Today: store update + Today recalculation.
  let v = 0;
  const beforeTap = measure(() => {
    const value = (v = (v + 1) % 9);
    const e: Entry = { habitId: tapped.id, date: TODAY, value, status: value >= tapped.target ? 'done' : 'missed' };
    flat = { ...flat, [entryKey(tapped.id, TODAY)]: e }; // the old store copied the whole map
    before.today(habits, flat);
  });
  after.today(state()); // screen already rendered once
  const afterTap = measure(() => {
    store.setValue(tapped, TODAY, (v = (v + 1) % 9));
    after.today(state());
  });
  row('Today: one tap (store update + recompute)', beforeTap, '—', afterTap);

  // Stats and Habits: first open (cold) and right after a tap on Today (warm except one habit).
  const afterATap = (fn: (s: AppData) => unknown) => {
    fn(state());
    return measure(() => {
      store.setValue(tapped, TODAY, (v = (v + 1) % 9));
      fn(state());
    });
  };
  row('Stats: weekly chart', measure(() => before.weekChart(habits, flat), 5), measureCold(state(), after.weekChart), afterATap(after.weekChart));
  row('Stats: whole screen', measure(() => before.stats(habits, flat), 5), measureCold(state(), after.stats), afterATap(after.stats));
  row('Habits tab: streaks', measure(() => before.habitsTab(habits, flat), 5), measureCold(state(), after.habitsTab), afterATap(after.habitsTab));

  await store.close();
  device.cleanup();

  const f = (x: number | string) => (typeof x === 'string' ? x : Number.isNaN(x) ? '—' : `${x.toFixed(x < 10 ? 2 : 1)} ms`);
  console.log(`\nDataset: ${habits.length} habits, ${n.toLocaleString()} entries (with notes). Median of ${RUNS} runs.\n`);
  console.log('| What | Before | After: first open | After: after a tap |');
  console.log('| --- | ---: | ---: | ---: |');
  console.log(`| Launch: load from SQLite | (same storage) | ${f(median(launchTimes))} | — |`);
  for (const [label, b, cold, warm] of rows) console.log(`| ${label} | ${f(b)} | ${f(cold)} | ${f(warm)} |`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
