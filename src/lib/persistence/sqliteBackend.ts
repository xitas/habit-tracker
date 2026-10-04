// SQLite storage: one row per habit, entry and setting. Every change is a
// small targeted statement; multi-row changes run in a transaction.

import type { AppData, Entry, Habit, Settings } from '../types';
import { LATEST_SCHEMA_VERSION, META_KEYS, META_TABLE_SQL, SCHEMA_MIGRATIONS } from './schema';
import type { Backend, Counts, SqlDb, SqlValue } from './types';
import { assembleData, countEntries, DataError, describeError } from './validate';

interface HabitRow {
  id: string;
  sort_order: number;
  name: string;
  icon: string;
  color: string;
  frequency: string;
  type: string;
  target: number;
  unit: string;
  reminder_time: string | null;
  created_at: string;
  archived: number;
}

interface EntryRow {
  habit_id: string;
  date: string;
  value: number;
  status: string;
  note: string | null;
}

const HABIT_COLUMNS = 'id, sort_order, name, icon, color, frequency, type, target, unit, reminder_time, created_at, archived';
// Rows per multi-row INSERT, well under SQLite's bound-parameter limit.
const HABITS_PER_BATCH = 50;
const ENTRIES_PER_BATCH = 150;

const habitParams = (h: Habit, order: number): SqlValue[] => [
  h.id, order, h.name, h.icon, h.color, JSON.stringify(h.frequency), h.type, h.target, h.unit,
  h.reminderTime, h.createdAt, h.archived ? 1 : 0,
];

const entryParams = (e: Entry): SqlValue[] => [e.habitId, e.date, e.value, e.status, e.note ?? null];

function rowToHabit(r: HabitRow): unknown {
  let frequency: unknown;
  try {
    frequency = JSON.parse(r.frequency);
  } catch {
    throw new DataError(`habit "${r.id}": frequency is not valid JSON`);
  }
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    frequency,
    type: r.type,
    target: r.target,
    unit: r.unit,
    reminderTime: r.reminder_time,
    createdAt: r.created_at,
    archived: r.archived === 1 ? true : r.archived === 0 ? false : r.archived,
  };
}

const rowToEntry = (r: EntryRow): unknown => ({
  habitId: r.habit_id,
  date: r.date,
  value: r.value,
  status: r.status,
  ...(r.note !== null ? { note: r.note } : {}),
});

export class SqliteBackend implements Backend {
  private db: SqlDb | null = null;
  private openError: unknown = null;

  constructor(private readonly connect: () => Promise<SqlDb>) {}

  private get conn(): SqlDb {
    if (!this.db) throw new Error('Database is not open');
    return this.db;
  }

  async open(): Promise<void> {
    try {
      this.db = await this.connect();
      await this.db.execAsync('PRAGMA journal_mode = WAL;');
      // Cheap structural check; a damaged file fails here instead of half-way through a load.
      const check = await this.db.getFirstAsync<Record<string, unknown>>('PRAGMA quick_check', []);
      const result = check ? Object.values(check)[0] : 'no result';
      if (result !== 'ok') throw new Error(`Database integrity check failed: ${String(result)}`);
    } catch (err) {
      this.openError = err;
      throw err;
    }
  }

