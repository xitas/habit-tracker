import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatLong } from '@/lib/dates';
import { saveEntry } from '@/lib/store';
import { alpha, radius, useTheme } from '@/lib/theme';
import type { Entry, EntryStatus, Habit } from '@/lib/types';
import { stepFor } from './HabitCard';
import { Button, Chip, IconButton, useInputTheme } from './ui';

type Props = {
  habit: Habit;
  date: string;
  entry?: Entry;
  isToday: boolean;
  onClose: () => void;
  onOpenHabit?: () => void;
};

/**
 * Bottom sheet to set a day's status, value and note. Used on Today (long-press) and for backfilling.
 * State is seeded from `entry` on mount, so render it with a key per habit + date.
 */
export function EntrySheet({ habit, date, entry, isToday, onClose, onOpenHabit }: Props) {
  const { c, isDark, tag, tagInk } = useTheme();
  const inputTheme = useInputTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<EntryStatus>(entry?.status ?? 'missed');
  const [value, setValue] = useState(entry?.value ?? 0);
  const [text, setText] = useState(String(entry?.value ?? 0));
  const [note, setNote] = useState(entry?.note ?? '');

  const measurable = habit.type === 'measurable';

  const updateValue = (v: number) => {
    const next = Math.max(0, Math.round(v * 100) / 100);
    setValue(next);
    setText(String(next));
    if (status !== 'skipped') setStatus(next >= habit.target ? 'done' : 'missed');
  };

  const pickStatus = (s: EntryStatus) => {
    setStatus(s);
    if (!measurable) return;
    if (s === 'done' && value < habit.target) updateValueRaw(habit.target);
    if (s === 'missed' && value >= habit.target) updateValueRaw(0);
  };
  const updateValueRaw = (v: number) => {
    setValue(v);
    setText(String(v));
  };

  const save = () => {
    saveEntry(habit, date, value, status, note);
    onClose();
  };

  const statusOptions: { label: string; value: EntryStatus; color: string }[] = [
    { label: 'Done', value: 'done', color: c.success },
    { label: 'Skipped', value: 'skipped', color: c.warning },
    { label: isToday ? 'Not yet' : 'Missed', value: 'missed', color: isToday ? c.textMuted : c.danger },
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable style={[styles.fill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 },
            // Dark mode has no shadows, so a hairline edge separates the sheet from the dimmed screen.
            isDark && { borderWidth: 1, borderBottomWidth: 0, borderColor: c.border },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <View style={styles.headRow}>
            <View style={[styles.icon, { backgroundColor: alpha(tag(habit.color), 0.15) }]}>
              <Text style={{ fontSize: 22 }}>{habit.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                {habit.name}
              </Text>
              <Text style={{ color: c.textMuted, fontSize: 14 }}>{isToday ? 'Today' : formatLong(date)}</Text>
            </View>
            {onOpenHabit ? (
              <IconButton name="stats-chart-outline" label="Open habit details" onPress={onOpenHabit} />
            ) : null}
          </View>

          {measurable ? (
            <View style={styles.valueRow}>
              <IconButton name="remove" label="Decrease" size={26} onPress={() => updateValue(value - stepFor(habit.target))} />
              <View style={{ alignItems: 'center', flex: 1 }}>
                <TextInput
                  {...inputTheme}
                  value={text}
                  onChangeText={(t) => {
                    setText(t);
                    const n = Number(t.replace(',', '.'));
                    if (t.trim() !== '' && Number.isFinite(n)) {
                      setValue(Math.max(0, n));
                      if (status !== 'skipped') setStatus(n >= habit.target ? 'done' : 'missed');
                    }
                  }}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  accessibilityLabel={`Value in ${habit.unit}`}
                  style={[styles.valueInput, { color: c.text }]}
                />
                <Text style={{ color: c.textMuted, fontSize: 14 }}>
                  of {habit.target} {habit.unit}
                </Text>
              </View>
              <IconButton
                name="add"
                label="Increase"
                size={26}
                bg={alpha(tag(habit.color), 0.15)}
                color={tagInk(habit.color)}
                onPress={() => updateValue(value + stepFor(habit.target))}
              />
            </View>
          ) : null}

          <View style={styles.chips}>
            {statusOptions.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={status === o.value}
                color={o.color}
                onPress={() => pickStatus(o.value)}
                style={{ flex: 1 }}
              />
            ))}
          </View>

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add a note (optional)"
            {...inputTheme}
            multiline
            maxLength={280}
            style={[styles.note, { color: c.text, backgroundColor: c.surfaceAlt }]}
          />

          <Button label="Save" onPress={save} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 16,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '700' },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  valueInput: { fontSize: 40, fontWeight: '800', textAlign: 'center', minWidth: 120, padding: 0 },
  chips: { flexDirection: 'row', gap: 8 },
  note: { minHeight: 80, borderRadius: radius.md, padding: 14, fontSize: 15, textAlignVertical: 'top' },
});
