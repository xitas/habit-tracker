// The app store's data core: in-memory state for the UI, persisted through a
// Backend with one small write per change.
//
// Safety rules:
// - Nothing is written anywhere until a load has fully succeeded.
// - A failed load never shows an empty app: status becomes 'error' and the UI
//   shows the recovery screen.
// - Old AsyncStorage data is only read, never modified or deleted.
// - Destructive recovery actions first save a copy of everything readable, and
//   move to a new database file instead of deleting the old one.

import { entryKey, logOf, serialize, type AppData, type Entry, type EntryStatus, type Habit, type Settings } from '../types';
import { LATEST_SCHEMA_VERSION, META_KEYS } from './schema';
import type { Backend, PersistenceEnv } from './types';
import { countEntries, describeError, emptyData, parseAppData } from './validate';

/** AsyncStorage key used by the original (pre-SQLite) version of the app. Never written to. */
export const LEGACY_STORAGE_KEY = 'habit-tracker/data/v1';
export const STORAGE_KEYS = {
  /** Name of the database generation currently in use. */
  generation: 'habit-tracker/storage/generation',
  /** Set once legacy data has been copied and verified (or deliberately skipped). */
  legacyDone: 'habit-tracker/storage/legacy-migrated',
} as const;
export const DEFAULT_GENERATION = 'habits.db';
export const BACKUP_FILE = 'backups/last-good.json';

export type LoadStage = 'open' | 'schema' | 'migrate' | 'load';
export type LoadStatus = 'loading' | 'ready' | 'error';

export interface BackupInfo {
  savedAt: string;
  habits: number;
  entries: number;
}

export interface StatusSnapshot {
  status: LoadStatus;
  error: { stage: LoadStage; message: string } | null;
  /** The last-known-good backup, when the recovery screen is showing. */
  backup: BackupInfo | null;
  /** A recovery action is running. */
  busy: boolean;
  /** Why the latest save failed, while some changes are only in memory. Drives the warning banner. */
  saveError: string | null;
  /** How many changed items are waiting to be saved. */
  unsavedChanges: number;
  /** A retry of the failed saves is running. */
  retryingSaves: boolean;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export type HabitDraft = Omit<Habit, 'id' | 'createdAt' | 'archived'>;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function createAppStore(env: PersistenceEnv, log: (msg: string, err?: unknown) => void = console.warn) {
  let state: AppData = emptyData();
  let status: StatusSnapshot = {
    status: 'loading',
    error: null,
    backup: null,
    busy: false,
    saveError: null,
    unsavedChanges: 0,
    retryingSaves: false,
  };
  let backend: Backend | null = null;
  let generation = DEFAULT_GENERATION;
  let writes: Promise<void> = Promise.resolve();
  let backupWrite: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((l) => l());
  const setStatus = (patch: Partial<StatusSnapshot>) => {
    status = { ...status, ...patch };
    emit();
  };
  const stamp = () => env.now().toISOString();

  // ---- Loading ----

  async function closeBackend() {
    const b = backend;
    backend = null;
    await b?.close();
  }

  /** Copies the pre-SQLite AsyncStorage data in, verified, without touching the original. */
  async function migrateLegacy(b: Backend) {
    if (await env.kv.getItem(STORAGE_KEYS.legacyDone)) return;
    const raw = await env.kv.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return;
    if (!(await b.getMeta(META_KEYS.legacyMigratedAt))) {
      const existing = await b.counts();
      if (existing.habits > 0 || existing.entries > 0) {
        // The database already holds data that didn't come from this migration.
        // Never overwrite it; both copies stay as they are (and both appear in a raw export).
        log('Old saved data found, but the database already has data; not migrating.');
        return;
      }
      const data = parseAppData(raw, 'old saved data');
      // One transaction: the copy, its count check and the "migrated" marker commit together or not at all.
      await b.replaceAll(data, { [META_KEYS.legacyMigratedAt]: stamp() });
      const c = await b.counts();
      if (c.habits !== data.habits.length || c.entries !== countEntries(data)) {
        await b.resetAll();
        await b.setMeta(META_KEYS.legacyMigratedAt, '');
        throw new Error(
          `The copied data didn't match: expected ${data.habits.length} habits and ${countEntries(data)} entries, found ${c.habits} and ${c.entries}. Your original data is unchanged.`,
        );
      }
    }
    await env.kv.setItem(STORAGE_KEYS.legacyDone, stamp());
  }

  async function boot(): Promise<void> {
    setStatus({ status: 'loading', error: null, backup: null });
    state = emptyData();
    await closeBackend();
    let stage: LoadStage = 'open';
    try {
      generation = (await env.kv.getItem(STORAGE_KEYS.generation)) ?? DEFAULT_GENERATION;
      const b = env.openBackend(generation);
      backend = b;
      await b.open();
      stage = 'schema';
      await b.migrateSchema();
      stage = 'migrate';
      await migrateLegacy(b);
      stage = 'load';
      const data = await b.loadAll();
      state = data;
      clearUnsaved();
      setStatus({ status: 'ready', error: null, backup: null, saveError: null, unsavedChanges: 0 });
      backupWrite = saveBackup(data);
    } catch (err) {
      log(`Couldn't load data (${stage})`, err);
      state = emptyData();
      setStatus({ status: 'error', error: { stage, message: describeError(err) }, backup: await readBackupInfo() });
    }
  }

  // ---- Last-known-good backup ----

  async function saveBackup(data: AppData) {
    // Never replace a backup that has data with an empty snapshot (e.g. after a reset).
    if (data.habits.length === 0 && countEntries(data) === 0) return;
    // Saved in the flat SerializedData shape, which every version reads.
    const payload = { format: 'habit-tracker-backup', schemaVersion: LATEST_SCHEMA_VERSION, savedAt: stamp(), data: serialize(data) };
    try {
      await env.files.write(BACKUP_FILE, JSON.stringify(payload));
    } catch (err) {
      log('Couldn\'t write the backup copy', err);
    }
  }

  async function readBackup(): Promise<{ savedAt: string; data: AppData } | null> {
    const raw = await env.files.read(BACKUP_FILE);
    if (raw === null) return null;
    const doc = JSON.parse(raw) as { format?: string; savedAt?: string; data?: unknown };
    if (doc?.format !== 'habit-tracker-backup' || typeof doc.savedAt !== 'string') throw new Error('The backup file is not recognised');
    return { savedAt: doc.savedAt, data: parseAppData(JSON.stringify(doc.data), 'backup') };
  }

  async function readBackupInfo(): Promise<BackupInfo | null> {
    try {
      const b = await readBackup();
      return b ? { savedAt: b.savedAt, habits: b.data.habits.length, entries: countEntries(b.data) } : null;
    } catch (err) {
      log('Backup is unreadable', err);
      return null;
    }
  }

  // ---- Recovery ----

  async function safely<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
    try {
      return await fn();
    } catch (err) {
      return { error: describeError(err) };
    }
  }

