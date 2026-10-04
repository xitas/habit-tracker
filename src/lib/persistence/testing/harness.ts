// Test environment: the app's real persistence code, running against real
// SQLite database files (Node's built-in node:sqlite) in a temp folder, with
// in-memory AsyncStorage and file store. Faults can be injected per test.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { addDays } from '../../dates';
import { entryKey, type AppData, type Entry, type Habit } from '../../types';
import { createAppStore } from '../core';
import { KvBackend } from '../kvBackend';
import { SqliteBackend } from '../sqliteBackend';
import type { FileStore, KeyValueStore, PersistenceEnv, SqlDb, SqlValue } from '../types';
import { DEFAULT_SETTINGS } from '../validate';

export interface Faults {
  /** Statements matching this throw (simulates a storage error). */
  failSql?: RegExp;
  /** The next statement matching this is silently skipped (simulates a lost write). */
  dropSqlOnce?: RegExp;
  /** AsyncStorage reads of these keys throw (e.g. Android "Row too big to fit into CursorWindow"). */
  failKvRead?: string[];
}

/** Wraps node:sqlite in the async SqlDb interface the app uses (mirrors expo-sqlite). */
export function nodeSqlDb(path: string, faults: Faults, log: string[]): SqlDb {
  const db = new DatabaseSync(path);
  const check = (sql: string) => {
    log.push(sql.trim().split(/\s+/).slice(0, 5).join(' '));
    if (faults.failSql?.test(sql)) throw new Error(`Injected failure: ${sql.slice(0, 40)}`);
    if (faults.dropSqlOnce?.test(sql)) {
      faults.dropSqlOnce = undefined;
      return false;
    }
    return true;
  };
  const args = (params: SqlValue[]) => params as (string | number | null)[];
  return {
    async execAsync(sql) {
      if (check(sql)) db.exec(sql);
    },
    async runAsync(sql, params) {
      if (!check(sql)) return { changes: 0 };
      return { changes: Number(db.prepare(sql).run(...args(params)).changes) };
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      check(sql);
      return db.prepare(sql).all(...args(params)) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      check(sql);
      return (db.prepare(sql).get(...args(params)) ?? null) as T | null;
    },
    async withTransactionAsync(task) {
      log.push('BEGIN');
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
        log.push('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        log.push('ROLLBACK');
        throw err;
      }
    },
    async closeAsync() {
      db.close();
    },
  };
}

export function memoryKv(faults: Faults): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItem(key) {
      if (faults.failKvRead?.includes(key)) throw new Error('Row too big to fit into CursorWindow');
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
}

export function memoryFiles(): FileStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async read(name) {
      return map.get(name) ?? null;
    },
    async write(name, content) {
      map.set(name, content);
      return `memory://${name}`;
    },
  };
}

/** One simulated device: database files on disk plus AsyncStorage and app files that survive "restarts". */
export function makeDevice(options: { web?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'habit-tracker-test-'));
  const faults: Faults = {};
  const sqlLog: string[] = [];
  const kv = memoryKv(faults);
  const files = memoryFiles();
  let clock = new Date('2026-10-04T09:00:00Z').getTime();
  const env: PersistenceEnv = {
    openBackend: (generation) =>
      options.web
        ? new KvBackend(kv, `habit-tracker/web/${generation}`)
        : new SqliteBackend(async () => nodeSqlDb(join(dir, generation), faults, sqlLog)),
    kv,
    files,
    now: () => new Date((clock += 1000)),
  };
  const logs: string[] = [];
  return {
    dir,
    faults,
    sqlLog,
    kv,
    files,
    env,
    logs,
    dbPath: (generation = 'habits.db') => join(dir, generation),
    /** Simulates launching the app: a fresh store over the same storage. */
    async launch() {
      const store = createAppStore(env, (msg) => logs.push(msg));
      await store.boot();
      await store.flush();
      return store;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Reads a database file directly, bypassing the app. */
export function readDb(path: string) {
  const db = new DatabaseSync(path);
  try {
    const one = (sql: string) => Number(Object.values(db.prepare(sql).get() ?? { n: 0 })[0]);
    return {
      habits: one('SELECT COUNT(*) FROM habits'),
      entries: one('SELECT COUNT(*) FROM entries'),
      schema: db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? null,
      rows: (sql: string) => db.prepare(sql).all(),
    };
  } finally {
    db.close();
  }
}

/** Realistic data in the old AsyncStorage format: `habits` × `days`, ~85% filled, with notes. */
export function makeLegacyData(habitCount: number, days: number, today = '2026-10-03'): AppData {
  const freqs: Habit['frequency'][] = [{ kind: 'daily' }, { kind: 'weekdays', days: [1, 3, 5] }, { kind: 'timesPerWeek', count: 3 }];
  const start = addDays(today, -days + 1);
  const habits: Habit[] = Array.from({ length: habitCount }, (_, i) => ({
    id: `habit${String(i).padStart(2, '0')}x${(i * 7919).toString(36)}`,
    name: `Habit ${i + 1} ${['✨', '📚', '💧'][i % 3]}`,
    icon: ['💧', '📚', '🧘'][i % 3],
    color: '#5B6CFF',
    frequency: freqs[i % 3],
    type: i % 2 ? 'measurable' : 'boolean',
    target: i % 2 ? 8 : 1,
    unit: i % 2 ? 'glasses' : '',
    reminderTime: i % 4 ? '09:30' : null,
    createdAt: `${start}T08:00:00.000Z`,
    archived: i % 10 === 9,
  }));
  const entries: Record<string, Entry> = {};
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const h of habits) {
    for (let d = 0; d < days; d++) {
      const date = addDays(start, d);
      const r = rand();
      if (r > 0.85) continue;
      const status = r < 0.7 ? 'done' : r < 0.78 ? 'skipped' : 'missed';
      const value = status === 'done' ? h.target : status === 'missed' && h.type === 'measurable' ? 3 : 0;
      const note = rand() < 0.15 ? `Note for ${date}: "quotes", commas, émoji 🎉 and a\nline break` : undefined;
      entries[entryKey(h.id, date)] = { habitId: h.id, date, value, status, ...(note ? { note } : {}) };
    }
  }
  return { version: 1, habits, entries, settings: { ...DEFAULT_SETTINGS, weekStartsOn: 0, theme: 'dark' } };
}

/** JSON with object keys sorted, so field order doesn't matter. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** Compares two datasets: same habits (in order), entries and settings. Logs the first difference. */
export function sameData(a: AppData, b: AppData): boolean {
  const parts = (d: AppData) => ({ habits: canonical(d.habits), entries: canonical(d.entries), settings: canonical(d.settings) });
  const pa = parts(a);
  const pb = parts(b);
  for (const k of ['habits', 'entries', 'settings'] as const) {
    if (pa[k] !== pb[k]) {
      let i = 0;
      while (i < pa[k].length && pa[k][i] === pb[k][i]) i++;
      console.log(`    ${k} differ at char ${i}: …${pa[k].slice(Math.max(0, i - 60), i + 60)}… vs …${pb[k].slice(Math.max(0, i - 60), i + 60)}…`);
      return false;
    }
  }
  return true;
}
