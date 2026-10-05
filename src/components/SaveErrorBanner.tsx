import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { retrySaves, useLoadStatus } from '@/lib/store';
import { radius, shadow, useTheme } from '@/lib/theme';
import { MIN_TOUCH } from './ui';

/**
 * Non-blocking warning shown while some changes exist only in memory because
 * saving them failed (for example, the device is out of space). The app stays
 * usable underneath; Retry saves the current values of the unsaved changes.
 */
export function SaveErrorBanner() {
  const { c, onColor } = useTheme();
  const insets = useSafeAreaInsets();
  const { saveError, unsavedChanges, retryingSaves } = useLoadStatus();
  if (!saveError) return null;

  const ink = onColor(c.warning);
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 8 }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.banner, { backgroundColor: c.warning }, shadow(c, 6, false)]}
      >
        <Ionicons name="warning-outline" size={22} color={ink} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: ink }]}>Some changes couldn’t be saved</Text>
          <Text style={[styles.detail, { color: ink }]}>
            {unsavedChanges === 1 ? '1 change is' : `${unsavedChanges} changes are`} kept on screen until saved. {saveError}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry saving"
          accessibilityState={{ busy: retryingSaves, disabled: retryingSaves }}
          disabled={retryingSaves}
          onPress={() => retrySaves()}
          style={({ pressed }) => [styles.retry, { borderColor: ink, opacity: pressed ? 0.7 : 1 }]}
        >
          {retryingSaves ? <ActivityIndicator color={ink} /> : <Text style={[styles.retryText, { color: ink }]}>Retry</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 12,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 12, marginTop: 2 },
  retry: {
    minHeight: MIN_TOUCH,
    minWidth: 72,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { fontSize: 15, fontWeight: '700' },
});
