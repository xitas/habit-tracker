import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { HabitForm } from '@/components/HabitForm';
import { updateHabit, useStore } from '@/lib/store';

export default function EditHabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const habit = useStore((s) => s.habits.find((h) => h.id === id));
  if (!habit) return <Text style={{ padding: 20 }}>Habit not found.</Text>;

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
