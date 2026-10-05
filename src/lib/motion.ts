import { useReducedMotion } from 'react-native-reanimated';

import { motionPlan, type MotionPlan } from './motionPolicy';

/** Animations to use, following the phone's "reduce motion" accessibility setting. */
export function useMotion(): MotionPlan {
  return motionPlan(useReducedMotion());
}