  /** Everything that can be read, from every place data may live. Never throws. */
  async function buildRawExport(): Promise<string> {
    const bundle = {
      format: 'habit-tracker-raw-export',
      exportedAt: stamp(),
      loadError: status.error,
      databaseGeneration: generation,
      database: backend ? await backend.dumpRaw() : { error: 'not opened' },
      oldAsyncStorageData: await safely(() => env.kv.getItem(LEGACY_STORAGE_KEY)),
      lastGoodBackup: await safely(() => env.files.read(BACKUP_FILE)),
    };
    return JSON.stringify(bundle);
  }

  async function exportRawData(): Promise<{ name: string; content: string }> {
    const day = stamp().slice(0, 10);
    return { name: `habit-tracker-raw-${day}.json`, content: await buildRawExport() };
  }

  /** Saves a copy of everything readable before a destructive action. Throws if it can't. */
  async function keepCopy(label: string): Promise<string> {
    const name = `recovery/${stamp().replace(/[:.]/g, '-')}-${label}.json`;
    return env.files.write(name, await buildRawExport());
  }

  /** Switches to a fresh database file, optionally filled with `data`. The old file is kept as-is. */
  async function switchToNewGeneration(data: AppData | null) {
    const next = `habits-${stamp().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}.db`;
    const b = env.openBackend(next);
    try {
      await b.open();
      await b.migrateSchema();
      if (data) await b.replaceAll(data);
    } finally {
      await b.close();
    }
    await closeBackend();
    await env.kv.setItem(STORAGE_KEYS.generation, next);
    // The old pre-SQLite data must never be imported over a restored or fresh start.
    await env.kv.setItem(STORAGE_KEYS.legacyDone, stamp());
  }

  async function runRecovery(action: () => Promise<string>): Promise<ActionResult> {
    if (status.busy) return { ok: false, message: 'Another action is still running.' };
    setStatus({ busy: true });
    try {
      const message = await action();
      return { ok: true, message };
    } catch (err) {
      log('Recovery action failed', err);
      return { ok: false, message: describeError(err) };
    } finally {
      setStatus({ busy: false });
    }
  }

  const retry = () =>
    runRecovery(async () => {
      await boot();
      if (status.status !== 'ready') throw new Error(status.error?.message ?? 'Still unable to load your data.');
      return 'Your data loaded successfully.';
    });

  const restoreBackup = () =>
    runRecovery(async () => {
      const backup = await readBackup();
      if (!backup) throw new Error('There is no backup to restore.');
      const copy = await keepCopy('before-restore');
      await switchToNewGeneration(backup.data);
      await boot();
      if (status.status !== 'ready') throw new Error(status.error?.message ?? 'The backup could not be loaded.');
      return `Restored the backup from ${backup.savedAt}. A copy of the unreadable data was kept at ${copy}.`;
    });

