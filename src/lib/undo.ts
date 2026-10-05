// The single undo offer shown in the snackbar. Pure: tested in Node.
// A new offer replaces the current one; the snackbar dismisses it after a few seconds.

import type { Entry } from './types';

export interface UndoOffer {
  id: number;
  message: string;
  undo: () => void;
}

let current: UndoOffer | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function offerUndo(message: string, undo: () => void): number {
  current = { id: nextId++, message, undo };
  emit();
  return current.id;
}

/** Hides the offer (only if it's still the one with this id, when given). */
export function dismissUndo(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

/** Runs the undo for this offer, once, if it's still the current one. */
export function performUndo(id: number): boolean {
  if (!current || current.id !== id) return false;
  const { undo } = current;
  current = null;
  emit();
  undo();
  return true;
}

export const getUndo = () => current;
export function subscribeUndo(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type DayStatus = 'done' | 'skipped' | 'open';
const dayStatus = (e?: Entry | null): DayStatus => (e?.status === 'done' ? 'done' : e?.status === 'skipped' ? 'skipped' : 'open');

/** What a change to one day amounts to, for the undo message; null if nothing changed. */
export function describeEntryChange(prev?: Entry | null, next?: Entry | null): string | null {
  const a = dayStatus(prev);
  const b = dayStatus(next);
  // Clearing a partly-done measurable day keeps its status ("open") but resets the value.
  if (a === b) return a === 'open' && (prev?.value ?? 0) > 0 && (next?.value ?? 0) === 0 ? 'Cleared' : null;
  return b === 'done' ? 'Marked done' : b === 'skipped' ? 'Skipped' : 'Cleared';
}
