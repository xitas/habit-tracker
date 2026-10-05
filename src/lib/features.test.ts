// Backup/restore, CSV import, undo and reduced-motion tests, against the real
// store and real SQLite files (see persistence/testing/harness.ts).

import { BACKUP_FORMAT, createBackup, lastBackupText, readBackup } from './backup';
import { buildCsv, parseCsv, parseFrequency, planCsvImport } from './csvFormat';
import { motionPlan } from './motionPolicy';
import { LEGACY_STORAGE_KEY, type AppStore } from './persistence/core';
import { makeDevice, makeLegacyData, readDb, sameData } from './persistence/testing/harness';
import { createReminderEngine, type NotificationApi } from './reminders/engine';
import { habitReminderId } from './reminders/plan';
import { frequencyLabel } from './schedule';
import { logOf, serialize, type AppData, type Habit } from './types';
import { describeEntryChange, dismissUndo, getUndo, offerUndo, performUndo } from './undo';

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

const NOW = new Date('2026-10-04T09:00:00Z');
const draft = (name: string, patch: Partial<Habit> = {}) => ({
  name,
  icon: '💧',
  color: '#5B6CFF',
  frequency: { kind: 'daily' as const },
  type: 'boolean' as const,
  target: 1,
  unit: '',
  reminderTime: null,
  ...patch,
});

/** A device whose store has the large dataset (30 habits × 2 years with notes). */
async function bigDevice() {
  const device = makeDevice();
  device.kv.map.set(LEGACY_STORAGE_KEY, JSON.stringify(makeLegacyData(30, 730)));
  const store = await device.launch();
  return { device, store };
}

const restart = async (device: ReturnType<typeof makeDevice>, store: AppStore) => {
  await store.close();
  return device.launch();
};

