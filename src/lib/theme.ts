// Theme hooks. Components read color tokens from useTheme(); nothing outside
// tokens.ts should contain a color literal.

import { useColorScheme } from 'react-native';

import { useStore } from './store';
import { legible, mix, readableOn, solidFill, THEMES, type Scheme } from './tokens';

export * from './tokens';

/** Resolve the user's preference against the OS setting. */
export function useScheme(): Scheme {
  const pref = useStore((s) => s.settings.theme);
  const system = useColorScheme();
  if (pref !== 'system') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  const scheme = useScheme();
  const c = THEMES[scheme];
  const isDark = scheme === 'dark';
  return {
    c,
    isDark,
    /** A habit's color tag, toned down in dark mode so it doesn't glare. */
    tag: (hex: string) => (isDark ? mix(hex, c.bg, 0.14) : hex),
    /** Readable text/icon color to put on top of a fill. */
    onColor: (fill: string) => readableOn(fill, c),
    /** A version of `fill` that can carry a text label at AA contrast. */
    solid: (fill: string) => solidFill(fill, c),
    /** A tag color nudged toward the text color until icons drawn in it reach 3:1 on surfaces. */
    // Checked against the 15% tint these icons usually sit on (stricter than the bare surface).
    tagInk: (hex: string) => {
      const t = isDark ? mix(hex, c.bg, 0.14) : hex;
      return legible(t, mix(c.surface, t, 0.15), c.text, 3);
    },
  };
}

