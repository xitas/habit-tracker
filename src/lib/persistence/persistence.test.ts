// Persistence tests: real SQLite files, simulated app restarts, injected faults.
// Run with `npm test`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { logOf, type Habit } from '../types';
import { BACKUP_FILE, LEGACY_STORAGE_KEY, STORAGE_KEYS, type AppStore } from './core';
import { makeDevice, makeLegacyData, readDb, sameData } from './testing/harness';
import { countEntries, emptyData } from './validate';

let failures = 0;
let current = '';
function check(what: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  if (!ok) console.log(`    FAIL ${what}${detail ? ` (${detail})` : ''}`);
}
async function test(name: string, fn: () => Promise<void>) {
  current = name;
  const before = failures;
  try {
    await fn();
  } catch (err) {
    failures++;
    console.log(`    FAIL threw: ${err instanceof Error ? err.stack : String(err)}`);
  }
  console.log(`${failures === before ? 'PASS' : 'FAIL'} ${current}`);
}

const draft = (name: string): Omit<Habit, 'id' | 'createdAt' | 'archived'> => ({
  name,
  icon: '💧',
  color: '#5B6CFF',
  frequency: { kind: 'daily' },
  type: 'measurable',
  target: 8,
  unit: 'glasses',
  reminderTime: null,
});

/** Ends a "session": waits for writes, closes the database. */
const quit = (store: AppStore) => store.close();

