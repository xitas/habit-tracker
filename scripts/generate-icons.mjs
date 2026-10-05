// Generates every app icon, splash, notification and store image from the master
// artwork in assets/icon-source/kadam-icon.svg.
//
//   npm run icons             # writes assets/*.png and store-assets/*.png
//   npm run icons -- --preview  # also writes review-screenshots/icon-preview.png
//
// The master has an indigo background and a "symbol" made of three parts (stairs,
// badge, check); each output below recolors and places that symbol. Opaque images
// (iOS / store icons) are written without an alpha channel, as Apple requires.
// The feature graphic's text uses system fonts (Segoe UI, Roboto or Arial).

import fs from 'node:fs';
import path from 'node:path';
import { opaquePng, render } from './lib/png.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MASTER = path.join(ROOT, 'assets/icon-source/kadam-icon.svg');

const INDIGO = '#4F46E5';
const LAVENDER = '#C9C6FB';
const WHITE = '#FFFFFF';
const SPLASH_LIGHT = '#F7F7F8';
const SPLASH_DARK = '#0F0F12';

// ---- Reading the master ----

const master = fs.readFileSync(MASTER, 'utf8');
const element = (id) => {
  const m = new RegExp(`<[a-z]+ id="${id}"[^>]*/>`).exec(master);
  if (!m) throw new Error(`The master SVG has no element with id="${id}"`);
  return m[0];
};
const symbolTag = /<svg id="symbol"[^>]*>/.exec(master)[0];
const attr = (name) => /"([^"]+)"/.exec(symbolTag.slice(symbolTag.indexOf(` ${name}=`)))[1];
const SYMBOL_VIEWBOX = attr('viewBox');
const [vbX, vbY, vbSize] = SYMBOL_VIEWBOX.split(/\s+/).map(Number);
/** Where the master places the symbol, as a share of the icon. */
const SYMBOL_OFFSET = Number(attr('x')) / 1024;
const SYMBOL_SIZE = Number(attr('width')) / 1024;
/**
 * Distance from the viewBox center to the symbol's farthest drawn point (the round
 * end of the bottom stair), as a share of the viewBox: what must fit in a circular mask.
 * Update it if the artwork changes shape.
 */
const SYMBOL_RADIUS = 400 / vbSize;

const recolor = (el, attr, color) => el.replace(new RegExp(`${attr}="[^"]*"`), `${attr}="${color}"`);

/**
 * The symbol at (x, y) with the given size, in these colors. `check: null` cuts the
 * check out of the badge instead (for one-color icons, where it would be invisible).
 */
function symbol(x, y, size, { stairs, badge, check }, idSuffix = '') {
  const parts = [recolor(element('stairs'), 'stroke', stairs)];
  if (check) {
    parts.push(recolor(element('badge'), 'fill', badge), recolor(element('check'), 'stroke', check));
  } else {
    const maskId = `check-cutout${idSuffix}`;
    parts.push(
      `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${vbX}" y="${vbY}" width="${vbSize}" height="${vbSize}">` +
        `<rect x="${vbX}" y="${vbY}" width="${vbSize}" height="${vbSize}" fill="#FFFFFF"/>` +
        recolor(element('check'), 'stroke', '#000000') +
        `</mask>`,
      recolor(element('badge'), 'fill', badge).replace('/>', ` mask="url(#${maskId})"/>`),
    );
  }
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${SYMBOL_VIEWBOX}">${parts.join('')}</svg>`;
}

const ON_INDIGO = { stairs: LAVENDER, badge: WHITE, check: INDIGO };
const ON_LIGHT = { stairs: INDIGO, badge: INDIGO, check: WHITE };
const ONE_COLOR = (c) => ({ stairs: c, badge: c, check: null });

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
/** Symbol centered on a square canvas, sized so it fits a circle of `circle` × the canvas (Android masks). */
const inCircle = (canvas, circle, colors) => {
  const size = (canvas * circle) / 2 / SYMBOL_RADIUS;
  return symbol((canvas - size) / 2, (canvas - size) / 2, size, colors);
};
/** The full icon: indigo square (optionally rounded) with the symbol at the master's proportions. */
const tile = (size, rounded = false, x = 0, y = 0) => {
  const r = rounded ? size * 0.2237 : 0;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${INDIGO}"/>` + symbol(x + size * SYMBOL_OFFSET, y + size * SYMBOL_OFFSET, size * SYMBOL_SIZE, ON_INDIGO);
};

