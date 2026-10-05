// Backup files: everything (habits, entries, notes, settings) in one JSON file.
// Pure: no React Native, so creating and checking backups is tested in Node.
//
// Accepted when restoring:
// - this app's backups ("habit-tracker-export"), any data version up to the current one;
// - the automatic safety backups the app keeps ("habit-tracker-backup");
// - the original pre-SQLite format (data version 0), e.g. an old raw data file.
// Older data versions are upgraded through DATA_MIGRATIONS; newer ones are refused.

import { DATA_MIGRATIONS, LATEST_SCHEMA_VERSION } from './persistence/schema';
import { countEntries, describeError, parseAppData } from './persistence/validate';
import { allEntries, serialize, type AppData } from './types';

export const BACKUP_FORMAT = 'habit-tracker-export';

export interface BackupSummary {
  habits: number;
  entries: number;
  notes: number;
  /** When the backup was made, if the file says (ISO timestamp). */
  exportedAt: string | null;
  /** Data version the file was written with (0 = the original format). */
  schemaVersion: number;
}

export type BackupCheck = { ok: true; data: AppData; summary: BackupSummary } | { ok: false; error: string };

export function summarize(data: AppData, exportedAt: string | null, schemaVersion: number): BackupSummary {
  return {
    habits: data.habits.length,
    entries: countEntries(data),
    notes: allEntries(data.entries).filter((e) => e.note).length,
    exportedAt,
    schemaVersion,
  };
}

/** A backup file of `data`: name and JSON content. */
export function createBackup(data: AppData, opts: { appVersion: string; now: Date }): { name: string; content: string } {
  const exportedAt = opts.now.toISOString();
  const doc = {
    format: BACKUP_FORMAT,
    appVersion: opts.appVersion,
    schemaVersion: LATEST_SCHEMA_VERSION,
    exportedAt,
    counts: { habits: data.habits.length, entries: countEntries(data) },
    data: serialize(data),
  };
  return { name: `kadam-backup-${exportedAt.slice(0, 10)}.json`, content: JSON.stringify(doc, null, 1) };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Checks a backup file completely. Never throws; nothing is changed by calling it. */
export function readBackup(raw: string): BackupCheck {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'This file isn’t a valid backup: it isn’t readable JSON. Nothing was changed.' };
  }
  if (!isObject(doc)) return { ok: false, error: 'This file isn’t a Kadam backup. Nothing was changed.' };

  let version: number;
  let payload: unknown;
  let exportedAt: string | null = null;
  if (doc.format === BACKUP_FORMAT || doc.format === 'habit-tracker-backup') {
    version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : NaN;
    payload = doc.data;
    const when = doc.format === BACKUP_FORMAT ? doc.exportedAt : doc.savedAt;
    exportedAt = typeof when === 'string' && !Number.isNaN(Date.parse(when)) ? when : null;
  } else if (Array.isArray(doc.habits) && isObject(doc.entries)) {
    version = 0; // the original format: the data document itself
    payload = doc;
  } else {
    return { ok: false, error: 'This file isn’t a Kadam backup. Nothing was changed.' };
  }

  if (!Number.isInteger(version) || version < 0) {
    return { ok: false, error: 'This backup doesn’t say which data version it uses, so it can’t be restored safely. Nothing was changed.' };
  }
  if (version > LATEST_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This backup was made by a newer version of Kadam (data version ${version}). Update the app, then restore it. Nothing was changed.`,
    };
  }

  try {
    for (let v = version; v < LATEST_SCHEMA_VERSION; v++) {
      const upgrade = DATA_MIGRATIONS[v];
      if (!upgrade) throw new Error(`no upgrade from data version ${v}`);
      payload = upgrade(payload);
    }
    const data = parseAppData(JSON.stringify(payload), 'backup');
    return { ok: true, data, summary: summarize(data, exportedAt, version) };
  } catch (err) {
    return { ok: false, error: `This backup is damaged and can’t be restored (${describeError(err)}). Nothing was changed.` };
  }
}

/** "Last backup: 12 days ago" style text. */
export function lastBackupText(lastBackupAt: string | null, now: Date): string {
  if (!lastBackupAt) return 'No backup yet';
  const days = Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / 86_400_000);
  if (days <= 0) return 'Last backup: today';
  if (days === 1) return 'Last backup: yesterday';
  return `Last backup: ${days} days ago`;
}
