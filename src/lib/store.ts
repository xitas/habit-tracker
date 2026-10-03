import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { entryKey, type AppData, type Entry, type EntryStatus, type Habit, type Settings } from './types';

const STORAGE_KEY = 'habit-tracker/data/v1';

export const DEFAULT_SETTINGS: Settings = {
  weekStartsOn: 1,
  remindersEnabled: true,
  nudgeTime: '20:00',
  theme: 'system',
};

const emptyData = (): AppData => ({
  version: 1,
  habits: [],
  entries: {},
  settings: { ...DEFAULT_SETTINGS },
});

let state: AppData = emptyData();
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((err) =>
      console.warn('Failed to save habit data', err),
    );
  }, 250);
}

function setState(update: (s: AppData) => AppData) {
  state = update(state);
  emit();
  scheduleSave();
}

export async function hydrate(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppData;
      state = {
        ...emptyData(),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      };
    }
  } catch (err) {
    console.warn('Failed to load habit data', err);
  }
  hydrated = true;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): AppData {
  return state;
}

export function useStore<T>(selector: (s: AppData) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export const useHydrated = () => useSyncExternalStore(subscribe, () => hydrated, () => hydrated);

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- Habits ----

export type HabitDraft = Omit<Habit, 'id' | 'createdAt' | 'archived'>;

export function addHabit(draft: HabitDraft): Habit {
  const habit: Habit = { ...draft, id: newId(), createdAt: new Date().toISOString(), archived: false };
  setState((s) => ({ ...s, habits: [...s.habits, habit] }));
  return habit;
}

export function updateHabit(id: string, patch: Partial<Habit>) {
  setState((s) => ({ ...s, habits: s.habits.map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
}

export function deleteHabit(id: string) {
  setState((s) => {
    const entries = { ...s.entries };
    for (const key in entries) if (entries[key].habitId === id) delete entries[key];
    return { ...s, habits: s.habits.filter((h) => h.id !== id), entries };
  });
}

// ---- Entries ----

function writeEntry(habitId: string, date: string, next: Entry | null) {
  setState((s) => {
    const entries = { ...s.entries };
    const key = entryKey(habitId, date);
    if (next) entries[key] = next;
    else delete entries[key];
    return { ...s, entries };
  });
}

function existing(habitId: string, date: string): Entry | undefined {
  return state.entries[entryKey(habitId, date)];
}

/** Store an entry, or drop it when it carries no information. */
function put(habitId: string, date: string, value: number, status: EntryStatus, note?: string) {
  const empty = status === 'missed' && value === 0 && !note;
  writeEntry(habitId, date, empty ? null : { habitId, date, value, status, ...(note ? { note } : {}) });
}

export function setValue(habit: Habit, date: string, value: number) {
  const v = Math.max(0, Math.round(value * 100) / 100);
  put(habit.id, date, v, v >= habit.target ? 'done' : 'missed', existing(habit.id, date)?.note);
}

export function markDone(habit: Habit, date: string) {
  const prev = existing(habit.id, date);
  put(habit.id, date, Math.max(habit.target, prev?.value ?? 0), 'done', prev?.note);
}

export function markSkipped(habit: Habit, date: string) {
  const prev = existing(habit.id, date);
  put(habit.id, date, prev?.value ?? 0, 'skipped', prev?.note);
}

export function markMissed(habit: Habit, date: string) {
  const prev = existing(habit.id, date);
  const partial = habit.type === 'measurable' && prev && prev.value < habit.target ? prev.value : 0;
  put(habit.id, date, partial, 'missed', prev?.note);
}

/** Undo done/skipped back to a blank day, keeping any note. */
export function clearStatus(habit: Habit, date: string) {
  put(habit.id, date, 0, 'missed', existing(habit.id, date)?.note);
}

export function setNote(habit: Habit, date: string, note: string) {
  const prev = existing(habit.id, date);
  put(habit.id, date, prev?.value ?? 0, prev?.status ?? 'missed', note.trim() || undefined);
}

/** Write a whole entry at once (entry sheet / backfill). Measurable status follows the value unless skipped. */
export function saveEntry(habit: Habit, date: string, value: number, status: EntryStatus, note: string) {
  let v = Math.max(0, Math.round(value * 100) / 100);
  let s = status;
  if (habit.type === 'boolean') v = s === 'done' ? 1 : 0;
  else if (s !== 'skipped') s = v >= habit.target ? 'done' : 'missed';
  put(habit.id, date, v, s, note.trim() || undefined);
}

// ---- Settings & data ----

export function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

export function resetAll() {
  setState(() => emptyData());
}
