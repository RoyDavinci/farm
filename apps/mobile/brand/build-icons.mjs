// Builds every Zuru icon and store image from brand/glyph.svg.
//   node apps/mobile/brand/build-icons.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../api/package.json'));
const sharp = require('sharp');

export const ORANGE = '#F0954E';
const glyph = readFileSync(join(here, 'glyph.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const assets = join(here, '../assets'),
  store = join(here, '../store'),
  admin = join(here, '../../admin/public');
for (const d of [assets, store, admin]) mkdirSync(d, { recursive: true });

/** The mark scaled to `scale` of a size×size canvas, optionally on an orange background. */
function svg(size, { scale = 0.8, bg = null, radius = 0, white = false, height = size } = {}) {
  const s = (size * scale) / 1024,
    x = (size - 1024 * s) / 2,
    y = (height - 1024 * s) / 2;
  const mark = white ? glyph.replace(/#F0954E/g, 'transparent') : glyph;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 ${size} ${height}">` +
      (bg ? `<rect width="${size}" height="${height}" rx="${radius}" fill="${bg}"/>` : '') +
      `<g transform="translate(${x} ${y}) scale(${s})">${mark}</g></svg>`,
  );
}
const png = (buf, file, opaque = false) => {
  let img = sharp(buf).png();
  if (opaque) img = img.flatten({ background: ORANGE }).removeAlpha();
  return img.toFile(file);
};

await Promise.all([
  // iOS / Expo main icon: full bleed, no transparency (the OS rounds the corners).
  png(svg(1024, { scale: 0.86, bg: ORANGE }), join(assets, 'icon.png'), true),
  // Android adaptive icon: mark inside the central safe zone; background colour set in app.json.
  png(svg(1024, { scale: 0.62 }), join(assets, 'adaptive-icon.png')),
  // Android 13+ themed (monochrome) icon.
  png(svg(1024, { scale: 0.62, white: true }), join(assets, 'adaptive-monochrome.png')),
  // Splash: white mark on the orange splash background.
  png(svg(1024, { scale: 0.9 }), join(assets, 'splash-icon.png')),
  // Android notification icon: white silhouette only.
  png(svg(96, { scale: 0.92, white: true }), join(assets, 'notification-icon.png')),
  // Web favicon.
  png(svg(48, { scale: 0.86, bg: ORANGE, radius: 10 }), join(assets, 'favicon.png')),
  // Admin console favicon and home-screen icon.
  png(svg(64, { scale: 0.86, bg: ORANGE, radius: 14 }), join(admin, 'favicon.png')),
  png(svg(180, { scale: 0.86, bg: ORANGE }), join(admin, 'apple-touch-icon.png'), true),
  // Store listings.
  png(svg(1024, { scale: 0.86, bg: ORANGE }), join(store, 'app-store-icon-1024.png'), true),
  png(svg(512, { scale: 0.86, bg: ORANGE }), join(store, 'play-store-icon-512.png'), true),
]);

// Play Store feature graphic (1024×500): mark, name and tagline.
const s = 380 / 1024;
await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
      <rect width="1024" height="500" fill="${ORANGE}"/>
      <g transform="translate(60 60) scale(${s})">${glyph}</g>
      <text x="480" y="250" font-family="Helvetica Neue, Helvetica, Arial" font-size="150" font-weight="800" fill="#fff" letter-spacing="-4">Zuru</text>
      <text x="486" y="320" font-family="Helvetica Neue, Helvetica, Arial" font-size="40" font-weight="600" fill="#fff" opacity="0.92">Shop. Send. Receive.</text>
    </svg>`,
  ),
)
  .flatten({ background: ORANGE })
  .png()
  .toFile(join(store, 'play-feature-graphic-1024x500.png'));
console.log('Zuru icons written to apps/mobile/assets, apps/mobile/store and apps/admin/public');
