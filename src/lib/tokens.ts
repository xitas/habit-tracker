// Every color in the app is defined here, along with the color math used to
// derive readable variants. Pure data: no React or React Native imports, so it
// can be unit-tested (see tokens.test.ts).

export type Scheme = 'light' | 'dark';
export type ThemePreference = 'system' | Scheme;

const light = {
  scheme: 'light' as Scheme,
  bg: '#F7F7F8',
  surface: '#FFFFFF',
  /** Inset fills: tracks, input fields, secondary buttons. */
  surfaceAlt: '#F0F0F2',
  /** Elements that sit above a surface (selected segment). */
  surfaceRaised: '#FFFFFF',
  text: '#1A1A1A',
  textMuted: '#6B6B6B',
  /** Icons and disabled content. Meets 3:1 (non-text) but not 4.5:1, so never body text. */
  textFaint: '#808085',
  border: '#E5E5E5',
  accent: '#4F46E5',
  onAccent: '#FFFFFF',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  // AA-compliant (≥4.5:1) versions for when a status color is used as text.
  successText: '#15803D',
  warningText: '#B45309',
  dangerText: '#DC2626',
  overlay: 'rgba(15, 15, 18, 0.4)',
  shadow: '#000000',
  /** Dark ink and light ink, for text placed on colored fills. */
  inkDark: '#1A1A1A',
  inkLight: '#FFFFFF',
};

export type Colors = typeof light;

const dark: Colors = {
  scheme: 'dark',
  bg: '#0F0F12',
  surface: '#1C1C22',
  surfaceAlt: '#26262E',
  surfaceRaised: '#34343E',
  text: '#F2F2F2',
  textMuted: '#A1A1AA',
  textFaint: '#787882',
  border: '#2E2E36',
  accent: '#818CF8',
  onAccent: '#0F0F12',
  success: '#4ADE80',
  warning: '#FBBF24',
  danger: '#F87171',
  successText: '#4ADE80',
  warningText: '#FBBF24',
  dangerText: '#F87171',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
  inkDark: '#0F0F12',
  inkLight: '#FFFFFF',
};

export const THEMES: Record<Scheme, Colors> = { light, dark };

// Habit color tags. These values are stored with each habit, so keep them stable.
export const HABIT_COLORS = [
  '#5B6CFF', '#1FA774', '#F2994A', '#E5484D', '#9B51E0',
  '#2D9CDB', '#E8B931', '#EC6FAE',
];

export const HABIT_ICONS = [
  '💧', '📚', '🧘', '🏃', '💪', '🥗', '😴', '✍️',
  '🎸', '🧹', '💊', '🚶', '🌱', '☀️', '📵', '🧠',
  '🦷', '🍎', '🚴', '🙏', '💰', '🎨', '🐕', '✅',
];

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };

/**
 * Depth for cards. Dark mode uses a border instead of a shadow, since shadows
 * disappear on dark backgrounds. Light mode uses a border plus a soft shadow:
 * white cards on the near-white background (1.07:1) need a defined edge, and
 * the legacy shadow props were too faint on iOS and ignored on Android.
 * `boxShadow` renders the same on iOS, Android and web.
 * `lift` scales the shadow (FAB > card > selected segment); `border: false`
 * is for elements whose own fill already defines their edge.
 */
export function shadow(c: Colors, lift = 3, border = true) {
  const edge = border ? { borderWidth: 1, borderColor: c.border } : {};
  if (c.scheme === 'dark') return edge;
  const near = alpha(c.shadow, 0.05);
  const far = alpha(c.shadow, Math.min(0.14, 0.02 * lift + 0.02));
  return { ...edge, boxShadow: `0px 1px 2px ${near}, 0px ${lift + 1}px ${lift * 4}px ${far}` };
}

// ---- Color math ----

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

/** Color with alpha, from a #RRGGBB hex. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Blend `hex` toward `toward` by t (0 = hex, 1 = toward). Returns #RRGGBB. */
export function mix(hex: string, toward: string, t: number): string {
  const a = rgb(hex);
  const b = rgb(toward);
  return `#${a.map((v, i) => toHex(v + (b[i] - v) * t)).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Blend `hex` toward `ink` in small steps until it reaches `min` contrast against `bg`. */
export function legible(hex: string, bg: string, ink: string, min: number): string {
  for (let t = 0; t <= 1; t += 0.1) {
    const candidate = mix(hex, ink, t);
    if (contrast(candidate, bg) >= min) return candidate;
  }
  return ink;
}

export function readableOn(fill: string, c: Colors): string {
  return contrast(c.inkLight, fill) >= contrast(c.inkDark, fill) ? c.inkLight : c.inkDark;
}

/**
 * A fill that can carry a text label at AA (4.5:1). Mid-tone colors that can't
 * reach it with either ink are deepened slightly so light ink passes.
 */
export function solidFill(fill: string, c: Colors): string {
  const best = (f: string) => Math.max(contrast(c.inkLight, f), contrast(c.inkDark, f));
  if (best(fill) >= 4.5) return fill;
  for (let t = 0.05; t <= 0.5; t += 0.05) {
    const deeper = mix(fill, '#000000', t);
    if (contrast(c.inkLight, deeper) >= 4.5) return deeper;
  }
  return mix(fill, '#000000', 0.5);
}
