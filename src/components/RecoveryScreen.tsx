import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { LoadStage } from '@/lib/persistence/core';
import { shareTextFile } from '@/lib/shareFile';
import { exportRawData, restoreBackup, retryLoad, startFresh, useLoadStatus } from '@/lib/store';
import { radius, useTheme } from '@/lib/theme';
import { Button, Card } from './ui';

const STAGE_LABEL: Record<LoadStage, string> = {
  open: 'Opening storage',
  schema: 'Checking the data format',
  migrate: 'Upgrading your saved data',
  load: 'Reading your habits',
};

/**
 * Shown instead of the app when saved data can't be loaded. Nothing is saved
 * while this screen is up, so the existing data can't be overwritten.
 */
export function RecoveryScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { error, backup, busy } = useLoadStatus();
  const [confirmingFresh, setConfirmingFresh] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; message: string }>) => {
    setResult(null);
    setResult(await action());
  };

  const doExport = () =>
    run(async () => {
      try {
        const { name, content } = await exportRawData();
        await shareTextFile(name, content, { mimeType: 'application/json', uti: 'public.json', dialogTitle: 'Export raw data' });
        return { ok: true, message: `Exported ${name}.` };
      } catch (err) {
        return { ok: false, message: `Export failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    });

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}
    >
      <View style={[styles.badge, { backgroundColor: c.surfaceAlt }]}>
        <Ionicons name="shield-checkmark-outline" size={34} color={c.accent} />
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
        We couldn’t load your data
      </Text>
      <Text style={[styles.body, { color: c.textMuted }]}>
        Your habits are still on this device. Nothing has been deleted or overwritten, and the app won’t save
        anything until your data loads.
      </Text>

      {error ? (
        <Card style={styles.details}>
          <Text style={[styles.detailsLabel, { color: c.textMuted }]}>WHAT WENT WRONG · {STAGE_LABEL[error.stage].toUpperCase()}</Text>
          <Text selectable style={[styles.detailsText, { color: c.text }]}>
            {error.message}
          </Text>
        </Card>
      ) : null}

      {result ? (
        <Text accessibilityLiveRegion="polite" style={[styles.result, { color: result.ok ? c.successText : c.dangerText }]}>
          {result.message}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button label="Try again" icon="refresh" onPress={() => run(retryLoad)} disabled={busy} />

        <Button
          label="Restore last backup"
          icon="time-outline"
          variant="secondary"
          onPress={() => run(restoreBackup)}
          disabled={busy || !backup}
        />
        <Text style={[styles.hint, { color: c.textMuted }]}>
          {backup
            ? `Backup from ${new Date(backup.savedAt).toLocaleString()} · ${backup.habits} habits, ${backup.entries} entries`
            : 'No backup is available yet.'}
        </Text>

        <Button label="Export raw data" icon="download-outline" variant="secondary" onPress={doExport} disabled={busy} />
        <Text style={[styles.hint, { color: c.textMuted }]}>
          Saves everything that can still be read to a file you can keep or send.
        </Text>

        {confirmingFresh ? (
          <View style={[styles.confirm, { borderColor: c.dangerText, backgroundColor: c.surface }]}>
            <Text style={[styles.confirmTitle, { color: c.text }]}>Start with an empty app?</Text>
            <Text style={[styles.body, { color: c.textMuted, textAlign: 'left' }]}>
              Your current data won’t be deleted: a copy is saved on this device and the old data file is kept, but the
              app will stop showing it. Export it first if you want a copy you can open.
            </Text>
            <View style={styles.confirmRow}>
              <Button label="Keep my data" variant="secondary" onPress={() => setConfirmingFresh(false)} style={{ flex: 1 }} />
              <Button
                label="Yes, start fresh"
                variant="danger"
                disabled={busy}
                onPress={() => {
                  setConfirmingFresh(false);
                  run(startFresh);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <Button label="Start fresh…" variant="ghost" onPress={() => setConfirmingFresh(true)} disabled={busy} />
        )}
      </View>

      {busy ? <ActivityIndicator style={{ marginTop: 16 }} color={c.accent} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, alignItems: 'stretch' },
  badge: { alignSelf: 'center', width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 16 },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  details: { marginTop: 20, gap: 6 },
  detailsLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  detailsText: { fontSize: 14, lineHeight: 20 },
  result: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 16 },
  actions: { marginTop: 24, gap: 8 },
  hint: { fontSize: 13, textAlign: 'center', marginBottom: 8 },
  confirm: { borderWidth: 1.5, borderRadius: radius.md, padding: 16, gap: 10, marginTop: 8 },
  confirmTitle: { fontSize: 17, fontWeight: '700' },
  confirmRow: { flexDirection: 'row', gap: 10 },
});
