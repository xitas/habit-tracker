// SQLite schema and its version history.
//
// To change the data structure later: append a migration with the next
// version number. Never edit a migration that has shipped. Each migration runs
// once, inside a transaction, and records its version in meta.schema_version.

export interface SchemaMigration {
  version: number;
  description: string;
  sql: string;
}

export const META_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);`;

export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    description: 'Habits, entries and settings tables',
    sql: `
CREATE TABLE habits (
  id            TEXT PRIMARY KEY NOT NULL,
  sort_order    INTEGER NOT NULL,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL,
  color         TEXT NOT NULL,
  frequency     TEXT NOT NULL,              -- JSON, see Frequency in types.ts
  type          TEXT NOT NULL CHECK (type IN ('boolean', 'measurable')),
  target        REAL NOT NULL,
  unit          TEXT NOT NULL,
  reminder_time TEXT,                       -- "HH:MM" or NULL
  created_at    TEXT NOT NULL,              -- ISO timestamp
  archived      INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);
CREATE TABLE entries (
  habit_id TEXT NOT NULL,
  date     TEXT NOT NULL,                   -- local day, "YYYY-MM-DD"
  value    REAL NOT NULL,
  status   TEXT NOT NULL CHECK (status IN ('done', 'skipped', 'missed')),
  note     TEXT,
  PRIMARY KEY (habit_id, date)              -- also the (habit_id, date) index
) WITHOUT ROWID;
CREATE INDEX idx_entries_date ON entries (date);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL                       -- JSON-encoded value
);`,
  },
];

export const LATEST_SCHEMA_VERSION = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1].version;

/**
 * Upgrades for exported data (backup files), keyed by the version they upgrade
 * FROM. Every schema version that changes the data's shape must add one here,
 * next to its SQL migration, so backups made by older versions keep restoring.
 *
 * Version 0 is the original, pre-SQLite format (one JSON document in
 * AsyncStorage); its data has the same shape as version 1.
 */
export const DATA_MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  0: (data) => data,
};

export const META_KEYS = {
  schemaVersion: 'schema_version',
  legacyMigratedAt: 'legacy_migrated_at',
} as const;
