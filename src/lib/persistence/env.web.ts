// Web storage: everything in browser storage (localStorage via AsyncStorage).
// See kvBackend.ts for why web doesn't use expo-sqlite.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { KvBackend } from './kvBackend';
import type { FileStore, PersistenceEnv } from './types';

const FILE_PREFIX = 'habit-tracker/files/';

const browserFiles: FileStore = {
  read: (name) => AsyncStorage.getItem(FILE_PREFIX + name),
  async write(name, content) {
    await AsyncStorage.setItem(FILE_PREFIX + name, content);
    return `browser storage (${FILE_PREFIX + name})`;
  },
};

export function createEnv(): PersistenceEnv {
  return {
    openBackend: (generation) => new KvBackend(AsyncStorage, `habit-tracker/web/${generation}`),
    kv: AsyncStorage,
    files: browserFiles,
    now: () => new Date(),
  };
}
