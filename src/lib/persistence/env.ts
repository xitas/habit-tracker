// Phone storage: expo-sqlite for data, expo-file-system for the backup and
// recovery copies, AsyncStorage for the old data and small pointers.
// (Web uses env.web.ts instead; Metro picks the file by platform.)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import { SqliteBackend } from './sqliteBackend';
import type { FileStore, PersistenceEnv, SqlDb } from './types';

/** App-owned folder in the documents directory (not the cache, which the OS may clear). */
function dataDirectory(): Directory {
  return new Directory(Paths.document, 'habit-tracker');
}

function locate(name: string): { dir: Directory; file: File } {
  const parts = name.split('/');
  const fileName = parts.pop()!;
  const dir = parts.length ? new Directory(dataDirectory(), ...parts) : dataDirectory();
  return { dir, file: new File(dir, fileName) };
}

const nativeFiles: FileStore = {
  async read(name) {
    const { file } = locate(name);
    return file.exists ? file.text() : null;
  },
  async write(name, content) {
    const { dir, file } = locate(name);
    dir.create({ intermediates: true, idempotent: true });
    // Write to a temporary file first, then move it into place, so a crash
    // mid-write never leaves a half-written backup behind.
    const temp = new File(dir, `${file.name}.tmp`);
    if (temp.exists) temp.delete();
    temp.create();
    temp.write(content);
    await temp.move(file, { overwrite: true });
    return file.uri;
  },
};

export function createEnv(): PersistenceEnv {
  return {
    openBackend: (generation) =>
      new SqliteBackend(async (): Promise<SqlDb> => SQLite.openDatabaseAsync(generation)),
    kv: AsyncStorage,
    files: nativeFiles,
    now: () => new Date(),
  };
}