  const startFresh = () =>
    runRecovery(async () => {
      const copy = await keepCopy('before-start-fresh');
      await switchToNewGeneration(null);
      await boot();
      if (status.status !== 'ready') throw new Error(status.error?.message ?? 'Could not start fresh.');
      return `Started fresh. Your previous data was kept at ${copy}.`;
    });

  // ---- Writes ----

  function canWrite(what: string): boolean {
    if (status.status === 'ready' && backend) return true;
    log(`Ignored "${what}": data isn't loaded, so nothing is saved.`);
    return false;
  }

  // ---- Unsaved changes ----
  // A failed write marks what it touched. The change itself stays in memory,
  // and retrySaves() writes the *current* value of each marked item, so a retry
  // can never overwrite a newer change with an older one.

  type Touched = { habit?: string; entry?: { habitId: string; date: string }; settings?: true; reset?: true };
  const unsaved = {
    habits: new Set<string>(),
    entries: new Map<string, { habitId: string; date: string }>(),
    settings: false,
    reset: false,
  };

  function clearUnsaved() {
    unsaved.habits.clear();
    unsaved.entries.clear();
    unsaved.settings = false;
    unsaved.reset = false;
  }

  const countUnsaved = () =>
    unsaved.habits.size + unsaved.entries.size + (unsaved.settings ? 1 : 0) + (unsaved.reset ? 1 : 0);

  function markUnsaved(t: Touched) {
    if (t.habit) unsaved.habits.add(t.habit);
    if (t.entry) unsaved.entries.set(entryKey(t.entry.habitId, t.entry.date), t.entry);
    if (t.settings) unsaved.settings = true;
    if (t.reset) unsaved.reset = true;
  }

  /** Queues one targeted write. Writes run in order, one at a time, with no delay. */
  function persist(what: string, touched: Touched, op: (b: Backend) => Promise<void>) {
    const b = backend!;
    writes = writes
      .then(() => op(b))
      .catch((err) => {
        log(`Couldn't save "${what}"`, err);
        markUnsaved(touched);
        setStatus({ saveError: describeError(err), unsavedChanges: countUnsaved() });
      });
  }

  /** Writes the current in-memory value of everything a failed save left unsaved. */
  async function writeUnsaved(b: Backend) {
    if (unsaved.reset) {
      // A reset failed part-way: rewrite everything from memory in one transaction.
      await b.replaceAll(state);
      clearUnsaved();
      return;
    }
    for (const id of [...unsaved.habits]) {
      const habit = state.habits.find((h) => h.id === id);
      await (habit ? b.putHabit(habit) : b.deleteHabit(id));
      unsaved.habits.delete(id);
    }
    for (const [key, { habitId, date }] of [...unsaved.entries]) {
      const entry = logOf(state.entries, habitId)[date];
      await (entry ? b.putEntry(entry) : b.deleteEntry(habitId, date));
      unsaved.entries.delete(key);
    }
    if (unsaved.settings) {
      await b.putSettings(state.settings);
      unsaved.settings = false;
    }
  }

  /** Retries the failed saves. Changes stay in memory whether or not it succeeds. */
  function retrySaves(): Promise<ActionResult> {
    if (!backend || status.status !== 'ready') return Promise.resolve({ ok: false, message: "Data isn't loaded." });
    if (countUnsaved() === 0) {
      setStatus({ saveError: null, unsavedChanges: 0 });
      return Promise.resolve({ ok: true, message: 'Everything is saved.' });
    }
    const b = backend;
    setStatus({ retryingSaves: true });
    // Runs in the write queue, after anything already pending.
    const attempt = writes.then(async (): Promise<ActionResult> => {
      try {
        await writeUnsaved(b);
        setStatus({ saveError: null, unsavedChanges: 0, retryingSaves: false });
        return { ok: true, message: 'All changes saved.' };
      } catch (err) {
        log('Retrying failed saves failed', err);
        setStatus({ saveError: describeError(err), unsavedChanges: countUnsaved(), retryingSaves: false });
        return { ok: false, message: describeError(err) };
      }
    });
    writes = attempt.then(() => {});
    return attempt;
  }

  function commit(next: AppData) {
    state = next;
    emit();
  }

  function addHabit(draft: HabitDraft): Habit | null {
    if (!canWrite('add habit')) return null;
    const habit: Habit = { ...draft, id: newId(), createdAt: env.now().toISOString(), archived: false };
    commit({ ...state, habits: [...state.habits, habit] });
    persist('add habit', { habit: habit.id }, (b) => b.putHabit(habit));
    return habit;
  }