async function main() {
  // ---------- Saving, editing, deleting ----------

  await test('fresh install starts ready and empty', async () => {
    const device = makeDevice();
    const store = await device.launch();
    check('status ready', store.getStatus().status === 'ready', store.getStatus().error?.message);
    check('no habits', store.getState().habits.length === 0);
    check('schema version recorded', readDb(device.dbPath()).schema === '1');
    await quit(store);
    device.cleanup();
  });

  await test('habits, entries and settings are saved, edited and deleted, and survive a restart', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const water = store.addHabit(draft('Drink water'))!;
    const read = store.addHabit({ ...draft('Read'), type: 'boolean', target: 1, unit: '' })!;
    store.setValue(water, '2026-10-01', 5);
    store.markDone(water, '2026-10-02');
    store.markSkipped(read, '2026-10-02');
    store.setNote(read, '2026-10-03', 'Finished chapter 3');
    store.updateHabit(water.id, { name: 'Drink more water', target: 10 });
    store.updateSettings({ weekStartsOn: 0, theme: 'dark' });
    const snapshot = store.getState();
    await quit(store);

    store = await device.launch();
    check('reloaded data matches', sameData(store.getState(), snapshot));
    check('habit order kept', store.getState().habits.map((h) => h.name).join() === 'Drink more water,Read');
    check('edit saved', store.getState().habits[0].target === 10);
    check('note saved', logOf(store.getState().entries, read.id)['2026-10-03']?.note === 'Finished chapter 3');
    check('settings saved', store.getState().settings.theme === 'dark' && store.getState().settings.weekStartsOn === 0);

    // Clearing an entry removes its row; deleting a habit removes its entries.
    store.clearStatus(read, '2026-10-02');
    store.deleteHabit(water.id);
    const added = store.addHabit(draft('Stretch'))!;
    await quit(store);

    store = await device.launch();
    const s = store.getState();
    check('deleted habit gone', !s.habits.some((h) => h.id === water.id));
    check('its entries gone', Object.keys(logOf(s.entries, water.id)).length === 0);
    check('cleared entry gone', !logOf(s.entries, read.id)['2026-10-02']);
    check('other data kept', !!logOf(s.entries, read.id)['2026-10-03']);
    check('new habit added at the end', s.habits[s.habits.length - 1]?.id === added.id);
    check('database agrees', readDb(device.dbPath()).habits === 2);
    await quit(store);
    device.cleanup();
  });

  await test('each change is one small targeted write, with no delay', async () => {
    const device = makeDevice();
    const store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    await store.flush();
    device.sqlLog.length = 0;
    store.markDone(habit, '2026-10-03');
    await store.flush(); // only waits for the queue, no timers
    check('exactly one statement', device.sqlLog.length === 1, device.sqlLog.join(' | '));
    check('it is a single-row entry upsert', device.sqlLog[0]?.startsWith('INSERT OR REPLACE INTO entries'), device.sqlLog[0]);
    check('row already in the database', readDb(device.dbPath()).entries === 1);
    await quit(store);
    device.cleanup();
  });

  await test('deleting a habit is one transaction (a failure leaves everything intact)', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    store.markDone(habit, '2026-10-02');
    store.markDone(habit, '2026-10-03');
    await store.flush();
    device.faults.failSql = /^DELETE FROM habits WHERE id/;
    store.deleteHabit(habit.id);
    await store.flush();
    check('failure reported', !!store.getStatus().saveError);
    const raw = readDb(device.dbPath());
    check('entries rolled back with the habit', raw.habits === 1 && raw.entries === 2, `${raw.habits}/${raw.entries}`);
    check('transaction rolled back', device.sqlLog.includes('ROLLBACK'));
    device.faults.failSql = undefined;
    await quit(store);
    store = await device.launch();
    check('data still there after restart', store.getState().habits.length === 1 && countEntries(store.getState()) === 2);
    await quit(store);
    device.cleanup();
  });

  await test('reset all data clears everything in one transaction and keeps the backup', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    store.markDone(habit, '2026-10-03');
    store.updateSettings({ theme: 'dark' });
    await quit(store);
    store = await device.launch(); // writes the last-known-good backup
    const backupBefore = device.files.map.get(BACKUP_FILE);
    check('backup exists', !!backupBefore);
    device.sqlLog.length = 0;
    store.resetAll();
    await store.flush();
    check('ran in a transaction', device.sqlLog[0] === 'BEGIN' && device.sqlLog.includes('COMMIT'));
    check('memory cleared', store.getState().habits.length === 0 && store.getState().settings.theme === 'system');
    await quit(store);
    store = await device.launch();
    const raw = readDb(device.dbPath());
    check('database empty', raw.habits === 0 && raw.entries === 0);
    check('starts empty and ready', store.getStatus().status === 'ready' && store.getState().habits.length === 0);
    check('backup not overwritten by empty data', device.files.map.get(BACKUP_FILE) === backupBefore);
    await quit(store);
    device.cleanup();
  });

  // ---------- Failed saves (warning banner + retry) ----------

  await test('a failed save shows the banner, keeps the change in memory, and retry saves it', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    await store.flush();
    check('no banner before', store.getStatus().saveError === null && store.getStatus().unsavedChanges === 0);

    device.faults.failSql = /entries/; // e.g. disk full while writing entries
    store.markDone(habit, '2026-10-02');
    store.setValue(habit, '2026-10-03', 3);
    await store.flush();
    const st = store.getStatus();
    check('banner state set', !!st.saveError && st.unsavedChanges === 2, JSON.stringify(st));
    check('changes kept in memory', logOf(store.getState().entries, habit.id)['2026-10-02']?.status === 'done');
    check('not in the database yet', readDb(device.dbPath()).entries === 0);

    // Retry while storage still fails: banner stays, nothing lost.
    const failed = await store.retrySaves();
    check('retry reports failure', !failed.ok && !!store.getStatus().saveError);
    check('still 2 unsaved', store.getStatus().unsavedChanges === 2);
    check('memory untouched by failed retry', logOf(store.getState().entries, habit.id)['2026-10-03']?.value === 3);

    // Storage recovers: retry saves everything and hides the banner.
    device.faults.failSql = undefined;
    const ok = await store.retrySaves();
    check('retry succeeds', ok.ok, ok.message);
    check('banner cleared', store.getStatus().saveError === null && store.getStatus().unsavedChanges === 0);
    check('saved to the database', readDb(device.dbPath()).entries === 2);
    const saved = store.getState();
    await quit(store);
    store = await device.launch();
    check('saved changes survive a restart', sameData(store.getState(), saved));
    await quit(store);
    device.cleanup();
  });

  await test('retry writes the latest value, never an older failed one', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    await store.flush();
    device.faults.failSql = /INSERT OR REPLACE INTO entries/;
    store.markDone(habit, '2026-10-03'); // fails
    await store.flush();
    device.faults.failSql = undefined;
    store.markSkipped(habit, '2026-10-03'); // succeeds, newer
    await store.flush();
    check('banner still shown for the earlier failure', !!store.getStatus().saveError);
    await store.retrySaves();
    const raw = new DatabaseSync(device.dbPath());
    const rows = raw.prepare('SELECT status FROM entries').all() as { status: string }[];
    raw.close();
    check('database has the newer value', rows.length === 1 && rows[0].status === 'skipped', JSON.stringify(rows));
    await quit(store);
    store = await device.launch();
    check('after restart too', logOf(store.getState().entries, habit.id)['2026-10-03']?.status === 'skipped');
    await quit(store);
    device.cleanup();
  });

  await test('a failed delete or reset is completed by retry from memory', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const a = store.addHabit(draft('A'))!;
    const b = store.addHabit(draft('B'))!;
    store.markDone(a, '2026-10-02');
    store.markDone(b, '2026-10-02');
    await store.flush();
    device.faults.failSql = /^DELETE FROM habits WHERE id/;
    store.deleteHabit(a.id);
    await store.flush();
    check('delete failed and is pending', store.getStatus().unsavedChanges === 1);
    device.faults.failSql = undefined;
    await store.retrySaves();
    const db1 = readDb(device.dbPath());
    check('delete completed', db1.habits === 1 && db1.entries === 1, `${db1.habits}/${db1.entries}`);

    device.faults.failSql = /^DELETE FROM entries; DELETE FROM habits/;
    store.resetAll();
    store.addHabit(draft('After reset'));
    await store.flush();
    check('reset failed and is pending', !!store.getStatus().saveError);
    device.faults.failSql = undefined;
    const r = await store.retrySaves();
    check('retry ok', r.ok, r.message);
    await quit(store);
    store = await device.launch();
    check('database matches memory after retry', store.getState().habits.map((h) => h.name).join() === 'After reset' && countEntries(store.getState()) === 0);
    await quit(store);
    device.cleanup();
  });

  // ---------- Migration from AsyncStorage ----------

  await test('migrates old AsyncStorage data, verified, and leaves the original untouched', async () => {
    const device = makeDevice();
    const legacy = makeLegacyData(4, 30);
    const raw = JSON.stringify(legacy);
    device.kv.map.set(LEGACY_STORAGE_KEY, raw);
    let store = await device.launch();
    check('ready', store.getStatus().status === 'ready', store.getStatus().error?.message);
    check('same data', sameData(store.getState(), legacy));
    check('original untouched', device.kv.map.get(LEGACY_STORAGE_KEY) === raw);
    check('marked as migrated', !!device.kv.map.get(STORAGE_KEYS.legacyDone));
    const db = readDb(device.dbPath());
    check('row counts match', db.habits === 4 && db.entries === Object.keys(legacy.entries).length);
    await quit(store);

    // Runs once: later changes to the old key are never imported again.
    device.kv.map.set(LEGACY_STORAGE_KEY, JSON.stringify(emptyData()));
    store = await device.launch();
    check('not re-imported', sameData(store.getState(), legacy));
    await quit(store);
    device.cleanup();
  });

  await test('migrates 30 habits × 2 years with notes', async () => {
    const device = makeDevice();
    const legacy = makeLegacyData(30, 730);
    const raw = JSON.stringify(legacy);
    device.kv.map.set(LEGACY_STORAGE_KEY, raw);
    const t0 = performance.now();
    const store = await device.launch();
    const ms = performance.now() - t0;
    const n = Object.keys(legacy.entries).length;
    const notes = Object.values(legacy.entries).filter((e) => e.note).length;
    console.log(`    ${legacy.habits.length} habits, ${n.toLocaleString()} entries (${notes.toLocaleString()} with notes), ${(raw.length / 1024 / 1024).toFixed(2)} MB old value → migrated and loaded in ${ms.toFixed(0)} ms`);
    check('ready', store.getStatus().status === 'ready', store.getStatus().error?.message);
    check('identical after migration', sameData(store.getState(), legacy));
    const db = readDb(device.dbPath());
    check('row counts match', db.habits === 30 && db.entries === n, `${db.habits}/${db.entries}`);
    const noted = Object.values(legacy.entries).find((e) => e.note)!;
    check('notes with quotes, emoji and newlines intact', logOf(store.getState().entries, noted.habitId)[noted.date]?.note === noted.note);
    check('original untouched', device.kv.map.get(LEGACY_STORAGE_KEY) === raw);
    await quit(store);
    device.cleanup();
  });

  await test('never migrates over a database that already has data', async () => {
    const device = makeDevice();
    let store = await device.launch();
    store.addHabit(draft('Made in the new version'));
    const mine = store.getState();
    await quit(store);
    const raw = JSON.stringify(makeLegacyData(2, 10));
    device.kv.map.set(LEGACY_STORAGE_KEY, raw); // old data appears later
    store = await device.launch();
    check('ready', store.getStatus().status === 'ready');
    check('existing data kept', sameData(store.getState(), mine));
    check('old data untouched', device.kv.map.get(LEGACY_STORAGE_KEY) === raw);
    await quit(store);
    device.cleanup();
  });

  await test('corrupt old data → recovery screen, nothing written anywhere', async () => {
    const device = makeDevice();
    const raw = JSON.stringify(makeLegacyData(3, 20)).slice(0, -500); // truncated JSON
    device.kv.map.set(LEGACY_STORAGE_KEY, raw);
    const store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    check('stage is migrate', store.getStatus().error?.stage === 'migrate');
    check('app is not shown as empty-and-usable', store.getStatus().status !== 'ready');
    store.addHabit(draft('Typed during recovery'));
    store.updateSettings({ theme: 'dark' });
    await store.flush();
    const db = readDb(device.dbPath());
    check('database still empty', db.habits === 0 && db.entries === 0);
    check('old data untouched', device.kv.map.get(LEGACY_STORAGE_KEY) === raw);
    check('not marked migrated', !device.kv.map.has(STORAGE_KEYS.legacyDone));
    check('no backup written', !device.files.map.has(BACKUP_FILE));
    await quit(store);
    device.cleanup();
  });

  await test('migration copy check failure rolls back; retry succeeds once fixed', async () => {
    const device = makeDevice();
    const legacy = makeLegacyData(5, 120);
    device.kv.map.set(LEGACY_STORAGE_KEY, JSON.stringify(legacy));
    device.faults.dropSqlOnce = /^INSERT INTO entries/; // one batch silently lost
    const store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    check('explains the mismatch', /Copy check failed/.test(store.getStatus().error?.message ?? ''), store.getStatus().error?.message);
    const db = readDb(device.dbPath());
    check('partial copy rolled back', db.habits === 0 && db.entries === 0, `${db.habits}/${db.entries}`);
    check('original untouched', device.kv.map.get(LEGACY_STORAGE_KEY) === JSON.stringify(legacy));
    const result = await store.retry();
    check('retry succeeds', result.ok && store.getStatus().status === 'ready', result.message);
    check('data complete after retry', sameData(store.getState(), legacy));
    await quit(store);
    device.cleanup();
  });

  await test('storage read error (Android "row too big") → recovery, nothing written', async () => {
    const device = makeDevice();
    device.kv.map.set(LEGACY_STORAGE_KEY, JSON.stringify(makeLegacyData(2, 10)));
    device.faults.failKvRead = [LEGACY_STORAGE_KEY];
    const store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    check('message passed through', /CursorWindow/.test(store.getStatus().error?.message ?? ''));
    store.addHabit(draft('x'));
    await store.flush();
    check('database still empty', readDb(device.dbPath()).habits === 0);
    check('not marked migrated', !device.kv.map.has(STORAGE_KEYS.legacyDone));
    await quit(store);
    device.cleanup();
  });

  // ---------- Failed loads of the new storage ----------

  await test('damaged database file → recovery, file left byte-for-byte untouched', async () => {
    const device = makeDevice();
    const garbage = new Uint8Array(8192).map((_, i) => (i * 31 + 7) % 251);
    writeFileSync(device.dbPath(), garbage);
    const store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    check('stage is open', store.getStatus().error?.stage === 'open', store.getStatus().error?.message);
    store.addHabit(draft('x'));
    store.resetAll();
    await store.flush();
    await quit(store);
    const after = readFileSync(device.dbPath());
    check('file unchanged', after.length === garbage.length && after.every((b, i) => b === garbage[i]));
    device.cleanup();
  });

  await test('invalid record in the database → recovery, no writes, data intact', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    store.markDone(habit, '2026-10-03');
    await quit(store);
    // Damage one field from outside the app.
    const raw = new DatabaseSync(device.dbPath());
    raw.prepare('UPDATE habits SET frequency = ? WHERE id = ?').run('{not json', habit.id);
    raw.close();

    store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    check('stage is load', store.getStatus().error?.stage === 'load');
    check('names the problem', /frequency/.test(store.getStatus().error?.message ?? ''), store.getStatus().error?.message);
    store.addHabit(draft('x'));
    store.deleteHabit(habit.id);
    await store.flush();
    const db = readDb(device.dbPath());
    check('nothing written or deleted', db.habits === 1 && db.entries === 1);
    await quit(store);
    device.cleanup();
  });

  await test('data saved by a newer app version → recovery, untouched', async () => {
    const device = makeDevice();
    let store = await device.launch();
    store.addHabit(draft('Water'));
    await quit(store);
    const raw = new DatabaseSync(device.dbPath());
    raw.prepare("UPDATE meta SET value = '99' WHERE key = 'schema_version'").run();
    raw.close();
    store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    check('stage is schema', store.getStatus().error?.stage === 'schema');
    check('asks to update the app', /newer version/.test(store.getStatus().error?.message ?? ''));
    await quit(store);
    check('schema version untouched', readDb(device.dbPath()).schema === '99');
    device.cleanup();
  });

  // ---------- Backup, export, restore, start fresh ----------

  await test('restores from the last-known-good backup after corruption', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    store.markDone(habit, '2026-10-02');
    store.setNote(habit, '2026-10-02', 'good day');
    const good = store.getState();
    await quit(store);
    store = await device.launch(); // successful load → backup written
    await quit(store);
    const backup = JSON.parse(device.files.map.get(BACKUP_FILE)!);
    check('backup written after load', backup.format === 'habit-tracker-backup' && backup.data.habits.length === 1);

    const garbage = new Uint8Array(4096).fill(7);
    writeFileSync(device.dbPath(), garbage);
    store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    check('backup offered', store.getStatus().backup?.habits === 1 && store.getStatus().backup?.entries === 1);
    const result = await store.restoreBackup();
    check('restore ok', result.ok, result.message);
    check('ready with backup data', store.getStatus().status === 'ready' && sameData(store.getState(), good));
    const copies = [...device.files.map.keys()].filter((k) => k.startsWith('recovery/') && k.includes('before-restore'));
    check('copy of unreadable data kept', copies.length === 1);
    const old = readFileSync(device.dbPath());
    check('damaged file kept, untouched', old.every((b) => b === 7));
    const generation = device.kv.map.get(STORAGE_KEYS.generation)!;
    check('switched to a new database file', !!generation && generation !== 'habits.db' && existsSync(device.dbPath(generation)));
    await quit(store);

    store = await device.launch();
    check('restored data survives restart', store.getStatus().status === 'ready' && sameData(store.getState(), good));
    await quit(store);
    device.cleanup();
  });

  await test('export raw data includes everything readable', async () => {
    const device = makeDevice();
    let store = await device.launch();
    const habit = store.addHabit(draft('Water'))!;
    store.markDone(habit, '2026-10-03');
    await quit(store);
    store = await device.launch();
    await quit(store);
    device.kv.map.set(LEGACY_STORAGE_KEY, '{"partial": tru');
    const raw = new DatabaseSync(device.dbPath());
    raw.prepare("UPDATE entries SET status = 'done' WHERE 1").run();
    raw.prepare("UPDATE habits SET type = 'boolean', target = -1").run(); // invalid target
    raw.close();
    store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    const { name, content } = await store.exportRawData();
    const bundle = JSON.parse(content);
    check('file name', /^habit-tracker-raw-\d{4}-\d{2}-\d{2}\.json$/.test(name));
    check('database rows included', bundle.database.habits.length === 1 && bundle.database.entries.length === 1);
    check('old AsyncStorage value included verbatim', bundle.oldAsyncStorageData === '{"partial": tru');
    check('backup included', typeof bundle.lastGoodBackup === 'string' && bundle.lastGoodBackup.includes('habit-tracker-backup'));
    check('error included', bundle.loadError?.stage === 'load');
    await quit(store);
    device.cleanup();
  });

  await test('start fresh keeps a copy and the old file, and never re-imports old data', async () => {
    const device = makeDevice();
    device.kv.map.set(LEGACY_STORAGE_KEY, 'not json at all');
    let store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    const result = await store.startFresh();
    check('start fresh ok', result.ok, result.message);
    check('ready and empty', store.getStatus().status === 'ready' && store.getState().habits.length === 0);
    check('copy saved first', [...device.files.map.keys()].some((k) => k.includes('before-start-fresh')));
    check('old data untouched', device.kv.map.get(LEGACY_STORAGE_KEY) === 'not json at all');
    check('original database file kept', existsSync(device.dbPath('habits.db')));
    store.addHabit(draft('New start'));
    await quit(store);
    store = await device.launch();
    check('stays on the fresh data after restart', store.getStatus().status === 'ready' && store.getState().habits[0]?.name === 'New start');
    await quit(store);
    device.cleanup();
  });

  await test('start fresh is refused if a copy cannot be saved', async () => {
    const device = makeDevice();
    device.kv.map.set(LEGACY_STORAGE_KEY, 'not json');
    const store = await device.launch();
    device.files.write = async () => {
      throw new Error('disk full');
    };
    const result = await store.startFresh();
    check('refused', !result.ok && /disk full/.test(result.message));
    check('still on recovery screen', store.getStatus().status === 'error');
    check('no new database selected', !device.kv.map.has(STORAGE_KEYS.generation));
    await quit(store);
    device.cleanup();
  });

  // ---------- Web fallback ----------

  await test('web fallback: migration, saves, restart and a corrupt document', async () => {
    const device = makeDevice({ web: true });
    const legacy = makeLegacyData(3, 60);
    const raw = JSON.stringify(legacy);
    device.kv.map.set(LEGACY_STORAGE_KEY, raw);
    let store = await device.launch();
    check('ready', store.getStatus().status === 'ready', store.getStatus().error?.message);
    check('migrated', sameData(store.getState(), legacy));
    check('original untouched', device.kv.map.get(LEGACY_STORAGE_KEY) === raw);
    const h = store.addHabit(draft('Web habit'))!;
    store.markDone(h, '2026-10-03');
    const snapshot = store.getState();
    await quit(store);
    store = await device.launch();
    check('saved across restart', sameData(store.getState(), snapshot));
    await quit(store);

    const key = 'habit-tracker/web/habits.db';
    device.kv.map.set(key, device.kv.map.get(key)!.slice(0, 200));
    const damaged = device.kv.map.get(key);
    store = await device.launch();
    check('error status', store.getStatus().status === 'error');
    store.addHabit(draft('x'));
    await store.flush();
    check('damaged document not overwritten', device.kv.map.get(key) === damaged);
    const result = await store.restoreBackup();
    check('restore works on web', result.ok && sameData(store.getState(), snapshot), result.message);
    await quit(store);
    device.cleanup();
  });

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
