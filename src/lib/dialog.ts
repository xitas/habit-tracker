// The app's own dialog (rendered by DialogHost at the root). Unlike Alert it
// works the same on web, takes more than two buttons, and can list details
// (e.g. CSV rows that couldn't be imported). One dialog at a time.

export interface DialogAction {
  label: string;
  /** "cancel" closes without doing anything; "destructive" is red; "primary" is the accent color. */
  style?: 'cancel' | 'default' | 'primary' | 'destructive';
  /** Runs after the dialog closes. */
  onPress?: () => void;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** A scrollable list under the message. */
  details?: { title: string; items: string[] };
  actions: DialogAction[];
}

let current: (DialogOptions & { id: number }) | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showDialog(options: DialogOptions) {
  current = { ...options, id: nextId++ };
  emit();
}

export function closeDialog() {
  if (!current) return;
  current = null;
  emit();
}

export const getDialog = () => current;
export function subscribeDialog(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A one-button message. */
export function showMessage(title: string, message: string) {
  showDialog({ title, message, actions: [{ label: 'OK', style: 'primary' }] });
}
