// The Settings data actions: back up, restore, import CSV and reset. The checks
// themselves are pure (backup.ts, csvFormat.ts); this file adds the file picker,
// the dialogs and the store calls.

import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { createBackup, readBackup, type BackupSummary } from './backup';
import { planCsvImport, type CsvImportPlan } from './csvFormat';
import { MONTHS } from './dates';
import { showDialog, showMessage } from './dialog';
import { askForReminders } from './notifications';
import { shareTextFile } from './shareFile';
import { getState, replaceAllData, resetAll, updateSettings } from './store';
import { offerUndo } from './undo';
import type { AppData } from './types';

const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** "3 Oct 2026" */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an unknown date' : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** "12 habits, 2,340 entries (85 with notes), exported 3 Oct 2026" */
export function describeBackup(s: BackupSummary): string {
  const notes = s.notes ? ` (${s.notes.toLocaleString('en-US')} with notes)` : '';
  return `${plural(s.habits, 'habit')}, ${plural(s.entries, 'entry', 'entries')}${notes}, ${s.exportedAt ? `exported ${shortDate(s.exportedAt)}` : 'export date unknown'}`;
}

/** Shares a JSON backup of everything and records the time. Throws if sharing fails. */
export async function backUpNow(): Promise<void> {
  const now = new Date();
  const file = createBackup(getState(), { appVersion: Constants.expoConfig?.version ?? 'unknown', now });
  await shareTextFile(file.name, file.content, {
    mimeType: 'application/json',
    uti: 'public.json',
    dialogTitle: 'Save your Kadam backup',
  });
  updateSettings({ lastBackupAt: now.toISOString() });
}

/** Lets the user pick a file and returns its text, or null if they cancelled. */
async function pickTextFile(): Promise<string | null> {
  // Any type: phones often label .json and .csv files as plain text or "unknown";
  // the content is checked properly afterwards.
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (asset.size && asset.size > 50 * 1024 * 1024) throw new Error('This file is too large (over 50 MB) to be a Kadam file');
  if (Platform.OS === 'web' && asset.file) return asset.file.text();
  return new File(asset.uri).text();
}

/** After restoring or importing: offer an undo, and ask for notification permission if reminders are on. */
function afterReplace(previous: AppData, title: string, message: string) {
  // The reminder schedule follows the new data automatically (useReminderSync).
  const next = getState();
  if (next.settings.remindersEnabled && next.habits.some((h) => h.reminderTime && !h.archived)) void askForReminders();
  offerUndo(title, async () => {
    const r = await replaceAllData(previous, 'undo');
    if (!r.ok) showMessage('Couldn’t undo', r.message);
  });
  showMessage(title, message);
}

export async function startRestore(): Promise<void> {
  let raw: string | null;
  try {
    raw = await pickTextFile();
  } catch (err) {
    return showMessage('Couldn’t open the file', `${errorText(err)}. Nothing was changed.`);
  }
  if (raw === null) return;
  const backup = readBackup(raw);
  if (!backup.ok) return showMessage('Can’t restore this file', backup.error);

  showDialog({
    title: 'Restore this backup?',
    message:
      `${describeBackup(backup.summary)}.\n\n` +
      'This replaces all habits, entries, notes and settings on this device. ' +
      'A copy of your current data is saved first, and you can undo right afterwards.',
    actions: [
      { label: 'Restore', style: 'destructive', onPress: () => void restore(backup.data, backup.summary) },
      { label: 'Cancel', style: 'cancel' },
    ],
  });
}

async function restore(data: AppData, summary: BackupSummary) {
  const previous = getState();
  const result = await replaceAllData(data, 'restore');
  if (!result.ok) return showMessage('Restore failed', result.message);
  afterReplace(previous, 'Backup restored', `Restored ${describeBackup(summary)}. Reminders have been rescheduled.`);
}

