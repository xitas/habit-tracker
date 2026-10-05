import { useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { closeDialog, getDialog, subscribeDialog, type DialogAction } from '@/lib/dialog';
import { radius, useTheme } from '@/lib/theme';
import { Button, FONT_CAPS } from './ui';

const VARIANT = { cancel: 'secondary', default: 'secondary', primary: 'primary', destructive: 'danger' } as const;

/** Renders the current showDialog() dialog. Mounted once, at the root. */
export function DialogHost() {
  const { c, isDark } = useTheme();
  const { height } = useWindowDimensions();
  const dialog = useSyncExternalStore(subscribeDialog, getDialog, getDialog);
  if (!dialog) return null;

  const cancel = () => {
    const onCancel = dialog.actions.find((a) => a.style === 'cancel')?.onPress;
    closeDialog();
    onCancel?.();
  };
  const press = (action: DialogAction) => {
    closeDialog();
    action.onPress?.();
  };
  // Side by side for two short buttons, stacked otherwise (three choices, long labels).
  const row = dialog.actions.length <= 2 && dialog.actions.every((a) => a.label.length <= 12);

  return (
    <Modal key={dialog.id} visible transparent animationType="fade" onRequestClose={cancel}>
      <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel="Close" accessibilityRole="button" />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            { backgroundColor: c.surface, maxHeight: height * 0.85 },
            isDark && { borderWidth: 1, borderColor: c.border },
          ]}
        >
          <ScrollView contentContainerStyle={styles.content} bounces={false}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={FONT_CAPS.title} style={[styles.title, { color: c.text }]}>
              {dialog.title}
            </Text>
            {dialog.message ? <Text style={[styles.message, { color: c.textMuted }]}>{dialog.message}</Text> : null}
            {dialog.details?.items.length ? (
              <View style={[styles.details, { backgroundColor: c.surfaceAlt }]}>
                <Text style={[styles.detailsTitle, { color: c.text }]}>{dialog.details.title}</Text>
                {dialog.details.items.map((item, i) => (
                  <Text key={i} style={[styles.detail, { color: c.textMuted }]}>
                    {item}
                  </Text>
                ))}
              </View>
            ) : null}
          </ScrollView>
          <View style={[styles.actions, row && styles.actionsRow]}>
            {dialog.actions.map((a) => (
              <Button
                key={a.label}
                label={a.label}
                variant={VARIANT[a.style ?? 'default']}
                onPress={() => press(a)}
                style={row ? { flex: 1 } : undefined}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 440, borderRadius: radius.lg + 4, overflow: 'hidden' },
  content: { padding: 20, paddingBottom: 8, gap: 10 },
  title: { fontSize: 20, fontWeight: '800' },
  message: { fontSize: 15, lineHeight: 21 },
  details: { borderRadius: radius.md, padding: 12, gap: 4 },
  detailsTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  detail: { fontSize: 13, lineHeight: 18 },
  actions: { padding: 16, paddingTop: 8, gap: 8 },
  actionsRow: { flexDirection: 'row' },
});
