import { router } from 'expo-router';

import { HabitForm } from '@/components/HabitForm';
import { addHabit } from '@/lib/store';

export default function NewHabitScreen() {
  return (
    <HabitForm
      submitLabel="Create habit"
      onSubmit={(draft) => {
        addHabit(draft);
        router.back();
      }}
    />
  );
}