  function updateHabit(id: string, patch: Partial<Habit>) {
    if (!canWrite('update habit')) return;
    const current = state.habits.find((h) => h.id === id);
    if (!current) return;
    const next = { ...current, ...patch, id };
    commit({ ...state, habits: state.habits.map((h) => (h.id === id ? next : h)) });
    persist('update habit', { habit: id }, (b) => b.putHabit(next));
  }

  function deleteHabit(id: string) {
    if (!canWrite('delete habit')) return;
    const { [id]: _removed, ...entries } = state.entries;
    commit({ ...state, habits: state.habits.filter((h) => h.id !== id), entries });
    persist('delete habit', { habit: id }, (b) => b.deleteHabit(id));
  }

  function writeEntry(habitId: string, date: string, next: Entry | null) {
    // Only this habit's log is replaced; every other habit keeps its object (and its caches).
    const { [date]: _previous, ...rest } = logOf(state.entries, habitId);
    const log = next ? { ...rest, [date]: next } : rest;
    commit({ ...state, entries: { ...state.entries, [habitId]: log } });
    persist('save entry', { entry: { habitId, date } }, (b) => (next ? b.putEntry(next) : b.deleteEntry(habitId, date)));
  }

  const existing = (habitId: string, date: string): Entry | undefined => logOf(state.entries, habitId)[date];

  /** Store an entry, or drop it when it carries no information. */
  function put(habitId: string, date: string, value: number, entryStatus: EntryStatus, note?: string) {
    if (!canWrite('save entry')) return;
    const empty = entryStatus === 'missed' && value === 0 && !note;
    writeEntry(habitId, date, empty ? null : { habitId, date, value, status: entryStatus, ...(note ? { note } : {}) });
  }

  function setValue(habit: Habit, date: string, value: number) {
    const v = Math.max(0, Math.round(value * 100) / 100);
    put(habit.id, date, v, v >= habit.target ? 'done' : 'missed', existing(habit.id, date)?.note);
  }

  function markDone(habit: Habit, date: string) {
    const prev = existing(habit.id, date);
    put(habit.id, date, Math.max(habit.target, prev?.value ?? 0), 'done', prev?.note);
  }

  function markSkipped(habit: Habit, date: string) {
    const prev = existing(habit.id, date);
    put(habit.id, date, prev?.value ?? 0, 'skipped', prev?.note);
  }

  function markMissed(habit: Habit, date: string) {
    const prev = existing(habit.id, date);
    const partial = habit.type === 'measurable' && prev && prev.value < habit.target ? prev.value : 0;
    put(habit.id, date, partial, 'missed', prev?.note);
  }

  /** Undo done/skipped back to a blank day, keeping any note. */
  function clearStatus(habit: Habit, date: string) {
    put(habit.id, date, 0, 'missed', existing(habit.id, date)?.note);
  }

  function setNote(habit: Habit, date: string, note: string) {
    const prev = existing(habit.id, date);
    put(habit.id, date, prev?.value ?? 0, prev?.status ?? 'missed', note.trim() || undefined);
  }

  /** Write a whole entry at once (entry sheet / backfill). Measurable status follows the value unless skipped. */
  function saveEntry(habit: Habit, date: string, value: number, entryStatus: EntryStatus, note: string) {
    let v = Math.max(0, Math.round(value * 100) / 100);
    let s = entryStatus;
    if (habit.type === 'boolean') v = s === 'done' ? 1 : 0;
    else if (s !== 'skipped') s = v >= habit.target ? 'done' : 'missed';
    put(habit.id, date, v, s, note.trim() || undefined);
  }

  function updateSettings(patch: Partial<Settings>) {
    if (!canWrite('update settings')) return;
    commit({ ...state, settings: { ...state.settings, ...patch } });
    persist('update settings', { settings: true }, (b) => b.putSettings(patch));
  }

  function resetAll() {
    if (!canWrite('reset all data')) return;
    commit(emptyData());
    persist('reset all data', { reset: true }, (b) => b.resetAll());
  }

  return {
    // Reading
    getState: () => state,
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // Lifecycle
    boot,
    /** Resolves once every queued write (and the post-load backup) has finished. */
    flush: async () => {
      await writes;
      await backupWrite;
    },
    /** Finishes pending writes and closes storage (used by tests). */
    close: async () => {
      await writes;
      await backupWrite;
      await closeBackend();
    },
    // Recovery
    retry,
    retrySaves,
    restoreBackup,
    startFresh,
    exportRawData,
    // Mutations
    addHabit,
    updateHabit,
    deleteHabit,
    setValue,
    markDone,
    markSkipped,
    markMissed,
    clearStatus,
    setNote,
    saveEntry,
    updateSettings,
    resetAll,
  };
}

export type AppStore = ReturnType<typeof createAppStore>;
