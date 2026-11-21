#!/usr/bin/env node
// Draws sample advert banners (1200x600) for the test environment into deploy/demo/ads/<key>.jpg,
// using the drawn product pictures from deploy/demo/photos. Run draw-photos.mjs first.
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(join(here, '../../apps/api/package.json'))('sharp');
const out = join(here, 'ads');

/** The sample campaigns; demo-catalog.ts creates matching ad_campaigns rows. */
export const sampleAds = [
  {
    key: 'ahia-shop-local',
    advertiser: 'Ahia',
    lines: ['Shop Local,', 'Shop Smart!'],
    sub: 'Find the best products around you.',
    cta: 'Explore now',
    bg: ['#26408f', '#1a2f6e'],
    ink: '#ffffff',
    accent: '#f5a524',
    photo: 'gift-hamper',
  },
  {
    key: 'freshmart',
    advertiser: 'FreshMart Supermarket',
    lines: ['Weekend groceries', '10% off'],
    sub: 'Lekki · Ikeja · Surulere stores',
    cta: 'See the offer',
    bg: ['#1f6f43', '#155232'],
    ink: '#ffffff',
    accent: '#ffd36e',
    photo: 'tomatoes-basket',
  },
  {
    key: 'quickfix',
    advertiser: 'QuickFix Phone Repairs',
    lines: ['Cracked screen?', 'Fixed in 1 hour'],
    sub: 'Computer Village, Ikeja · 3-month warranty',
    cta: 'Book a repair',
    bg: ['#1d2a52', '#111a36'],
    ink: '#ffffff',
    accent: '#7fd6ff',
    photo: 'android-phone',
  },
  {
    key: 'swiftride',
    advertiser: 'SwiftRide Logistics',
    lines: ['Free delivery', 'over ₦20,000'],
    sub: 'Same-day across Lagos',
    cta: 'Ship with us',
    bg: ['#e2532b', '#b83c19'],
    ink: '#ffffff',
    accent: '#ffe08a',
    photo: 'bicycle',
  },
  {
    key: 'golden-crust',
    advertiser: 'Golden Crust Bakery',
    lines: ['Fresh bread', 'every morning'],
    sub: 'Celebration cakes with 2 days’ notice',
    cta: 'Order now',
    bg: ['#fff1d6', '#f7dca5'],
    ink: '#3b2600',
    accent: '#c0392b',
    photo: 'sliced-bread',
  },
];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function banner(ad) {
  const W = 1200,
    H = 600,
    R = 190,
    cx = 975,
    cy = 300;
  // Long headlines shrink so they never reach the picture.
  const longest = Math.max(...ad.lines.map((l) => l.length));
  const size = longest > 15 ? 58 : longest > 12 ? 66 : 76;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ad.bg[0]}"/><stop offset="1" stop-color="${ad.bg[1]}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${cx + 120}" cy="${cy - 180}" r="160" fill="${ad.accent}" opacity=".18"/>
  <circle cx="${cx - 180}" cy="${cy + 220}" r="90" fill="${ad.accent}" opacity=".16"/>
  <circle cx="${cx}" cy="${cy}" r="${R + 18}" fill="#ffffff" opacity=".95"/>
  ${[0, 1, 2].map((i) => `<path d="M${cx - R - 70 + i * 8} ${150 + i * 32} l34 -12" stroke="${ad.accent}" stroke-width="10" stroke-linecap="round"/>`).join('')}
  <text x="70" y="200" font-family="Helvetica Neue, Helvetica, Arial" font-size="${size}" font-weight="900" fill="${ad.ink}">${esc(ad.lines[0])}</text>
  <text x="70" y="290" font-family="Helvetica Neue, Helvetica, Arial" font-size="${size}" font-weight="900" fill="${ad.accent}">${esc(ad.lines[1])}</text>
  <text x="72" y="360" font-family="Helvetica Neue, Helvetica, Arial" font-size="${ad.sub.length > 32 ? 24 : 30}" font-weight="600" fill="${ad.ink}" opacity=".92">${esc(ad.sub)}</text>
  <rect x="70" y="410" rx="36" width="${ad.cta.length * 21 + 90}" height="72" fill="${ad.accent}"/>
  <text x="${70 + (ad.cta.length * 21 + 90) / 2}" y="457" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-size="32" font-weight="800" fill="${ad.ink === '#ffffff' ? '#18213a' : '#ffffff'}">${esc(ad.cta)} →</text>
</svg>`;
  const photo = await sharp(join(here, 'photos', `${ad.photo}.jpg`))
    .resize(R * 2, R * 2, { fit: 'cover' })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${R * 2}" height="${R * 2}"><circle cx="${R}" cy="${R}" r="${R}" fill="#fff"/></svg>`,
        ),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
  await sharp(Buffer.from(svg))
    .composite([{ input: photo, left: cx - R, top: cy - R }])
    .jpeg({ quality: 88 })
    .toFile(join(out, `${ad.key}.jpg`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(out, { recursive: true });
  for (const ad of sampleAds) await banner(ad);
  console.log(`Drew ${sampleAds.length} advert banners in ${out}`);
}