async function main() {
  // ---------- Backup and restore ----------

  await test('backup → restore round trip: data identical (30 habits × 2 years with notes)', async () => {
    const { device, store } = await bigDevice();
    const original = store.getState();
    const file = createBackup(original, { appVersion: '1.0.0', now: NOW });
    const doc = JSON.parse(file.content);
    check('file metadata', doc.format === BACKUP_FORMAT && doc.appVersion === '1.0.0' && doc.schemaVersion === 1 && doc.exportedAt === NOW.toISOString());
    check('file name', file.name === 'habits-backup-2026-10-04.json');
    const checked = readBackup(file.content);
    check('valid', checked.ok, checked.ok ? '' : checked.error);
    if (!checked.ok) return;
    check('summary counts', checked.summary.habits === 30 && checked.summary.entries === Object.keys(serialize(original).entries).length);
    check('summary notes', checked.summary.notes === Object.values(serialize(original).entries).filter((e) => e.note).length);

    // Restore into a different, non-empty device.
    const other = makeDevice();
    let target = await other.launch();
    target.addHabit(draft('Will be replaced'));
    await target.flush();
    const result = await target.replaceAllData(checked.data, 'restore');
    check('restore ok', result.ok, result.message);
    check('identical in memory', sameData(target.getState(), original));
    target = await restart(other, target);
    check('identical after restart', sameData(target.getState(), original));
    const db = readDb(other.dbPath());
    check('database rows match', db.habits === 30 && db.entries === Object.keys(serialize(original).entries).length);
    await target.close();
    await store.close();
    device.cleanup();
    other.cleanup();
  });

  await test('restoring first saves a backup of the current data, and keeps "last backup" time', async () => {
    const device = makeDevice();
    const store = await device.launch();
    const mine = store.addHabit(draft('Mine'))!;
    store.markDone(mine, '2026-10-03');
    store.updateSettings({ lastBackupAt: '2026-10-01T10:00:00.000Z' });
    await store.flush();
    const before = store.getState();
    const incoming = makeLegacyData(2, 10);
    const restored = readBackup(JSON.stringify(incoming));
    if (!restored.ok) return check('valid', false, restored.error);
    const r = await store.replaceAllData(restored.data, 'restore');
    check('ok', r.ok, r.message);
    const saved = [...device.files.map.keys()].filter((k) => k.startsWith('backups/before-restore-'));
    check('safety backup written', saved.length === 1);
    const safety = readBackup(device.files.map.get(saved[0])!);
    check('safety backup restores the previous data', safety.ok && sameData(safety.data, before));
    check('last backup time kept', store.getState().settings.lastBackupAt === '2026-10-01T10:00:00.000Z');
    await store.close();
    device.cleanup();
  });

  await test('older data versions restore: original format (v0) and v0 export files', async () => {
    const legacy = makeLegacyData(3, 40);
    const raw = readBackup(JSON.stringify(legacy)); // the original AsyncStorage document
    check('original format accepted', raw.ok && raw.summary.schemaVersion === 0 && sameData(raw.data, legacy), raw.ok ? '' : raw.error);
    const v0 = readBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 0, exportedAt: NOW.toISOString(), data: legacy }));
    check('v0 export upgraded', v0.ok && sameData(v0.data, legacy), v0.ok ? '' : v0.error);
    const internal = readBackup(JSON.stringify({ format: 'habit-tracker-backup', schemaVersion: 1, savedAt: NOW.toISOString(), data: legacy }));
    check('automatic safety backups accepted', internal.ok && internal.summary.exportedAt === NOW.toISOString());
    // And they really restore through the store.
    const device = makeDevice();
    const store = await device.launch();
    if (raw.ok) check('restores', (await store.replaceAllData(raw.data, 'restore')).ok && sameData(store.getState(), legacy));
    await store.close();
    device.cleanup();
  });

  await test('newer, corrupt or invalid backups are refused and change nothing', async () => {
    const device = makeDevice();
    const store = await device.launch();
    const h = store.addHabit(draft('Keep me'))!;
    store.markDone(h, '2026-10-03');
    await store.flush();
    const before = JSON.stringify(serialize(store.getState()));
    const legacy = makeLegacyData(2, 5);
    const cases: [string, string, RegExp][] = [
      ['newer data version', JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 99, exportedAt: NOW.toISOString(), data: legacy }), /newer version/],
      ['not JSON', '{"format": "habit-tracker-export", "data": ', /isn’t readable JSON/],
      ['truncated file', createBackup(store.getState(), { appVersion: '1', now: NOW }).content.slice(0, -40), /isn’t readable JSON/],
      ['some other JSON', JSON.stringify({ hello: 'world' }), /isn’t a Habits backup/],
      ['damaged record', JSON.stringify({ ...legacy, habits: [{ ...legacy.habits[0], frequency: { kind: 'sometimes' } }] }), /damaged/],
      ['missing version', JSON.stringify({ format: BACKUP_FORMAT, data: legacy }), /data version/],
    ];
    for (const [name, raw, expect] of cases) {
      const r = readBackup(raw);
      check(`${name}: refused`, !r.ok && expect.test(r.error), r.ok ? 'accepted!' : r.error);
      check(`${name}: says nothing changed`, !r.ok && /Nothing was changed/.test(r.error));
    }
    check('data untouched', JSON.stringify(serialize(store.getState())) === before);
    await store.close();
    device.cleanup();
  });

  await test('a failed restore changes nothing (database write fails, or the safety backup can’t be saved)', async () => {
    const device = makeDevice();
    let store = await device.launch();
    store.addHabit(draft('Original'));
    await store.flush();
    const before = store.getState();
    const incoming = readBackup(JSON.stringify(makeLegacyData(3, 30)));
    if (!incoming.ok) return check('valid', false);
    device.faults.failSql = /^INSERT INTO entries/;
    const r1 = await store.replaceAllData(incoming.data, 'restore');
    device.faults.failSql = undefined;
    check('reported', !r1.ok && /Nothing was changed/.test(r1.message), r1.message);
    check('memory unchanged', sameData(store.getState(), before));
    const realWrite = device.files.write;
    device.files.write = async () => {
      throw new Error('disk full');
    };
    const r2 = await store.replaceAllData(incoming.data, 'restore');
    device.files.write = realWrite;
    check('refused without a safety backup', !r2.ok && /disk full/.test(r2.message));
    store = await restart(device, store);
    check('database unchanged', sameData(store.getState(), before));
    await store.close();
    device.cleanup();
  });

  await test('"last backup" text', () => {
    check('never', lastBackupText(null, NOW) === 'No backup yet');
    check('today', lastBackupText('2026-10-04T01:00:00Z', NOW) === 'Last backup: today');
    check('yesterday', lastBackupText('2026-10-03T08:00:00Z', NOW) === 'Last backup: yesterday');
    check('12 days', lastBackupText('2026-09-22T08:00:00Z', NOW) === 'Last backup: 12 days ago');
  });

  // ---------- CSV import ----------

  const sortedLines = (csv: string) => {
    const [header, ...rows] = parseCsv(csv).filter((r) => r.some((c) => c));
    return JSON.stringify([header, ...rows.map((r) => JSON.stringify(r)).sort()]);
  };
  let id = 0;
  const newId = () => `imported${++id}`;

  await test('CSV export → import round trip (30 habits × 2 years, notes with quotes, commas and line breaks)', async () => {
    const { device, store } = await bigDevice();
    const original = store.getState();
    const csv = buildCsv(original);
    const plan = planCsvImport(csv, { version: 1, habits: [], entries: {}, settings: original.settings }, 'replace', { newId });
    check('ok', plan.ok, plan.ok ? '' : plan.error);
    if (!plan.ok) return;
    check('no issues', plan.issues.length === 0, JSON.stringify(plan.issues.slice(0, 3)));
    check('all habits that have entries come back', plan.habits.length === new Set(Object.values(serialize(original).entries).map((e) => e.habitId)).size);
    check('every row imported', plan.entries === Object.keys(serialize(original).entries).length);
    check('exporting again gives the same CSV', sortedLines(buildCsv(plan.result)) === sortedLines(csv));
    // Imported through the store, it survives a restart.
    const r = await store.replaceAllData(plan.result, 'csv-import');
    check('imported', r.ok, r.message);
    const again = await restart(device, store);
    check('after restart, same CSV', sortedLines(buildCsv(again.getState())) === sortedLines(csv));
    await again.close();
    device.cleanup();
  });

  await test('CSV import: add to existing data, preview counts, and a reason for every bad row', async () => {
    const current: AppData = {
      version: 1,
      habits: [{ ...draft('Read'), id: 'read', createdAt: '2026-09-01T08:00:00.000Z', archived: false }],
      entries: { read: { '2026-10-01': { habitId: 'read', date: '2026-10-01', value: 0, status: 'skipped' } } },
      settings: makeLegacyData(1, 1).settings,
    };
    const csv = [
      'date,habit,icon,status,value,target,unit,frequency,archived,note',
      '2026-10-01,Read,📚,done,1,1,,Every day,no,', // updates an existing day
      '2026-10-02,read,📚,done,1,1,,Every day,no,"A note, with ""quotes""', // same habit, different case
      'and a second line"',
      '2026-10-02,Water,💧,missed,3,8,glasses,"Mon, Wed, Fri",no,', // new measurable habit
      '2026-13-40,Water,💧,done,8,8,glasses,Every day,no,',
      '2026-10-03,(deleted),?,done,1,1,,Every day,no,',
      '2026-10-03,Walk,🚶,finished,1,1,,Every day,no,',
      '2026-10-03,Walk,🚶,done,abc,1,,Every day,no,',
      '2026-10-03,Walk,🚶,done,1,1,,Sometimes,no,',
      '',
      '2026-10-04,Stretch,🧘,done,1,1,,3× per week,yes,',
    ].join('\r\n');
    const plan = planCsvImport(csv, current, 'add', { newId });
    if (!plan.ok) return check('ok', false, plan.error);
    check('rows counted (blank line ignored)', plan.rows === 9, String(plan.rows));
    check('entries to import', plan.entries === 4, String(plan.entries));
    check('existing day updated', plan.updatedEntries === 1);
    check('habits: Read existing, Water and Stretch new', JSON.stringify(plan.habits) === JSON.stringify([
      { name: 'Read', isNew: false }, { name: 'Water', isNew: true }, { name: 'Stretch', isNew: true },
    ]), JSON.stringify(plan.habits));
    const reasons = plan.issues.map((i) => `${i.line}: ${i.reason}`);
    check('5 bad rows reported', plan.issues.length === 5, reasons.join(' | '));
    check('line numbers count the multi-line note', reasons[0]?.startsWith('6:') && reasons.some((r) => r.startsWith('7:')), reasons.join(' | '));
    check('reasons are specific', /invalid date/.test(reasons.join()) && /deleted/.test(reasons.join()) && /unknown status/.test(reasons.join()) && /invalid value/.test(reasons.join()) && /unknown frequency/.test(reasons.join()));
    const water = plan.result.habits.find((h) => h.name === 'Water')!;
    check('new habit: measurable, unit, weekday schedule', water.type === 'measurable' && water.unit === 'glasses' && frequencyLabel(water) === 'Mon, Wed, Fri');
    check('archived + 3× per week parsed', plan.result.habits.find((h) => h.name === 'Stretch')?.archived === true);
    check('note with quotes and line break kept', logOf(plan.result.entries, 'read')['2026-10-02']?.note === 'A note, with "quotes"\r\nand a second line');
    check('existing data not modified (preview only)', current.entries.read['2026-10-01'].status === 'skipped');
    const bad = planCsvImport('name,when\nx,y', current, 'add', { newId });
    check('not a Habits CSV → clear error', !bad.ok && /missing the columns/.test(bad.error));
    check('frequency labels parse back', ['Every day', 'Weekdays', 'Weekends', '2× per week', 'Tue, Thu'].every((l) => parseFrequency(l) !== null));
  });

  // ---------- Undo ----------

  /** A fake phone schedule plus the real reminder engine, reading from the store. */
  function remindersFor(store: AppStore) {
    const scheduled = new Map<string, string | null>();
    const api: NotificationApi = {
      getPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getScheduled: async () => [...scheduled].map(([id, fingerprint]) => ({ id, fingerprint })),
      schedule: async (item) => void scheduled.set(item.id, item.fingerprint),
      cancel: async (rid) => void scheduled.delete(rid),
    };
    const engine = createReminderEngine({ api, getData: store.getState, now: () => new Date(2026, 9, 4, 8, 0), log: () => {} });
    return { engine, scheduled };
  }

  await test('undo complete, skip and clear: exact previous day back, saved, and its reminder returns', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const h = store.addHabit(draft('Stretch', { type: 'measurable', target: 8, unit: 'min', reminderTime: '09:00' }))!;
    const day = '2026-10-04';
    store.setValue(h, day, 3);
    store.setNote(h, day, 'half done');
    await store.flush();
    const { engine, scheduled } = remindersFor(store);
    await engine.requestSync();
    const rid = habitReminderId(h.id, day);
    check('reminder scheduled', scheduled.has(rid));

    for (const [label, act] of [
      ['complete', () => store.markDone(h, day)],
      ['skip', () => store.markSkipped(h, day)],
      ['clear', () => store.clearStatus(h, day)],
    ] as const) {
      const prev = logOf(store.getState().entries, h.id)[day];
      act();
      const after = logOf(store.getState().entries, h.id)[day];
      check(`${label}: undo message`, describeEntryChange(prev, after) === { complete: 'Marked done', skip: 'Skipped', clear: 'Cleared' }[label]);
      await engine.cancelNoLongerNeeded();
      if (label !== 'clear') check(`${label}: reminder cancelled`, !scheduled.has(rid));
      store.restoreEntry(h.id, day, prev ?? null);
      check(`${label}: exact previous day`, JSON.stringify(logOf(store.getState().entries, h.id)[day]) === JSON.stringify(prev));
      await engine.cancelNoLongerNeeded();
      check(`${label}: reminder back after undo`, scheduled.has(rid));
    }
    store = await restart(device, store);
    check('after restart: value and note intact', JSON.stringify(logOf(store.getState().entries, h.id)[day]) === JSON.stringify({ habitId: h.id, date: day, value: 3, status: 'missed', note: 'half done' }));
    await store.close();
    device.cleanup();
  });

  await test('undo archive: habit exactly as before, reminders back', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const h = store.addHabit(draft('Walk', { reminderTime: '21:00' }))!;
    store.updateHabit(h.id, { createdAt: '2026-09-01T08:00:00.000Z' }); // before the test clock
    await store.flush();
    const { engine, scheduled } = remindersFor(store);
    await engine.requestSync();
    const prev = store.getState().habits.find((x) => x.id === h.id)!;
    store.updateHabit(h.id, { archived: true });
    await engine.cancelNoLongerNeeded();
    check('archived: reminders cancelled', ![...scheduled.keys()].some((k) => k.includes(h.id)));
    store.updateHabit(prev.id, prev); // what the undo does
    await engine.cancelNoLongerNeeded();
    check('undo: reminders back', [...scheduled.keys()].some((k) => k.includes(h.id)));
    store = await restart(device, store);
    const sorted = (o: object) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    check('undo: habit identical after restart', sorted(store.getState().habits[0]) === sorted(prev));
    await store.close();
    device.cleanup();
  });

  await test('undo delete: habit, all its entries and its place in the list come back, reminders too', async () => {
    const { device, store: s } = await bigDevice();
    let store = s;
    const index = 7;
    const victim = store.getState().habits[index];
    store.updateHabit(victim.id, { reminderTime: '21:00', archived: false });
    await store.flush();
    const before = store.getState();
    const log = logOf(before.entries, victim.id);
    const { engine, scheduled } = remindersFor(store);
    await engine.requestSync();
    store.deleteHabit(victim.id);
    await engine.cancelNoLongerNeeded();
    check('deleted: gone, reminders cancelled', !store.getState().habits.some((x) => x.id === victim.id) && ![...scheduled.keys()].some((k) => k.includes(victim.id)));
    store.restoreDeletedHabit(before.habits[index], log, index);
    await engine.cancelNoLongerNeeded();
    check('undo: identical data in memory', sameData(store.getState(), before));
    check('undo: reminders back', [...scheduled.keys()].some((k) => k.includes(victim.id)));
    store = await restart(device, store);
    check('undo: identical after restart, same position', sameData(store.getState(), before) && store.getState().habits[index].id === victim.id);
    await store.close();
    device.cleanup();
  });

  await test('one undo at a time: a new action replaces the previous offer', () => {
    let undone = '';
    const a = offerUndo('Marked done', () => (undone += 'a'));
    const b = offerUndo('Skipped', () => (undone += 'b'));
    check('latest shown', getUndo()?.message === 'Skipped');
    check('old offer can no longer run', !performUndo(a) && undone === '');
    check('current runs once', performUndo(b) && undone === 'b' && !performUndo(b) && getUndo() === null);
    const c = offerUndo('Archived', () => {});
    dismissUndo(a); // stale id: ignored
    check('stale dismiss ignored', getUndo()?.id === c);
    dismissUndo(c);
    check('dismissed', getUndo() === null);
    check('no undo when nothing changed', describeEntryChange(undefined, null) === null);
    const partial = { habitId: 'h', date: '2026-10-04', value: 3, status: 'missed' as const };
    check('clearing a partial value can be undone', describeEntryChange(partial, { ...partial, value: 0 }) === 'Cleared');
    check('adding to a value is not a status change', describeEntryChange(partial, { ...partial, value: 4 }) === null);
  });

  // ---------- Reduced motion ----------

  await test('reduce motion: no confetti, pop or sweeping animations; a static confirmation instead', () => {
    const reduced = motionPlan(true);
    check('reduced', !reduced.confetti && !reduced.checkPop && !reduced.animateRing && !reduced.slideSnackbar && reduced.staticCelebration);
    const normal = motionPlan(false);
    check('normal', normal.confetti && normal.checkPop && normal.animateRing && normal.slideSnackbar && !normal.staticCelebration);
  });

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
