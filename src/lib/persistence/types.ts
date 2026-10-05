// Interfaces between the app store and the platforms it persists to.
// Kept free of React Native imports so the whole persistence layer can be
// tested in Node against a real SQLite database.

import type { AppData, Entry, Habit, Settings } from '../types';

export type SqlValue = string | number | null;

/** The subset of expo-sqlite's SQLiteDatabase that the app uses. */
export interface SqlDb {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

/** Key-value storage (AsyncStorage). Holds the legacy data, markers and the database pointer. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Small file store for the last-known-good backup and recovery copies. */
export interface FileStore {
  read(name: string): Promise<string | null>;
  /** Replaces the file atomically where the platform allows. Returns a displayable location. */
  write(name: string, content: string): Promise<string>;
}

export interface Counts {
  habits: number;
  entries: number;
}

/** A place the app's data lives: SQLite on phones, a key-value document on web. */
export interface Backend {
  /** Opens the storage and checks it's readable. Throws if it isn't. */
  open(): Promise<void>;
  /** Brings the storage up to the current schema version. Throws on a newer, unknown version. */
  migrateSchema(): Promise<void>;
  /** Reads everything. Throws if any record is missing or invalid (never returns partial data). */
  loadAll(): Promise<AppData>;
  counts(): Promise<Counts>;
  /**
   * Replaces all data in one transaction and verifies the counts before committing.
   * `meta` entries are written in the same transaction (e.g. the migration marker).
   */
  replaceAll(data: AppData, meta?: Record<string, string>): Promise<void>;
  putHabit(habit: Habit): Promise<void>;
  /** Deletes a habit and its entries in one transaction. */
  deleteHabit(id: string): Promise<void>;
  /**
   * Puts a deleted habit back with its entries, at its old position: `order` is
   * the full list of habit ids in display order. One transaction (used by undo).
   */
  insertHabitAt(habit: Habit, entries: Entry[], order: string[]): Promise<void>;
  putEntry(entry: Entry): Promise<void>;
  deleteEntry(habitId: string, date: string): Promise<void>;
  putSettings(patch: Partial<Settings>): Promise<void>;
  /** Removes all habits, entries and settings in one transaction (keeps internal metadata). */
  resetAll(): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Best-effort dump of whatever can be read, for recovery exports. Never throws. */
  dumpRaw(): Promise<unknown>;
  close(): Promise<void>;
}

export interface PersistenceEnv {
  /** Opens (or creates) the storage generation with this name, e.g. "habits.db". */
  openBackend(generation: string): Backend;
  kv: KeyValueStore;
  files: FileStore;
  now(): Date;
}
