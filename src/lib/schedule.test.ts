import { computeStreaks, isDueOn, habitTally, dayState } from './schedule';
import { entryKey, type Entry, type Habit } from './types';

let fails = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(a)}${ok ? '' : ` expected ${JSON.stringify(b)}`}`);
};
const H = (freq: Habit['frequency'], created = '2026-09-01'): Habit => ({
  id: 'h', name: 'x', icon: '', color: '#000', frequency: freq, type: 'boolean', target: 1, unit: '',
  reminderTime: null, createdAt: new Date(2026, 8, Number(created.slice(8))).toISOString(), archived: false,
});
const E = (list: [string, Entry['status']][]) => Object.fromEntries(list.map(([d, s]) => [entryKey('h', d), { habitId: 'h', date: d, value: s === 'done' ? 1 : 0, status: s }]));

// 2026-09-28 is a Monday. Today = Sat 2026-10-03.
const today = '2026-10-03';
const mwf = H({ kind: 'weekdays', days: [1, 3, 5] }, '2026-09-28');
eq('MWF streak ignores off days', computeStreaks(mwf, E([['2026-09-28','done'],['2026-09-30','done'],['2026-10-02','done']]), today, 1).current, 3);
eq('MWF missed Wed breaks', computeStreaks(mwf, E([['2026-09-28','done'],['2026-10-02','done']]), today, 1), { current: 1, best: 1, unit: 'day' });
eq('MWF skip Wed is neutral', computeStreaks(mwf, E([['2026-09-28','done'],['2026-09-30','skipped'],['2026-10-02','done']]), today, 1).current, 2);

const daily = H({ kind: 'daily' }, '2026-09-29');
eq('daily: today not done yet does not break', computeStreaks(daily, E([['2026-09-29','done'],['2026-09-30','done'],['2026-10-01','done'],['2026-10-02','done']]), today, 1).current, 4);
eq('daily: today done extends', computeStreaks(daily, E([['2026-10-02','done'],['2026-10-03','done']]), today, 1), { current: 2, best: 2, unit: 'day' });
eq('daily: best kept after break', computeStreaks(daily, E([['2026-09-29','done'],['2026-09-30','done'],['2026-10-01','done'],['2026-10-03','done']]), today, 1), { current: 1, best: 3, unit: 'day' });

const tpw = H({ kind: 'timesPerWeek', count: 2 }, '2026-09-14'); // Monday
const tpwE = E([['2026-09-15','done'],['2026-09-17','done'], ['2026-09-22','done'],['2026-09-26','done'], ['2026-09-29','done']]);
eq('2x/week: two met weeks, current week in progress', computeStreaks(tpw, tpwE, today, 1), { current: 2, best: 2, unit: 'week' });
eq('2x/week: due today while quota unmet', isDueOn(tpw, tpwE, today, 1), true);
const tpwMet = { ...tpwE, ...E([['2026-10-01','done']]) };
eq('2x/week: not due once quota met', isDueOn(tpw, tpwMet, today, 1), false);
eq('2x/week: met current week counts', computeStreaks(tpw, tpwMet, today, 1).current, 3);
eq('dayState tpw open not missed', dayState(tpw, tpwE, '2026-09-30', today, '2026-09-14'), 'open');

eq('MWF due Tue?', isDueOn(mwf, {}, '2026-09-29', 1), false);
eq('MWF tally 7d', habitTally(mwf, E([['2026-09-28','done'],['2026-10-02','done']]), '2026-09-27', today, today, 1), { done: 2, expected: 3 });
eq('daily tally excludes today pending & skips', habitTally(daily, E([['2026-09-29','done'],['2026-09-30','skipped']]), '2026-09-27', today, today, 1), { done: 1, expected: 3 });

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
