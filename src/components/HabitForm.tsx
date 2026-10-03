import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { orderedWeekdays, WEEKDAY_SHORT } from '@/lib/dates';
import { ensurePermission } from '@/lib/notifications';
import type { HabitDraft } from '@/lib/store';
import { useStore } from '@/lib/store';
import { alpha, HABIT_COLORS, HABIT_ICONS, radius, useTheme } from '@/lib/theme';
import type { Frequency, HabitType, Weekday } from '@/lib/types';
import { Button, Card, Chip, IconButton, Segmented, SectionLabel, ThemedSwitch, TimeStepper, useInputTheme } from './ui';

type FreqKind = Frequency['kind'];

const BLANK: HabitDraft = {
  name: '',
  icon: '✅',
  color: HABIT_COLORS[0],
  frequency: { kind: 'daily' },
  type: 'boolean',
  target: 1,
  unit: '',
  reminderTime: null,
};

export function HabitForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: HabitDraft;
  submitLabel: string;
  onSubmit: (draft: HabitDraft) => void;
}) {
  const { c, tag } = useTheme();
  const inputTheme = useInputTheme();
  const insets = useSafeAreaInsets();
  const weekStartsOn = useStore((s) => s.settings.weekStartsOn);
  const start = initial ?? BLANK;

  const [name, setName] = useState(start.name);
  const [icon, setIcon] = useState(start.icon);
  const [color, setColor] = useState(start.color);
  const [type, setType] = useState<HabitType>(start.type);
  const [target, setTarget] = useState(start.type === 'measurable' ? String(start.target) : '');
  const [unit, setUnit] = useState(start.unit);
  const [freqKind, setFreqKind] = useState<FreqKind>(start.frequency.kind);
  const [days, setDays] = useState<Weekday[]>(
    start.frequency.kind === 'weekdays' ? start.frequency.days : [1, 3, 5],
  );
  const [perWeek, setPerWeek] = useState(start.frequency.kind === 'timesPerWeek' ? start.frequency.count : 3);
  const [reminderOn, setReminderOn] = useState(start.reminderTime !== null);
  const [reminderTime, setReminderTime] = useState(start.reminderTime ?? '09:00');

  const targetNum = Number(target.replace(',', '.'));
  const errors = [
    !name.trim() && 'Give your habit a name',
    type === 'measurable' && !(targetNum > 0) && 'Set a daily target above 0',
    freqKind === 'weekdays' && days.length === 0 && 'Pick at least one day',
  ].filter(Boolean) as string[];

  const toggleDay = (d: Weekday) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));

  const submit = () => {
    if (errors.length) return;
    const frequency: Frequency =
      freqKind === 'daily'
        ? { kind: 'daily' }
        : freqKind === 'weekdays'
          ? { kind: 'weekdays', days }
          : { kind: 'timesPerWeek', count: perWeek };
    if (reminderOn) ensurePermission().catch(() => {});
    onSubmit({
      name: name.trim(),
      icon: icon.trim() || '✅',
      color,
      frequency,
      type,
      target: type === 'measurable' ? targetNum : 1,
      unit: type === 'measurable' ? unit.trim() || 'times' : '',
      reminderTime: reminderOn ? reminderTime : null,
    });
  };

  const inputStyle = [styles.input, { color: c.text, backgroundColor: c.surfaceAlt }];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Preview + name */}
        <View style={styles.nameRow}>
          <View style={[styles.preview, { backgroundColor: alpha(tag(color), 0.18) }]}>
            <Text style={{ fontSize: 30 }}>{icon}</Text>
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Habit name"
            {...inputTheme}
            autoFocus={!initial}
            maxLength={40}
            returnKeyType="done"
            accessibilityLabel="Habit name"
            style={[inputStyle, styles.nameInput]}
          />
        </View>

        <SectionLabel>Icon</SectionLabel>
        <Card style={styles.grid}>
          {HABIT_ICONS.map((e) => (
            <Pressable
              key={e}
              onPress={() => setIcon(e)}
              accessibilityRole="button"
              accessibilityLabel={`Icon ${e}`}
              accessibilityState={{ selected: icon === e }}
              style={[styles.iconCell, icon === e && { backgroundColor: alpha(tag(color), 0.2) }]}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </Pressable>
          ))}
          <TextInput
            value={HABIT_ICONS.includes(icon) ? '' : icon}
            onChangeText={(t) => t && setIcon(t)}
            placeholder="Other…"
            {...inputTheme}
            maxLength={4}
            accessibilityLabel="Custom emoji"
            style={[inputStyle, styles.customEmoji]}
          />
        </Card>

        <SectionLabel>Color</SectionLabel>
        <View style={styles.colors}>
          {HABIT_COLORS.map((col) => (
            <Pressable
              key={col}
              onPress={() => setColor(col)}
              accessibilityRole="button"
              accessibilityLabel={`Color ${col}`}
              accessibilityState={{ selected: color === col }}
              style={[styles.swatchHit]}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: tag(col) },
                  color === col && { borderWidth: 3, borderColor: c.bg, outlineColor: tag(col), outlineWidth: 2.5, outlineStyle: 'solid' },
                ]}
              />
            </Pressable>
          ))}
        </View>

        <SectionLabel>Goal</SectionLabel>
        <Card style={{ gap: 12 }}>
          <Segmented
            options={[
              { label: 'Yes / No', value: 'boolean' as const },
              { label: 'Measurable', value: 'measurable' as const },
            ]}
            value={type}
            onChange={setType}
          />
          {type === 'measurable' ? (
            <View style={styles.targetRow}>
              <TextInput
                value={target}
                onChangeText={setTarget}
                placeholder="8"
                {...inputTheme}
                keyboardType="decimal-pad"
                accessibilityLabel="Daily target"
                style={[inputStyle, { width: 96, textAlign: 'center' }]}
              />
              <TextInput
                value={unit}
                onChangeText={setUnit}
                placeholder="glasses, minutes, pages…"
                {...inputTheme}
                maxLength={20}
                accessibilityLabel="Unit"
                style={[inputStyle, { flex: 1 }]}
              />
            </View>
          ) : (
            <Text style={{ color: c.textMuted, fontSize: 14 }}>Check it off once per day.</Text>
          )}
        </Card>

        <SectionLabel>Frequency</SectionLabel>
        <Card style={{ gap: 12 }}>
          <Segmented
            options={[
              { label: 'Daily', value: 'daily' as const },
              { label: 'Days', value: 'weekdays' as const },
              { label: 'Per week', value: 'timesPerWeek' as const },
            ]}
            value={freqKind}
            onChange={setFreqKind}
          />
          {freqKind === 'weekdays' ? (
            <View style={styles.days}>
              {orderedWeekdays(weekStartsOn).map((d) => (
                <Chip
                  key={d}
                  label={WEEKDAY_SHORT[d].slice(0, 2)}
                  selected={days.includes(d)}
                  color={tag(color)}
                  onPress={() => toggleDay(d)}
                  style={styles.dayChip}
                />
              ))}
            </View>
          ) : null}
          {freqKind === 'timesPerWeek' ? (
            <View style={styles.perWeek}>
              <IconButton name="remove" label="Fewer times" onPress={() => setPerWeek((n) => Math.max(1, n - 1))} />
              <Text style={[styles.perWeekText, { color: c.text }]}>{perWeek}× per week</Text>
              <IconButton name="add" label="More times" onPress={() => setPerWeek((n) => Math.min(6, n + 1))} />
            </View>
          ) : null}
          {freqKind === 'daily' ? (
            <Text style={{ color: c.textMuted, fontSize: 14 }}>Every day of the week.</Text>
          ) : null}
        </Card>

        <SectionLabel>Reminder</SectionLabel>
        <Card style={{ gap: 12 }}>
          <View style={styles.switchRow}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Remind me</Text>
            <ThemedSwitch value={reminderOn} onValueChange={setReminderOn} label="Remind me" />
          </View>
          {reminderOn ? <TimeStepper value={reminderTime} onChange={setReminderTime} /> : null}
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: c.bg, borderTopColor: c.border }]}>
        {errors.length && name.trim() ? (
          <Text style={{ color: c.dangerText, marginBottom: 8, textAlign: 'center' }}>{errors[0]}</Text>
        ) : null}
        <Button label={submitLabel} onPress={submit} disabled={errors.length > 0} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 24 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 50, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
  nameInput: { flex: 1, fontSize: 18, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4, padding: 10 },
  iconCell: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  customEmoji: { flexGrow: 1, marginTop: 6, textAlign: 'center' },
  colors: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 2 },
  swatchHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  targetRow: { flexDirection: 'row', gap: 10 },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  dayChip: { width: 44, paddingHorizontal: 0 },
  perWeek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  perWeekText: { fontSize: 18, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
