import { contrast, HABIT_COLORS, legible, mix, readableOn, solidFill, THEMES, type Colors, type Scheme } from './tokens';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const atLeast = (name: string, fg: string, bg: string, min: number) => {
  const r = contrast(fg, bg);
  check(name, r >= min, `${fg} on ${bg} = ${r.toFixed(2)}, need ${min}`);
};

// Mirrors the hook helpers in theme.ts.
const tag = (s: Scheme, hex: string) => (s === 'dark' ? mix(hex, THEMES.dark.bg, 0.14) : hex);
const tagInk = (s: Scheme, hex: string) => legible(tag(s, hex), mix(THEMES[s].surface, tag(s, hex), 0.15), THEMES[s].text, 3);

const SPEC: Record<Scheme, Partial<Colors>> = {
  light: { bg: '#F7F7F8', surface: '#FFFFFF', text: '#1A1A1A', textMuted: '#6B6B6B', border: '#E5E5E5',
    accent: '#4F46E5', success: '#22C55E', warning: '#F59E0B', danger: '#EF4444' },
  dark: { bg: '#0F0F12', surface: '#1C1C22', text: '#F2F2F2', textMuted: '#A1A1AA', border: '#2E2E36',
    accent: '#818CF8', success: '#4ADE80', warning: '#FBBF24', danger: '#F87171' },
};

for (const s of ['light', 'dark'] as Scheme[]) {
  const c = THEMES[s];
  console.log(`--- ${s}`);
  for (const [k, v] of Object.entries(SPEC[s])) check(`spec ${k}`, c[k as keyof Colors] === v, `${c[k as keyof Colors]}`);

  // Body and secondary text on every surface they appear on.
  for (const bg of ['bg', 'surface', 'surfaceAlt', 'surfaceRaised'] as const) {
    atLeast(`text on ${bg}`, c.text, c[bg], 4.5);
    atLeast(`textMuted on ${bg}`, c.textMuted, c[bg], 4.5);
  }
  // Faint is for icons/disabled content: needs 3:1 on every surface.
  for (const bg of ['bg', 'surface', 'surfaceAlt'] as const) atLeast(`textFaint icons on ${bg} (3:1)`, c.textFaint, c[bg], 3);
  // Accent used as text: ghost buttons, active tab label.
  atLeast('accent text on bg', c.accent, c.bg, 4.5);
  atLeast('accent text on surface', c.accent, c.surface, 4.5);
  atLeast('onAccent on accent (primary button, FAB)', c.onAccent, c.accent, 4.5);
  for (const k of ['successText', 'warningText', 'dangerText'] as const) {
    atLeast(`${k} on surface`, c[k], c.surface, 4.5);
    atLeast(`${k} on bg`, c[k], c.bg, 4.5);
  }
  // Text placed on status fills (swipe backgrounds, status chips, danger button).
  for (const k of ['success', 'warning', 'danger', 'accent'] as const) {
    atLeast(`ink on ${k} fill`, readableOn(c[k], c), c[k], 4.5);
    const chip = solidFill(c[k], c);
    atLeast(`status chip label on ${k}`, readableOn(chip, c), chip, 4.5);
  }
  // Heatmap day numbers on every ramp level.
  for (const level of [0.3, 0.5, 0.7]) {
    const fill = mix(c.surface, c.accent, level);
    atLeast(`ink on heatmap partial ${level}`, readableOn(fill, c), fill, 4.5);
  }
  check('heatmap ramp is ordered (empty subtle → done strongest)',
    contrast(mix(c.surface, c.accent, 0.3), c.surface) < contrast(mix(c.surface, c.accent, 0.7), c.surface) &&
      contrast(mix(c.surface, c.accent, 0.7), c.surface) < contrast(c.accent, c.surface));

  for (const hex of HABIT_COLORS) {
    const chip = solidFill(tag(s, hex), c);
    atLeast(`selected chip label on tag ${hex}`, readableOn(chip, c), chip, 4.5);
    atLeast(`check-mark icon on tag ${hex} (3:1)`, readableOn(tag(s, hex), c), tag(s, hex), 3);
    atLeast(`icon in tag ${hex} on surface (3:1)`, tagInk(s, hex), c.surface, 3);
    atLeast(`icon in tag ${hex} on its tint (3:1)`, tagInk(s, hex), mix(c.surface, tag(s, hex), 0.15), 3);
  }
  if (s === 'dark') check('dark bg is soft, not pure black', c.bg !== '#000000' && c.surface !== '#000000');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
