// Which animations run, given the phone's "reduce motion" setting. Pure so it can be tested;
// components read it through useMotion() in motion.ts.

export interface MotionPlan {
  /** Falling confetti when the day is complete. */
  confetti: boolean;
  /** A short, non-moving "All done" confirmation instead of confetti. */
  staticCelebration: boolean;
  /** The check-mark "pop" when a habit is completed. */
  checkPop: boolean;
  /** The progress ring sweeping to its new value (otherwise it jumps). */
  animateRing: boolean;
  /** The undo snackbar sliding in (otherwise it simply appears). */
  slideSnackbar: boolean;
}

export function motionPlan(reduceMotion: boolean): MotionPlan {
  return {
    confetti: !reduceMotion,
    staticCelebration: reduceMotion,
    checkPop: !reduceMotion,
    animateRing: !reduceMotion,
    slideSnackbar: !reduceMotion,
  };
}
