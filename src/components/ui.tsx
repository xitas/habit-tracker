import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatTime, makeTime, parseTime } from '@/lib/dates';
import { radius, shadow, useTheme } from '@/lib/theme';

export const MIN_TOUCH = 44;

/**
 * Largest font scale allowed for text that sits in a layout that can't grow
 * (everything else scales with the phone's text size, without limit):
 * - title: large screen titles (a single long word would overflow the width)
 * - grid: labels in fixed 7-column rows (calendar days, weekday letters, week bars, tab bar)
 * - icon: emoji icons in fixed-size tiles (vector icons don't scale at all)
 * - ring: the number inside the progress ring
 * - field: the big number input in the entry sheet
 * - header: navigation bar titles (the bar has a fixed height on both platforms)
 */
export const FONT_CAPS = { title: 2, grid: 1.5, icon: 1.4, ring: 1.3, field: 1.5, header: 1.3 } as const;

/** Bottom padding for scrolling lists under the floating + button, so the last row can scroll clear of it. */
export const FAB_CLEARANCE = 60 + 20 + 32;

/**
 * The user's text size as a multiplier (1 = default). On phones this is the system
 * font scale. On web, react-native-web doesn't report one, so the browser's default
 * font size (Settings → Font size) is used for layout decisions.
 */
export function useFontScale(): number {
  const { fontScale } = useWindowDimensions();
  if (Platform.OS !== 'web' || typeof document === 'undefined') return fontScale;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return Math.max(fontScale, root / 16);
}

/** True when the text size is large enough that side-by-side layouts should stack. */
export function useLargeText(): boolean {
  return useFontScale() >= 1.5;
}

/** An emoji habit icon. Themed color, so custom text icons stay visible in dark mode. */
export function Emoji({ children, size }: { children: string; size: number }) {
  const { c } = useTheme();
  return (
    <Text
      style={{ fontSize: size, color: c.text, textAlign: 'center' }}
      maxFontSizeMultiplier={FONT_CAPS.icon}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {children}
    </Text>
  );
}

export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={{ flex: 1 }}>
        {subtitle ? <Text style={[styles.subtitle, { color: c.textMuted }]}>{subtitle}</Text> : null}
        <Text accessibilityRole="header" maxFontSizeMultiplier={FONT_CAPS.title} style={[styles.title, { color: c.text }]}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface }, shadow(c), style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text style={[styles.sectionLabel, { color: c.textMuted }]}>{children}</Text>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = 'primary', icon, disabled, style }: ButtonProps) {
  const { c, onColor } = useTheme();
  const enabledBg = { primary: c.accent, secondary: c.surfaceAlt, danger: c.danger, ghost: 'transparent' }[variant];
  const enabledFg = { primary: c.onAccent, secondary: c.text, danger: onColor(c.danger), ghost: c.accent }[variant];
  const bg = disabled && variant !== 'ghost' ? c.surfaceAlt : enabledBg;
  const fg = disabled ? c.textFaint : enabledFg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }, style]}
    >
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  color,
  bg,
  size = 22,
  label,
  disabled,
}: {
  name: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  label: string;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: bg ?? c.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={name} size={size} color={disabled ? c.textFaint : (color ?? c.text)} />
    </Pressable>
  );
}

export function Fab({ onPress, label }: { onPress: () => void; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: c.accent, transform: [{ scale: pressed ? 0.94 : 1 }] },
        shadow(c, 6, false),
      ]}
    >
      <Ionicons name="add" size={30} color={c.onAccent} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  style,
  accessibilityLabel,
  maxFontSizeMultiplier,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
  /** Spoken label when the visible one is abbreviated (e.g. "Monday" for "M"). */
  accessibilityLabel?: string;
  maxFontSizeMultiplier?: number;
}) {
  const { c, onColor, solid } = useTheme();
  const accent = solid(color ?? c.accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? accent : c.surfaceAlt, borderColor: selected ? accent : c.border },
        style,
      ]}
    >
      <Text
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[styles.chipText, { color: selected ? onColor(accent) : c.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { c } = useTheme();
  // Large text: options stack, so words like "Measurable" never overflow a narrow segment.
  const stacked = useLargeText();
  return (
    <View style={[styles.segmented, stacked && styles.segmentedStacked, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && [{ backgroundColor: c.surfaceRaised }, shadow(c, 2, false)]]}
          >
            <Text style={[styles.segmentText, { color: active ? c.text : c.textMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ThemedSwitch({
  value,
  onValueChange,
  label,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
}) {
  const { c } = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={label}
      trackColor={{ true: c.accent, false: c.border }}
      thumbColor={c.surfaceRaised}
      ios_backgroundColor={c.border}
      // react-native-web ignores thumbColor while on and falls back to its own teal.
      {...(Platform.OS === 'web' ? ({ activeThumbColor: c.surfaceRaised } as object) : {})}
    />
  );
}

/** Theme props for every TextInput: placeholder, caret, selection and keyboard. */
export function useInputTheme() {
  const { c, isDark } = useTheme();
  return {
    placeholderTextColor: c.textMuted,
    selectionColor: c.accent,
    cursorColor: c.accent,
    keyboardAppearance: isDark ? ('dark' as const) : ('light' as const),
  };
}

/** Time picker built from steppers: no native picker dependency, works one-handed. */
export function TimeStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { c } = useTheme();
  const large = useLargeText();
  const { hour, minute } = parseTime(value);
  const shift = (minutes: number) => {
    const total = (hour * 60 + minute + minutes + 24 * 60) % (24 * 60);
    onChange(makeTime(Math.floor(total / 60), total % 60));
  };
  const time = (
    <Text accessibilityLiveRegion="polite" style={[styles.stepperValue, { color: c.text }]}>
      {formatTime(value)}
    </Text>
  );
  const earlier = (
    <>
      <IconButton name="remove" label="Earlier by 1 hour" onPress={() => shift(-60)} />
      <IconButton name="chevron-back" label="Earlier by 15 minutes" onPress={() => shift(-15)} />
    </>
  );
  const later = (
    <>
      <IconButton name="chevron-forward" label="Later by 15 minutes" onPress={() => shift(15)} />
      <IconButton name="add" label="Later by 1 hour" onPress={() => shift(60)} />
    </>
  );
  // Large text: the time gets its own row instead of squeezing between the buttons.
  if (large) {
    return (
      <View style={{ gap: 8 }}>
        {time}
        <View style={styles.stepperRow}>
          {earlier}
          {later}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.stepperRow}>
      {earlier}
      {time}
      {later}
    </View>
  );
}

export const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, fontWeight: '600', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  card: { borderRadius: radius.lg, padding: 16 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { flexShrink: 1, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  iconButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 4 },
  segmentedStacked: { flexDirection: 'column', gap: 4 },
  chipText: { fontWeight: '600', fontSize: 14, textAlign: 'center' },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontWeight: '600', fontSize: 14, textAlign: 'center' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  stepperValue: { flexShrink: 1, fontSize: 22, fontWeight: '700', minWidth: 100, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
