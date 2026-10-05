// The 14 original streak/scheduling scenarios. Each runs through the optimized
// code (schedule.ts) and the frozen original (testing/scheduleReference.ts);
// both must match the expected value.

import { computeStreaks, dayState, habitTally, isDueOn } from './schedule';
import * as ref from './testing/scheduleReference';
import { entryKey, type Entry, type Habit, type HabitLog } from './types';

let fails = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function eq(name: string, optimized: unknown, reference: unknown, expected: unknown) {
  const ok = same(optimized, expected) && same(reference, expected);
  if (!ok) fails++;
  const detail = ok ? '' : ` (optimized ${JSON.stringify(optimized)}, reference ${JSON.stringify(reference)}, expected ${JSON.stringify(expected)})`;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(expected)}${detail}`);
}
const H = (freq: Habit['frequency'], created = '2026-09-01'): Habit => ({
  id: 'h', name: 'x', icon: '', color: '#000', frequency: freq, type: 'boolean', target: 1, unit: '',
  reminderTime: null, createdAt: new Date(2026, 8, Number(created.slice(8))).toISOString(), archived: false,
});
/** The same entries in both shapes: a per-habit log (new) and a flat map (reference). */
function E(list: [string, Entry['status']][]): { log: HabitLog; flat: ref.FlatEntries } {
  const entries = list.map(([d, s]): Entry => ({ habitId: 'h', date: d, value: s === 'done' ? 1 : 0, status: s }));
  return {
    log: Object.fromEntries(entries.map((e) => [e.date, e])),
    flat: Object.fromEntries(entries.map((e) => [entryKey('h', e.date), e])),
  };
}
const join = (a: ReturnType<typeof E>, b: ReturnType<typeof E>) => ({ log: { ...a.log, ...b.log }, flat: { ...a.flat, ...b.flat } });
const streaks = (h: Habit, x: ReturnType<typeof E>) => [computeStreaks(h, x.log, today, 1), ref.computeStreaks(h, x.flat, today, 1)] as const;

// 2026-09-28 is a Monday. Today = Sat 2026-10-03.
const today = '2026-10-03';
const mwf = H({ kind: 'weekdays', days: [1, 3, 5] }, '2026-09-28');
{
  const [a, b] = streaks(mwf, E([['2026-09-28', 'done'], ['2026-09-30', 'done'], ['2026-10-02', 'done']]));
  eq('MWF streak ignores off days', a.current, b.current, 3);
}
eq('MWF missed Wed breaks', ...streaks(mwf, E([['2026-09-28', 'done'], ['2026-10-02', 'done']])), { current: 1, best: 1, unit: 'day' });
{
  const [a, b] = streaks(mwf, E([['2026-09-28', 'done'], ['2026-09-30', 'skipped'], ['2026-10-02', 'done']]));
  eq('MWF skip Wed is neutral', a.current, b.current, 2);
}

const daily = H({ kind: 'daily' }, '2026-09-29');
{
  const [a, b] = streaks(daily, E([['2026-09-29', 'done'], ['2026-09-30', 'done'], ['2026-10-01', 'done'], ['2026-10-02', 'done']]));
  eq('daily: today not done yet does not break', a.current, b.current, 4);
}
eq('daily: today done extends', ...streaks(daily, E([['2026-10-02', 'done'], ['2026-10-03', 'done']])), { current: 2, best: 2, unit: 'day' });
eq('daily: best kept after break', ...streaks(daily, E([['2026-09-29', 'done'], ['2026-09-30', 'done'], ['2026-10-01', 'done'], ['2026-10-03', 'done']])), { current: 1, best: 3, unit: 'day' });

const tpw = H({ kind: 'timesPerWeek', count: 2 }, '2026-09-14'); // Monday
const tpwE = E([['2026-09-15', 'done'], ['2026-09-17', 'done'], ['2026-09-22', 'done'], ['2026-09-26', 'done'], ['2026-09-29', 'done']]);
eq('2x/week: two met weeks, current week in progress', ...streaks(tpw, tpwE), { current: 2, best: 2, unit: 'week' });
eq('2x/week: due today while quota unmet', isDueOn(tpw, tpwE.log, today, 1), ref.isDueOn(tpw, tpwE.flat, today, 1), true);
const tpwMet = join(tpwE, E([['2026-10-01', 'done']]));
eq('2x/week: not due once quota met', isDueOn(tpw, tpwMet.log, today, 1), ref.isDueOn(tpw, tpwMet.flat, today, 1), false);
{
  const [a, b] = streaks(tpw, tpwMet);
  eq('2x/week: met current week counts', a.current, b.current, 3);
}
eq('dayState tpw open not missed', dayState(tpw, tpwE.log, '2026-09-30', today, '2026-09-14'), ref.dayState(tpw, tpwE.flat, '2026-09-30', today, '2026-09-14'), 'open');

eq('MWF due Tue?', isDueOn(mwf, {}, '2026-09-29', 1), ref.isDueOn(mwf, {}, '2026-09-29', 1), false);
{
  const x = E([['2026-09-28', 'done'], ['2026-10-02', 'done']]);
  eq('MWF tally 7d', habitTally(mwf, x.log, '2026-09-27', today, today, 1), ref.habitTally(mwf, x.flat, '2026-09-27', today, today, 1), { done: 2, expected: 3 });
}
{
  const x = E([['2026-09-29', 'done'], ['2026-09-30', 'skipped']]);
  eq('daily tally excludes today pending & skips', habitTally(daily, x.log, '2026-09-27', today, today, 1), ref.habitTally(daily, x.flat, '2026-09-27', today, today, 1), { done: 1, expected: 3 });
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
