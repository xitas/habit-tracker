// Web fallback storage: one JSON document in localStorage (via AsyncStorage).
//
// expo-sqlite's web support is alpha and needs WebAssembly bundling plus
// cross-origin isolation headers on every host, so web keeps a simple document
// store with the same Backend contract: strict validation on load, and no write
// is ever made over a document that failed to load.

import { serialize, type AppData, type Entry, type Habit, type Settings } from '../types';
import { LATEST_SCHEMA_VERSION, META_KEYS } from './schema';
import type { Backend, Counts, KeyValueStore } from './types';
import { countEntries, DataError, emptyData, parseAppData } from './validate';

interface KvDocument {
  format: 'habit-tracker-kv';
  meta: Record<string, string>;
  data: AppData;
}

export class KvBackend implements Backend {
  private doc: KvDocument | null = null;
  private raw: string | null = null;

  constructor(
    private readonly kv: KeyValueStore,
    private readonly key: string,
  ) {}

  private get current(): KvDocument {
    if (!this.doc) throw new Error('Storage is not open');
    return this.doc;
  }

  async open(): Promise<void> {
    this.raw = await this.kv.getItem(this.key);
    if (this.raw === null) {
      this.doc = { format: 'habit-tracker-kv', meta: {}, data: emptyData() };
      return;
    }
    let parsed: { format?: unknown; meta?: unknown; data?: unknown };
    try {
      parsed = JSON.parse(this.raw);
    } catch {
      throw new DataError('browser storage: the saved data is not valid JSON');
    }
    if (parsed?.format !== 'habit-tracker-kv' || typeof parsed.meta !== 'object' || parsed.meta === null) {
      throw new DataError('browser storage: unrecognised data format');
    }
    // Validate strictly; parseAppData throws on any bad record.
    const data = parseAppData(JSON.stringify(parsed.data), 'browser storage');
    this.doc = { format: 'habit-tracker-kv', meta: parsed.meta as Record<string, string>, data };
  }

  async migrateSchema(): Promise<void> {
    const doc = this.current;
    const current = Number(doc.meta[META_KEYS.schemaVersion] ?? 0);
    if (current > LATEST_SCHEMA_VERSION) {
      throw new Error(`This data was saved by a newer version of the app (schema ${current}). Update the app to open it.`);
    }
    if (current < LATEST_SCHEMA_VERSION) {
      doc.meta[META_KEYS.schemaVersion] = String(LATEST_SCHEMA_VERSION);
      await this.save();
    }
  }

  async loadAll(): Promise<AppData> {
    return structuredClone(this.current.data);
  }

  async counts(): Promise<Counts> {
    return { habits: this.current.data.habits.length, entries: countEntries(this.current.data) };
  }

  async replaceAll(data: AppData, meta: Record<string, string> = {}): Promise<void> {
    const doc = this.current;
    const previous = doc.data;
    const previousMeta = doc.meta;
    doc.data = structuredClone(data);
    doc.meta = { ...doc.meta, ...meta };
    try {
      await this.save();
      // Verify by reading back what was written.
      const stored = await this.kv.getItem(this.key);
      const check = parseAppData(JSON.stringify(JSON.parse(stored ?? 'null')?.data ?? null), 'browser storage');
      if (check.habits.length !== data.habits.length || countEntries(check) !== countEntries(data)) {
        throw new Error('Copy check failed after writing to browser storage');
      }
    } catch (err) {
      doc.data = previous;
      doc.meta = previousMeta;
      throw err;
    }
  }

  async putHabit(habit: Habit): Promise<void> {
    const d = this.current.data;
    const i = d.habits.findIndex((h) => h.id === habit.id);
    if (i >= 0) d.habits[i] = { ...habit };
    else d.habits.push({ ...habit });
    await this.save();
  }

  async deleteHabit(id: string): Promise<void> {
    const d = this.current.data;
    d.habits = d.habits.filter((h) => h.id !== id);
    const { [id]: _removed, ...rest } = d.entries;
    d.entries = rest;
    await this.save();
  }

  async putEntry(entry: Entry): Promise<void> {
    const d = this.current.data;
    d.entries = { ...d.entries, [entry.habitId]: { ...d.entries[entry.habitId], [entry.date]: { ...entry } } };
    await this.save();
  }

  async deleteEntry(habitId: string, date: string): Promise<void> {
    const d = this.current.data;
    const { [date]: _removed, ...log } = d.entries[habitId] ?? {};
    d.entries = { ...d.entries, [habitId]: log };
    await this.save();
  }

  async putSettings(patch: Partial<Settings>): Promise<void> {
    const d = this.current.data;
    d.settings = { ...d.settings, ...patch };
    await this.save();
  }

  async resetAll(): Promise<void> {
    const d = this.current.data;
    this.current.data = { ...emptyData(), version: d.version };
    await this.save();
  }

  async getMeta(key: string): Promise<string | null> {
    return this.current.meta[key] ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.current.meta[key] = value;
    await this.save();
  }

  async dumpRaw(): Promise<unknown> {
    if (this.raw !== null) return { raw: this.raw };
    try {
      return { raw: await this.kv.getItem(this.key) };
    } catch (err) {
      return { error: String(err) };
    }
  }

  async close(): Promise<void> {
    this.doc = null;
  }

  private async save(): Promise<void> {
    // Saved flat (SerializedData), the same shape older versions wrote and read.
    const json = JSON.stringify({ ...this.current, data: serialize(this.current.data) });
    await this.kv.setItem(this.key, json);
    this.raw = json;
  }
}