// ---- Rendering ----

const written = [];
function write(rel, svgText, width, { opaque = false } = {}) {
  const image = render(svgText, width);
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, opaque ? opaquePng(image) : image.asPng());
  written.push(`${rel} (${image.width}×${image.height}${opaque ? ', no alpha' : ''})`);
  return file;
}

// ---- Outputs ----

// iOS app icon: full square, no transparency; iOS rounds the corners itself.
write('assets/icon.png', master, 1024, { opaque: true });

// Android adaptive icon. The launcher shows the middle 72/108 of the canvas through
// a mask; only a circle of 66/108 is guaranteed visible, so the symbol fits inside it.
const SAFE_ZONE = (66 / 108) * 0.97;
write('assets/android-icon-background.png', svg(1024, 1024, `<rect width="1024" height="1024" fill="${INDIGO}"/>`), 1024, { opaque: true });
write('assets/android-icon-foreground.png', svg(1024, 1024, inCircle(1024, SAFE_ZONE, ON_INDIGO)), 1024);
// Android 13+ themed icons use only the shape (alpha) of this layer.
write('assets/android-icon-monochrome.png', svg(1024, 1024, inCircle(1024, SAFE_ZONE, ONE_COLOR(WHITE))), 1024);

// Splash: the symbol, sized to stay clear of Android 12+'s circular splash mask.
// Light background: indigo symbol (lavender and white would vanish on #F7F7F8).
write('assets/splash-icon.png', svg(1024, 1024, inCircle(1024, 0.94, ON_LIGHT)), 1024);
write('assets/splash-icon-dark.png', svg(1024, 1024, inCircle(1024, 0.94, ON_INDIGO)), 1024);

// Android notification icon: all white on transparent (Android tints it with the accent color).
write('assets/notification-icon.png', svg(96, 96, symbol(4, 4, 88, ONE_COLOR(WHITE))), 96);

// Web favicon: the rounded icon.
write('assets/favicon.png', svg(48, 48, tile(48, true)), 48);

// Store assets.
write('store-assets/app-store-icon-1024.png', master, 1024, { opaque: true });
write('store-assets/play-store-icon-512.png', master, 512, { opaque: true }); // Google Play rounds the corners
const FONT = `font-family="Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif" font-weight="700"`;
write(
  'store-assets/feature-graphic-1024x500.png',
  svg(
    1024,
    500,
    `<rect width="1024" height="500" fill="${INDIGO}"/>` +
      symbol(64, 110, 280, ON_INDIGO) +
      `<text x="376" y="232" ${FONT} font-size="76" fill="${WHITE}">Kadam:</text>` +
      `<text x="376" y="318" ${FONT} font-size="64" fill="${LAVENDER}">Habit Tracker</text>`,
  ),
  1024,
  { opaque: true },
);

// ---- Preview sheet (npm run icons -- --preview) ----

