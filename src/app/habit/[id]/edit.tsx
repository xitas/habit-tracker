import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { HabitForm } from '@/components/HabitForm';
import { useTheme } from '@/lib/theme';
import { updateHabit, useStore } from '@/lib/store';

export default function EditHabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const habit = useStore((s) => s.habits.find((h) => h.id === id));
  const { c } = useTheme();
  if (!habit) return <Text style={{ padding: 20, color: c.textMuted }}>Habit not found.</Text>;

  return (
    <HabitForm
      initial={habit}
      submitLabel="Save changes"
      onSubmit={(draft) => {
        updateHabit(habit.id, draft);
        router.back();
      }}
    />
  );
}
