import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { askForReminders } from '@/lib/notifications';
import { addHabit, type HabitDraft } from '@/lib/store';
import { alpha, HABIT_COLORS, radius, shadow, useTheme } from '@/lib/theme';
import { Button, Emoji } from './ui';

export const SUGGESTED_HABITS: (HabitDraft & { blurb: string })[] = [
  {
    name: 'Drink water',
    icon: '💧',
    color: HABIT_COLORS[5],
    frequency: { kind: 'daily' },
    type: 'measurable',
    target: 8,
    unit: 'glasses',
    reminderTime: null,
    blurb: '8 glasses a day',
  },
  {
    name: 'Read',
    icon: '📚',
    color: HABIT_COLORS[4],
    frequency: { kind: 'daily' },
    type: 'measurable',
    target: 30,
    unit: 'minutes',
    reminderTime: '21:00',
    blurb: '30 minutes a day',
  },
  {
    name: 'Meditate',
    icon: '🧘',
    color: HABIT_COLORS[1],
    frequency: { kind: 'daily' },
    type: 'boolean',
    target: 1,
    unit: '',
    reminderTime: '07:30',
    blurb: 'Once a day',
  },
];

/** Suggested habits that aren't added yet (matched by name). */
export function remainingSuggestions(existingNames: string[]) {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return SUGGESTED_HABITS.filter((s) => !taken.has(s.name.toLowerCase()));
}

/** One-tap cards for suggested habits. */
export function SuggestionList({ suggestions }: { suggestions: typeof SUGGESTED_HABITS }) {
  const { c, tag, tagInk } = useTheme();
  return (
    <View style={styles.list}>
      {suggestions.map(({ blurb, ...draft }) => (
        <Pressable
          key={draft.name}
          accessibilityRole="button"
          accessibilityLabel={`Add ${draft.name}, ${blurb}`}
          onPress={() => {
            addHabit(draft);
            if (draft.reminderTime) askForReminders().catch(() => {});
          }}
          style={({ pressed }) => [
            styles.suggestion,
            { backgroundColor: c.surface, opacity: pressed ? 0.85 : 1 },
            shadow(c),
          ]}
        >
          <View style={[styles.icon, { backgroundColor: alpha(tag(draft.color), 0.15) }]}>
            <Emoji size={24}>{draft.icon}</Emoji>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: c.text }]}>{draft.name}</Text>
            <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>{blurb}</Text>
          </View>
          <View style={[styles.add, { backgroundColor: alpha(tag(draft.color), 0.15) }]}>
            <Ionicons name="add" size={24} color={tagInk(draft.color)} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { c } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={styles.hero}>🌱</Text>
      <Text style={[styles.title, { color: c.text }]}>Start small, stay steady</Text>
      <Text style={[styles.body, { color: c.textMuted }]}>
        Pick a habit to begin with. You can change it anytime.
      </Text>

      <View style={styles.listGap}>
        <SuggestionList suggestions={SUGGESTED_HABITS} />
      </View>

      <Button label="Create your own" variant="secondary" icon="create-outline" onPress={onCreate} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  hero: { fontSize: 56, textAlign: 'center', marginTop: 8 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  body: { fontSize: 15, textAlign: 'center', marginTop: 6, lineHeight: 21 },
  list: { gap: 12 },
  listGap: { marginTop: 24, marginBottom: 16 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, minHeight: 76 },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 17, fontWeight: '700' },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