if (process.argv.includes('--preview')) {
  const png = (rel) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, rel)).toString('base64')}`;
  const icon = png('assets/icon.png');
  const fg = png('assets/android-icon-foreground.png');
  const mono = png('assets/android-icon-monochrome.png');
  const notif = png('assets/notification-icon.png');
  let defs = '';
  let clip = 0;
  /** iOS-style rounded icon. */
  const ios = (x, y, s) => {
    const id = `c${clip++}`;
    defs += `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.2237}"/></clipPath>`;
    return `<image href="${icon}" x="${x}" y="${y}" width="${s}" height="${s}" clip-path="url(#${id})"/>`;
  };
  /** Android adaptive icon in a round mask: the visible circle is the middle 72/108 of the layers. */
  const round = (x, y, s, layer = fg, bg = INDIGO) => {
    const id = `c${clip++}`;
    const full = (s * 108) / 72;
    const off = (full - s) / 2;
    defs += `<clipPath id="${id}"><circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}"/></clipPath>`;
    return (
      `<g clip-path="url(#${id})"><rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${bg}"/>` +
      `<image href="${layer}" x="${x - off}" y="${y - off}" width="${full}" height="${full}"/></g>`
    );
  };
  /** Themed (Android 13+) icon: the monochrome shape tinted dark on a pale tile, as Material You does. */
  const themed = (x, y, s) => {
    const id = `c${clip++}`;
    const full = (s * 108) / 72;
    const off = (full - s) / 2;
    defs += `<clipPath id="${id}"><circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}"/></clipPath>` +
      `<filter id="t${id}"><feFlood flood-color="#1E1B4B"/><feComposite in2="SourceAlpha" operator="in"/></filter>`;
    return `<g clip-path="url(#${id})"><rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#E0DEFF"/>` +
      `<image href="${mono}" x="${x - off}" y="${y - off}" width="${full}" height="${full}" filter="url(#t${id})"/></g>`;
  };
  const label = (x, y, text, color) => `<text x="${x}" y="${y}" font-family="Segoe UI, Arial" font-size="14" fill="${color}">${text}</text>`;
  const panel = (x0, bg, ink) => {
    let out = `<rect x="${x0}" y="0" width="760" height="760" fill="${bg}"/>`;
    out += label(x0 + 24, 36, bg === SPLASH_LIGHT ? 'On light' : 'On dark', ink);
    out += ios(x0 + 24, 56, 256) + label(x0 + 24, 336, 'iOS 256', ink);
    let x = x0 + 310;
    for (const s of [120, 60, 48, 29]) {
      out += ios(x, 56 + (120 - s), s) + label(x, 200, `${s}`, ink);
      x += s + 28;
    }
    out += label(x0 + 310, 236, 'Android round (adaptive)', ink);
    x = x0 + 310;
    for (const s of [144, 72, 48]) {
      out += round(x, 252 + (144 - s), s) + label(x, 420, `${s}`, ink);
      x += s + 28;
    }
    out += label(x0 + 24, 470, 'Android 13 themed (monochrome)', ink);
    out += themed(x0 + 24, 486, 96) + themed(x0 + 140, 534, 48);
    out += label(x0 + 310, 470, 'Notification (tinted #4F46E5, 24 and 48)', ink);
    out += `<rect x="${x0 + 310}" y="486" width="200" height="72" rx="12" fill="${bg === SPLASH_LIGHT ? '#FFFFFF' : '#1C1C22'}"/>`;
    out += `<filter id="n${x0}"><feFlood flood-color="${INDIGO}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`;
    out += `<image href="${notif}" x="${x0 + 330}" y="510" width="24" height="24" filter="url(#n${x0})"/>`;
    out += `<image href="${notif}" x="${x0 + 380}" y="498" width="48" height="48" filter="url(#n${x0})"/>`;
    out += label(x0 + 24, 616, 'Splash', ink);
    const splash = png(bg === SPLASH_LIGHT ? 'assets/splash-icon.png' : 'assets/splash-icon-dark.png');
    out += `<rect x="${x0 + 24}" y="630" width="110" height="110" rx="10" fill="${bg}" stroke="${ink}" stroke-opacity="0.2"/>`;
    out += `<image href="${splash}" x="${x0 + 44}" y="650" width="70" height="70"/>`;
    return out;
  };
  const body = panel(0, SPLASH_LIGHT, '#18181B') + panel(760, SPLASH_DARK, '#F4F4F5');
  write('review-screenshots/icon-preview.png', svg(1520, 760, `<defs>${defs}</defs>${body}`), 1520);
}

console.log(`Generated from ${path.relative(ROOT, MASTER)}:\n  ${written.join('\n  ')}`);
