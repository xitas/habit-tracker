// Builds the App Store and Google Play screenshots: a caption on an indigo
// background above each app screen.
//
//   npm run screenshots
//
// Edit CAPTIONS below and run it again. Line breaks ("\n") are kept as written.
// The app screens come from store-assets/screenshots/raw/<platform>/<name>.png
// (captured from the app with sample data; replace them with new captures any time,
// keeping the file names). Output: store-assets/screenshots/ios/ and /android/.

import fs from 'node:fs';
import path from 'node:path';
import { opaquePng, pngSize, render, xml } from './lib/png.mjs';

/** Caption for each screen, in store order. */
export const CAPTIONS = {
  '1-today': 'Build habits\none step at a time',
  '2-habit-detail': 'See your\nstreaks grow',
  '3-stats': 'Track your progress\nweek by week',
  '4-habit-form': 'Yes/no or measurable,\non your schedule',
  '5-today-dark': 'Easy on the eyes,\nday or night',
  '6-backup-privacy': 'Works offline.\nYour data stays\non your phone',
};

const PLATFORMS = {
  // iPhone 6.9" display (App Store's required size)
  ios: { width: 1320, height: 2868, fontSize: 104 },
  // Android phone, 9:16 (Google Play)
  android: { width: 1080, height: 1920, fontSize: 76 },
};

const BACKGROUND = '#4F46E5';
const CAPTION_COLOR = '#FFFFFF';
const FONT = 'Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'store-assets/screenshots/raw');

for (const [platform, { width, height, fontSize }] of Object.entries(PLATFORMS)) {
  const outDir = path.join(ROOT, 'store-assets/screenshots', platform);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, caption] of Object.entries(CAPTIONS)) {
    const rawFile = path.join(RAW, platform, `${name}.png`);
    if (!fs.existsSync(rawFile)) {
      console.warn(`Skipped ${platform}/${name}: no capture at ${path.relative(ROOT, rawFile)}`);
      continue;
    }
    const raw = fs.readFileSync(rawFile);
    const size = pngSize(raw);

    // Caption: up to three lines, shrunk if a line would be wider than the canvas.
    const lines = caption.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    const fs_ = Math.min(fontSize, Math.floor((width * 0.88) / (longest * 0.56)));
    const lineHeight = fs_ * 1.18;
    const captionTop = height * 0.06;
    const captionBottom = captionTop + fontSize * 1.18 * 3; // same space for 1–3 lines, so screens line up
    const firstBaseline = captionTop + (captionBottom - captionTop - lineHeight * lines.length) / 2 + fs_;
    const text = lines
      .map((l, i) => `<text x="${width / 2}" y="${firstBaseline + i * lineHeight}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fs_}" fill="${CAPTION_COLOR}">${xml(l)}</text>`)
      .join('');

    // Screen: 84% of the width, rounded corners, running off the bottom edge.
    const shotW = width * 0.84;
    const shotH = (shotW * size.height) / size.width;
    const x = (width - shotW) / 2;
    const y = captionBottom + height * 0.03;
    const r = shotW * 0.07;
    const href = `data:image/png;base64,${raw.toString('base64')}`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs><clipPath id="screen"><rect x="${x}" y="${y}" width="${shotW}" height="${shotH}" rx="${r}"/></clipPath></defs>` +
      `<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>` +
      text +
      `<rect x="${x - 6}" y="${y - 6}" width="${shotW + 12}" height="${shotH + 12}" rx="${r + 6}" fill="#FFFFFF" fill-opacity="0.18"/>` +
      `<image href="${href}" x="${x}" y="${y}" width="${shotW}" height="${shotH}" clip-path="url(#screen)" preserveAspectRatio="none"/>` +
      `</svg>`;

    const out = path.join(outDir, `${name}.png`);
    fs.writeFileSync(out, opaquePng(render(svg, width)));
    console.log(`${path.relative(ROOT, out)} (${width}×${height})`);
  }
}