  async migrateSchema(): Promise<void> {
    const db = this.conn;
    await db.execAsync(META_TABLE_SQL);
    const current = Number((await this.getMeta(META_KEYS.schemaVersion)) ?? 0);
    if (!Number.isInteger(current) || current < 0) throw new Error(`Unknown database schema version "${current}"`);
    if (current > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `This data was saved by a newer version of the app (schema ${current}, this version knows ${LATEST_SCHEMA_VERSION}). Update the app to open it.`,
      );
    }
    for (const m of SCHEMA_MIGRATIONS) {
      if (m.version <= current) continue;
      await db.withTransactionAsync(async () => {
        await db.execAsync(m.sql);
        await this.setMeta(META_KEYS.schemaVersion, String(m.version));
      });
    }
  }

  async loadAll(): Promise<AppData> {
    const db = this.conn;
    const habits = await db.getAllAsync<HabitRow>(`SELECT ${HABIT_COLUMNS} FROM habits ORDER BY sort_order, created_at`, []);
    const entries = await db.getAllAsync<EntryRow>('SELECT habit_id, date, value, status, note FROM entries', []);
    const settingRows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings', []);
    const settings: Record<string, unknown> = {};
    for (const row of settingRows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        // An unreadable setting falls back to its default; settings aren't precious.
      }
    }
    return assembleData(habits.map(rowToHabit), entries.map(rowToEntry), settings, 'database');
  }

  async counts(): Promise<Counts> {
    const row = await this.conn.getFirstAsync<{ habits: number; entries: number }>(
      'SELECT (SELECT COUNT(*) FROM habits) AS habits, (SELECT COUNT(*) FROM entries) AS entries',
      [],
    );
    return { habits: Number(row?.habits ?? 0), entries: Number(row?.entries ?? 0) };
  }

  async replaceAll(data: AppData, meta: Record<string, string> = {}): Promise<void> {
    const db = this.conn;
    const entries = Object.values(data.entries);
    await db.withTransactionAsync(async () => {
      await db.execAsync('DELETE FROM entries; DELETE FROM habits; DELETE FROM settings;');
      for (let i = 0; i < data.habits.length; i += HABITS_PER_BATCH) {
        const batch = data.habits.slice(i, i + HABITS_PER_BATCH);
        await db.runAsync(
          `INSERT INTO habits (${HABIT_COLUMNS}) VALUES ${batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
          batch.flatMap((h, j) => habitParams(h, i + j)),
        );
      }
      for (let i = 0; i < entries.length; i += ENTRIES_PER_BATCH) {
        const batch = entries.slice(i, i + ENTRIES_PER_BATCH);
        await db.runAsync(
          `INSERT INTO entries (habit_id, date, value, status, note) VALUES ${batch.map(() => '(?,?,?,?,?)').join(',')}`,
          batch.flatMap(entryParams),
        );
      }
      await this.writeSettings(data.settings);
      for (const [key, value] of Object.entries(meta)) await this.setMeta(key, value);
      // Verify before committing: a mismatch throws and rolls the whole copy back.
      const c = await this.counts();
      if (c.habits !== data.habits.length || c.entries !== countEntries(data)) {
        throw new Error(
          `Copy check failed: expected ${data.habits.length} habits and ${countEntries(data)} entries, found ${c.habits} and ${c.entries}`,
        );
      }
    });
  }

  async putHabit(habit: Habit): Promise<void> {
    // New habits go to the end of the list; existing ones keep their position.
    await this.conn.runAsync(
      `INSERT INTO habits (${HABIT_COLUMNS})
       VALUES (?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM habits), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, icon = excluded.icon, color = excluded.color, frequency = excluded.frequency,
         type = excluded.type, target = excluded.target, unit = excluded.unit,
         reminder_time = excluded.reminder_time, created_at = excluded.created_at, archived = excluded.archived`,
      habitParams(habit, 0).filter((_, i) => i !== 1),
    );
  }

  async deleteHabit(id: string): Promise<void> {
    const db = this.conn;
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM entries WHERE habit_id = ?', [id]);
      await db.runAsync('DELETE FROM habits WHERE id = ?', [id]);
    });
  }

  async putEntry(entry: Entry): Promise<void> {
    await this.conn.runAsync(
      'INSERT OR REPLACE INTO entries (habit_id, date, value, status, note) VALUES (?, ?, ?, ?, ?)',
      entryParams(entry),
    );
  }

  async deleteEntry(habitId: string, date: string): Promise<void> {
    await this.conn.runAsync('DELETE FROM entries WHERE habit_id = ? AND date = ?', [habitId, date]);
  }

  async putSettings(patch: Partial<Settings>): Promise<void> {
    const db = this.conn;
    const keys = Object.keys(patch);
    if (keys.length === 1) return this.writeSettings(patch);
    await db.withTransactionAsync(() => this.writeSettings(patch));
  }

  private async writeSettings(settings: Partial<Settings>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.conn.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
    }
  }

  async resetAll(): Promise<void> {
    const db = this.conn;
    await db.withTransactionAsync(() => db.execAsync('DELETE FROM entries; DELETE FROM habits; DELETE FROM settings;'));
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.conn.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.conn.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }

  async dumpRaw(): Promise<unknown> {
    if (!this.db) return { error: `Database could not be opened: ${describeError(this.openError)}` };
    const out: Record<string, unknown> = {};
    for (const table of ['meta', 'settings', 'habits', 'entries']) {
      try {
        out[table] = await this.db.getAllAsync(`SELECT * FROM ${table}`, []);
      } catch (err) {
        out[table] = { error: describeError(err) };
      }
    }
    return out;
  }

  async close(): Promise<void> {
    const db = this.db;
    this.db = null;
    if (db) await db.closeAsync().catch(() => {});
  }
}
