// The app's data store. State lives in memory for the UI; every change is
// written straight to storage as one small update (see persistence/core.ts).

import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { createAppStore } from './persistence/core';
import { createEnv } from './persistence/env';
import type { AppData } from './types';

export { DEFAULT_SETTINGS } from './persistence/validate';
export type { HabitDraft, StatusSnapshot } from './persistence/core';

const store = createAppStore(createEnv());

// Make sure queued writes finish as soon as the app leaves the foreground.
AppState.addEventListener('change', (next) => {
  if (next !== 'active') {
    store.flush().catch(() => {});
  }
});

let booted = false;
/** Loads saved data once at startup. Further loads go through retryLoad(). */
export function hydrate(): Promise<void> {
  if (booted) return Promise.resolve();
  booted = true;
  return store.boot();
}

export const getState = (): AppData => store.getState();

export function useStore<T>(selector: (s: AppData) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}

/** Load status: 'loading' until storage is read, 'ready', or 'error' (recovery screen). */
export const useLoadStatus = () => useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);

/** True once data has loaded successfully. */
export const useHydrated = () =>
  useSyncExternalStore(
    store.subscribe,
    () => store.getStatus().status === 'ready',
    () => store.getStatus().status === 'ready',
  );

export const {
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
  retry: retryLoad,
  restoreBackup,
  startFresh,
  exportRawData,
  flush,
} = store;