export async function startCsvImport(): Promise<void> {
  let raw: string | null;
  try {
    raw = await pickTextFile();
  } catch (err) {
    return showMessage('Couldn’t open the file', `${errorText(err)}. Nothing was changed.`);
  }
  if (raw === null) return;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const add = planCsvImport(raw, getState(), 'add', { newId });
  const replace = planCsvImport(raw, getState(), 'replace', { newId });
  if (!add.ok) return showMessage('Can’t import this file', add.error);
  if (!replace.ok) return showMessage('Can’t import this file', replace.error);

  const issues = issueList(add);
  if (add.entries === 0) {
    return showDialog({
      title: 'Nothing to import',
      message: `None of the ${plural(add.rows, 'row')} in this file could be imported. Nothing was changed.`,
      details: issues,
      actions: [{ label: 'OK', style: 'primary' }],
    });
  }
  const newHabits = add.habits.filter((h) => h.isNew).length;
  const lines = [
    `${plural(add.entries, 'entry', 'entries')} for ${plural(add.habits.length, 'habit')}` +
      (newHabits ? ` (${newHabits} new)` : '') +
      '.',
    add.updatedEntries ? `Add: ${plural(add.updatedEntries, 'day')} you already have will be overwritten by the file.` : null,
    'Replace: deletes all current habits and entries first (a copy is saved, and you can undo).',
    add.issues.length ? `${plural(add.issues.length, 'row')} can’t be imported (listed below).` : null,
  ].filter(Boolean);

  showDialog({
    title: 'Import CSV',
    message: lines.join('\n\n'),
    details: issues,
    actions: [
      { label: 'Add to my data', style: 'primary', onPress: () => void runImport(add) },
      { label: 'Replace all data', style: 'destructive', onPress: () => confirmReplace(replace) },
      { label: 'Cancel', style: 'cancel' },
    ],
  });
}

function issueList(plan: CsvImportPlan) {
  if (!plan.issues.length) return undefined;
  const shown = plan.issues.slice(0, 100).map((i) => `Line ${i.line}: ${i.reason}`);
  if (plan.issues.length > shown.length) shown.push(`…and ${plural(plan.issues.length - shown.length, 'more row')}`);
  return { title: 'Rows that can’t be imported', items: shown };
}

function confirmReplace(plan: CsvImportPlan) {
  const current = getState();
  showDialog({
    title: 'Replace all data?',
    message: `Your ${plural(current.habits.length, 'habit')} and their history will be replaced with the ${plural(plan.habits.length, 'habit')} in the file. A copy of your current data is saved first.`,
    actions: [
      { label: 'Replace', style: 'destructive', onPress: () => void runImport(plan) },
      { label: 'Cancel', style: 'cancel' },
    ],
  });
}

async function runImport(plan: CsvImportPlan) {
  const previous = getState();
  const result = await replaceAllData(plan.result, plan.mode === 'add' ? 'csv-import' : 'csv-replace');
  if (!result.ok) return showMessage('Import failed', result.message);
  const skipped = plan.issues.length ? ` ${plural(plan.issues.length, 'row')} skipped.` : '';
  afterReplace(previous, 'CSV imported', `Imported ${plural(plan.entries, 'entry', 'entries')} for ${plural(plan.habits.length, 'habit')}.${skipped}`);
}

/** "Reset all data?" with the option to back up first. */
export function confirmReset(onReset: () => void, backedUp = false) {
  showDialog({
    title: 'Reset all data?',
    message: backedUp
      ? 'Your backup is saved. Reset now? This permanently deletes every habit, entry and note on this device.'
      : 'This permanently deletes every habit, entry and note on this device.',
    actions: [
      ...(backedUp
        ? []
        : [
            {
              label: 'Back up first',
              style: 'primary' as const,
              onPress: () =>
                void backUpNow().then(
                  () => confirmReset(onReset, true),
                  (err) => showMessage('Backup failed', `${errorText(err)}. Nothing was reset.`),
                ),
            },
          ]),
      {
        label: 'Reset',
        style: 'destructive',
        onPress: () => {
          resetAll();
          onReset();
        },
      },
      { label: 'Cancel', style: 'cancel' },
    ],
  });
}
