#!/usr/bin/env node
// Draws an illustrated product picture for every demo product (no downloads, no licences):
// vector drawings rendered to deploy/demo/photos/<slug>.jpg (git-ignored).
//   node deploy/demo/draw-photos.mjs            all products
//   node deploy/demo/draw-photos.mjs slug …     only these
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoSellers } from '../../apps/api/src/database/demo-catalog-data.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(join(here, '../../apps/api/package.json'))('sharp');
const out = join(here, 'photos');

// ---------- helpers ----------
let defs = [],
  gid = 0;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) =>
  '#' +
  c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const shade = (h, a) => toHex(hex(h).map((v) => (a > 0 ? v + (255 - v) * a : v * (1 + a))));
const lg = (a, b, x2 = 0, y2 = 1) => {
  const id = `g${gid++}`;
  defs.push(
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`,
  );
  return `url(#${id})`;
};
const rg = (c, cx = 0.35, cy = 0.3) => {
  const id = `g${gid++}`;
  defs.push(
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.8"><stop offset="0" stop-color="${shade(c, 0.35)}"/><stop offset="0.6" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.3)}"/></radialGradient>`,
  );
  return `url(#${id})`;
};
const vg = (c) => lg(shade(c, 0.25), shade(c, -0.25), 1, 0); // side-lit cylinder
const hg = (c) => lg(shade(c, 0.2), shade(c, -0.2)); // top-lit
const g = (body, t = '') => `<g ${t ? `transform="${t}"` : ''}>${body}</g>`;
const circle = (x, y, r, f, extra = '') =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" ${extra}/>`;
const ell = (x, y, rx, ry, f, extra = '') =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}" ${extra}/>`;
const rect = (x, y, w, h, r, f, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}" ${extra}/>`;
const path = (d, f, extra = '') => `<path d="${d}" fill="${f}" ${extra}/>`;
const line = (d, s, w = 6, extra = '') =>
  `<path d="${d}" fill="none" stroke="${s}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const text = (x, y, s, size, f, w = 800, extra = '') =>
  `<text x="${x}" y="${y}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${w}" fill="${f}" ${extra.includes('text-anchor') ? '' : 'text-anchor="middle"'} ${extra}>${s}</text>`;
const shine = (x, y, rx, ry, rot = -30, o = 0.45) =>
  ell(x, y, rx, ry, '#fff', `opacity="${o}" transform="rotate(${rot} ${x} ${y})"`);
const rnd = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------- produce ----------
const tomato = (x, y, r, c = '#e23b2e') =>
  circle(x, y, r, rg(c)) +
  path(
    `M${x} ${y - r * 0.82} l${r * 0.12} ${-r * 0.22} l${r * 0.05} ${r * 0.2} l${r * 0.3} ${-r * 0.05} l${-r * 0.2} ${r * 0.18} l${r * 0.22} ${r * 0.18} l${-r * 0.32} ${-r * 0.04} l${-r * 0.15} ${r * 0.2} l${-r * 0.08} ${-r * 0.22} l${-r * 0.3} ${r * 0.08} l${r * 0.18} ${-r * 0.2} l${-r * 0.24} ${-r * 0.12} z`,
    '#3d8a2f',
  ) +
  shine(x - r * 0.38, y - r * 0.35, r * 0.22, r * 0.12);
const basket = (x, y, w, h, c = '#b9803f') => {
  let s = path(
    `M${x - w / 2} ${y} L${x + w / 2} ${y} L${x + w * 0.4} ${y + h} L${x - w * 0.4} ${y + h} Z`,
    hg(c),
  );
  for (let i = 1; i < 5; i++)
    s += line(
      `M${x - w / 2 + (w * 0.1 * i) / 5} ${y + (h * i) / 5} H${x + w / 2 - (w * 0.1 * i) / 5}`,
      shade(c, -0.3),
      5,
    );
  for (let i = -4; i <= 4; i++)
    s += line(`M${x + (i * w) / 10} ${y} L${x + (i * w * 0.8) / 10} ${y + h}`, shade(c, -0.25), 4);
  return s + rect(x - w / 2 - 12, y - 16, w + 24, 32, 16, hg(shade(c, -0.1)));
};
const pepperBonnet = (x, y, s, c) =>
  g(
    ell(-30, 10, 52, 46, rg(c)) +
      ell(30, 10, 52, 46, rg(c)) +
      ell(0, 22, 58, 50, rg(c)) +
      path(
        'M-6 -32 q6 -40 30 -46',
        'none',
        `stroke="#3f7d2c" stroke-width="12" stroke-linecap="round"`,
      ) +
      ell(0, -30, 26, 12, '#4f8f35') +
      shine(-26, -4, 16, 9),
    `translate(${x} ${y}) scale(${s})`,
  );
const bellPepper = (x, y, s, c) =>
  g(
    path(
      'M-70 -40 C-110 30 -80 120 -30 130 C-10 140 10 140 30 130 C80 120 110 30 70 -40 C40 -70 -40 -70 -70 -40Z',
      rg(c),
    ) +
      line('M0 -50 C-6 20 -6 90 0 130', shade(c, -0.25), 6, 'opacity=".5"') +
      path(
        'M-6 -56 q4 -40 26 -52',
        'none',
        `stroke="#3f7d2c" stroke-width="14" stroke-linecap="round"`,
      ) +
      ell(0, -54, 34, 14, '#4f8f35') +
      shine(-40, -10, 18, 40, 10),
    `translate(${x} ${y}) scale(${s})`,
  );
const onion = (x, y, s, c = '#8e3a6e') =>
  g(
    path(
      'M0 -120 C30 -80 110 -40 110 30 C110 100 60 130 0 130 C-60 130 -110 100 -110 30 C-110 -40 -30 -80 0 -120Z',
      rg(c),
    ) +
      line(
        'M0 -110 C40 -40 50 60 0 128 M0 -110 C-40 -40 -50 60 0 128',
        shade(c, 0.3),
        4,
        'opacity=".6"',
      ) +
      line('M-12 130 l-8 22 M0 132 l0 24 M12 130 l8 22', '#d9c6a3', 4) +
      shine(-50, -10, 16, 40, 20),
    `translate(${x} ${y}) scale(${s})`,
  );
const leafBunch = (x, y, s, c = '#3f9a3a') => {
  let b = '';
  for (let i = -3; i <= 3; i++)
    b += g(
      ell(0, -150, 52, 120, rg(shade(c, i % 2 ? -0.08 : 0.05))) +
        line('M0 -260 V-30', shade(c, 0.4), 5),
      `rotate(${i * 13})`,
    );
  b +=
    line('M-24 -20 L-10 120 M0 -20 V125 M24 -20 L10 120', '#7cb35a', 9) +
    rect(-34, 20, 68, 26, 8, '#c9a46a');
  return g(b, `translate(${x} ${y}) scale(${s})`);
};
const cucumber = (x, y, s, rot) => {
  const r = rnd(Math.round(x * 7 + y));
  let b = rect(-170, -42, 340, 84, 42, lg('#5c9e3c', '#24561d')) + shine(-40, -22, 110, 8, 0, 0.35);
  for (let i = 0; i < 26; i++)
    b += circle(-150 + r() * 300, -30 + r() * 60, 3, '#b9dd8f', 'opacity=".8"');
  return g(b, `translate(${x} ${y}) rotate(${rot}) scale(${s})`);
};
const carrot = (x, y, s, rot) =>
  g(
    path(
      'M-36 -120 C-30 -40 -14 80 0 160 C14 80 30 -40 36 -120 Z',
      lg('#ffa23a', '#e0630f', 1, 0),
    ) +
      line('M-26 -60 h18 M10 -20 h16 M-18 30 h14 M6 80 h10', '#c4520d', 4) +
      path(
        'M-8 -120 C-60 -200 -40 -230 -20 -240 C-10 -200 0 -170 0 -120 Z M8 -120 C30 -210 60 -220 70 -210 C50 -180 30 -150 12 -118Z M0 -120 C0 -200 10 -240 20 -250 C24 -200 14 -160 4 -118Z',
        '#4c9b35',
      ),
    `translate(${x} ${y}) rotate(${rot}) scale(${s})`,
  );
const cabbage = (x, y, s) =>
  g(
    circle(0, 0, 200, rg('#9fd17a')) +
      path('M-190 -10 C-160 -160 160 -160 190 -10 C120 -90 -120 -90 -190 -10Z', '#86c062') +
      path('M-150 60 C-140 -60 140 -60 150 60 C80 0 -80 0 -150 60Z', '#b8e199', 'opacity=".9"') +
      line(
        'M0 -150 V140 M0 20 C-60 40 -110 80 -140 120 M0 20 C60 40 110 80 140 120 M0 -60 C-50 -40 -110 -20 -160 20 M0 -60 C50 -40 110 -20 160 20',
        '#e8f6d8',
        6,
        'opacity=".8"',
      ),
    `translate(${x} ${y}) scale(${s})`,
  );
const pineapple = (x, y, s) => {
  let b = ell(0, 60, 130, 190, rg('#e8a630'));
  for (let i = -6; i <= 6; i++)
    b +=
      line(`M${i * 40 - 140} -120 L${i * 40 + 140} 240`, '#b5741a', 5, 'opacity=".7"') +
      line(`M${i * 40 + 140} -120 L${i * 40 - 140} 240`, '#b5741a', 5, 'opacity=".7"');
  const clip = `pc${gid++}`;
  defs.push(`<clipPath id="${clip}"><ellipse cx="0" cy="60" rx="130" ry="190"/></clipPath>`);
  b = `<g clip-path="url(#${clip})">${b}</g>`;
  let crown = '';
  for (let i = -3; i <= 3; i++)
    crown += g(
      path(
        'M-18 -110 C-30 -200 -10 -300 0 -330 C10 -300 30 -200 18 -110Z',
        lg('#5db04a', '#2e7a2c'),
      ),
      `rotate(${i * 16} 0 -110)`,
    );
  return g(crown + b + shine(-60, 0, 22, 70, 10, 0.3), `translate(${x} ${y + 40}) scale(${s})`);
};
const watermelon = (x, y, s) =>
  g(
    ell(70, -30, 230, 170, lg('#3e8f3a', '#1d5a22')) +
      line(
        'M-120 -120 C-60 -60 -40 40 -60 120 M-20 -190 C20 -100 30 40 10 140 M80 -200 C120 -100 130 20 110 130 M180 -150 C220 -80 230 20 210 100',
        '#1a4a1d',
        14,
        'opacity=".55"',
      ) +
      path('M-260 40 A240 240 0 0 0 220 40 Z', '#2f7d33') +
      path('M-240 40 A220 220 0 0 0 200 40 Z', '#f2f6d6') +
      path('M-224 40 A204 204 0 0 0 184 40 Z', rg('#ec3b4a', 0.5, 0.1)) +
      [
        [-150, 90],
        [-90, 140],
        [-20, 170],
        [60, 150],
        [120, 100],
        [-60, 80],
        [30, 95],
      ]
        .map(([a, b]) => ell(a, b, 9, 15, '#2a1b16'))
        .join(''),
    `translate(${x} ${y}) scale(${s})`,
  );
const orange = (x, y, r, leaf = true) => {
  const rr = rnd(Math.round(x + y));
  let b = circle(x, y, r, rg('#f7931e'));
  for (let i = 0; i < 40; i++)
    b += circle(
      x - r * 0.7 + rr() * r * 1.4,
      y - r * 0.7 + rr() * r * 1.4,
      2.5,
      '#d9740c',
      'opacity=".45"',
    );
  b += shine(x - r * 0.35, y - r * 0.35, r * 0.2, r * 0.1);
  if (leaf)
    b +=
      path(`M${x} ${y - r} c20 -40 70 -40 90 -30 c-30 20 -60 40 -90 30z`, '#3f8f37') +
      circle(x, y - r + 4, 7, '#6b5a2a');
  return b;
};
const bananaBunch = (x, y, s, ripe = false) => {
  const c = ripe ? '#f2c230' : '#e8d33a';
  let b = '';
  for (let i = -2; i <= 2; i++) {
    b += g(
      path(
        'M0 0 C60 -40 200 -40 300 40 C280 60 260 66 240 60 C160 0 80 0 10 30 Z',
        lg(shade(c, 0.15), shade(c, -0.25)),
      ) +
        (ripe
          ? [60, 140, 210].map((p) => ell(p, 12, 10, 6, '#5b3a1a', 'opacity=".7"')).join('')
          : '') +
        ell(296, 46, 10, 8, '#4b3a1d'),
      `rotate(${i * 14 + 10}) translate(-40 ${i * 6})`,
    );
  }
  b += rect(-70, -20, 70, 50, 14, '#6d7b2c');
  return g(b, `translate(${x - 200} ${y + 20}) scale(${s})`);
};
const pawpaw = (x, y, s) => {
  let b =
    ell(70, -40, 120, 210, rg('#7fae3a'), 'transform="rotate(25 70 -40)"') +
    ell(-70, 30, 130, 200, '#7aa83a', 'transform="rotate(-20 -70 30)"') +
    ell(-70, 30, 112, 182, rg('#ff8a2b', 0.5, 0.5), 'transform="rotate(-20 -70 30)"');
  const r = rnd(7);
  for (let i = 0; i < 40; i++)
    b += circle(-70 + (r() - 0.5) * 70, 30 + (r() - 0.5) * 160, 9, '#231a14');
  return g(b, `translate(${x} ${y}) scale(${s})`);
};
const mango = (x, y, s, rot = 0) =>
  g(
    path(
      'M-120 20 C-130 -110 40 -150 110 -60 C160 10 120 130 10 130 C-70 130 -115 90 -120 20Z',
      lg('#7fbf3f', '#f15a24', 1, 1),
    ) +
      shine(-50, -40, 40, 18, -25) +
      line('M-80 -70 q-10 -30 6 -50', '#5d4a26', 8),
    `translate(${x} ${y}) rotate(${rot}) scale(${s})`,
  );
const avocado = (x, y, s) =>
  g(
    path(
      'M120 -170 C170 -170 200 -60 190 20 C180 140 110 180 60 180 C10 180 -50 140 -50 30 C-50 -60 60 -170 120 -170Z',
      rg('#3a5f22'),
    ) +
      path(
        'M-120 -150 C-70 -150 -40 -50 -40 30 C-40 150 -100 190 -150 190 C-200 190 -260 150 -260 40 C-260 -50 -170 -150 -120 -150Z',
        '#3d6a24',
      ) +
      path(
        'M-120 -132 C-80 -132 -56 -50 -56 30 C-56 138 -104 172 -150 172 C-196 172 -244 138 -244 40 C-244 -40 -165 -132 -120 -132Z',
        rg('#d9e88a', 0.5, 0.5),
      ) +
      circle(-148, 60, 62, rg('#8a4b23')),
    `translate(${x + 40} ${y}) scale(${s})`,
  );

// ---------- groceries ----------
const sack = (x, y, s, c, label, sub = '', band = '#c0392b') =>
  g(
    path(
      'M-200 -170 C-230 -40 -240 120 -210 230 C-100 260 100 260 210 230 C240 120 230 -40 200 -170 C120 -200 -120 -200 -200 -170Z',
      hg(c),
    ) +
      path(
        'M-170 -175 C-120 -260 120 -260 170 -175 C100 -200 -100 -200 -170 -175Z',
        shade(c, -0.12),
      ) +
      line('M-60 -230 C-20 -250 20 -250 60 -230', shade(c, -0.35), 10) +
      rect(-170, -40, 340, 170, 18, band) +
      text(0, 45, label, label.length > 5 ? 64 : 80, '#fff', 900) +
      (sub ? text(0, 105, sub, sub.length > 12 ? 28 : 40, '#fff', 700) : '') +
      line('M-210 -100 C-180 -60 -190 140 -200 200', shade(c, -0.15), 6, 'opacity=".5"'),
    `translate(${x} ${y}) scale(${s})`,
  );
const bowlPile = (x, y, s, pile, bowl = '#d6dbe4') => {
  const r = rnd(11);
  let grains = '';
  if (pile.kind === 'beans')
    for (let i = 0; i < 140; i++) {
      const a = r() * Math.PI,
        d = r();
      const bx = Math.cos(a) * 230 * d * (r() > 0.5 ? 1 : -1),
        by = -20 - Math.sin(a) * 120 * d;
      grains += ell(
        bx,
        by,
        20,
        12,
        rg(pile.c),
        `transform="rotate(${Math.round(r() * 180)} ${bx} ${by})"`,
      );
    }
  else
    for (let i = 0; i < 420; i++)
      grains += circle(
        (r() - 0.5) * 440 * (1 - r() * 0.2),
        -10 - r() * 130 * (1 - Math.abs(r() - 0.5)),
        4 + r() * 3,
        r() > 0.5 ? pile.c : shade(pile.c, -0.15),
      );
  return g(
    ell(0, -20, 240, 150, rg(pile.c, 0.5, 0.2)) +
      grains +
      path('M-260 0 C-250 160 250 160 260 0 Z', hg(bowl)) +
      ell(0, 0, 262, 34, shade(bowl, -0.15), 'opacity=".55"'),
    `translate(${x} ${y + 40}) scale(${s})`,
  );
};
const bottle = (x, y, s, o) =>
  g(
    rect(-o.w / 2, -o.h / 2, o.w, o.h, o.r ?? 40, vg(o.c)) +
      (o.liquid
        ? rect(
            -o.w / 2 + 10,
            -o.h / 2 + o.h * 0.25,
            o.w - 20,
            o.h * 0.72,
            30,
            o.liquid,
            'opacity=".9"',
          )
        : '') +
      rect(-o.nw / 2, -o.h / 2 - o.nh, o.nw, o.nh + 10, 10, vg(o.c)) +
      rect(-o.nw / 2 - 8, -o.h / 2 - o.nh - 40, o.nw + 16, 50, 12, vg(o.cap)) +
      (o.label
        ? rect(-o.w / 2 + 20, -o.h * 0.05, o.w - 40, o.h * 0.36, 14, o.labelBg || '#fff') +
          text(0, o.h * 0.13, o.label, o.ls || 46, o.labelInk || '#26408f', 900)
        : '') +
      shine(-o.w / 2 + 34, -o.h * 0.1, 10, o.h * 0.3, 0, 0.35),
    `translate(${x} ${y}) scale(${s})`,
  );
const jerrycan = (x, y, s, c, label) =>
  g(
    path('M-170 -150 H120 L170 -100 V230 H-170 Z', hg(c)) +
      rect(-140, -230, 140, 70, 30, 'none', `stroke="${shade(c, -0.1)}" stroke-width="36"`) +
      rect(80, -200, 60, 60, 10, '#333') +
      rect(-130, 0, 260, 140, 16, '#fff') +
      text(0, 85, label, 56, '#b23a12', 900) +
      shine(-130, -60, 10, 120, 0),
    `translate(${x} ${y}) scale(${s})`,
  );
const corn = (x, y, s, rot = 0) => {
  let k = '';
  for (let r = 0; r < 14; r++)
    for (let c = -2; c <= 2; c++) k += ell(c * 24, -170 + r * 26, 11, 12, rg('#f6c431'));
  return g(
    ell(0, 0, 70, 200, '#e2a91c') +
      k +
      path(
        'M-10 200 C-120 120 -140 -40 -90 -200 C-60 -60 -40 80 10 200Z',
        lg('#8cc456', '#3f8a2c'),
      ) +
      path('M10 200 C120 120 140 -40 90 -200 C60 -60 40 80 -10 200Z', lg('#9fd06a', '#4a9632')),
    `translate(${x} ${y}) rotate(${rot}) scale(${s})`,
  );
};
const carton = (x, y, s, label, c = '#c8935a', band = '#f2c230') =>
  g(
    path('M-220 -120 L0 -200 L220 -120 L0 -40 Z', shade(c, 0.2)) +
      path('M-220 -120 L0 -40 V200 L-220 120 Z', c) +
      path('M220 -120 L0 -40 V200 L220 120 Z', shade(c, -0.18)) +
      path('M-200 -20 L-20 46 V120 L-200 54 Z', band) +
      text(-110, 60, label, 34, '#3b2a07', 900, 'transform="skewY(20)" transform-origin="-110 60"'),
    `translate(${x} ${y}) scale(${s})`,
  );

// ---------- tubers & livestock ----------
const yam = (x, y, s, rot) => {
  const r = rnd(Math.round(x + y * 3));
  let b = path(
    'M-260 -20 C-200 -90 120 -110 250 -40 C290 -10 280 50 230 70 C100 110 -180 110 -250 50 C-290 20 -280 0 -260 -20Z',
    lg('#a77a4f', '#6b4a2c'),
  );
  for (let i = 0; i < 50; i++)
    b += circle(-240 + r() * 480, -60 + r() * 120, 3 + r() * 3, '#4e3420', 'opacity=".55"');
  return g(b + ell(-262, 14, 26, 40, '#f4ead7'), `translate(${x} ${y}) rotate(${rot}) scale(${s})`);
};
const cassava = (x, y, s, rot) =>
  g(
    path(
      'M-280 0 C-200 -50 150 -40 280 -6 C290 0 290 12 280 16 C150 40 -200 50 -280 20Z',
      lg('#9b6b44', '#5e3f25'),
    ) +
      line('M-200 -10 l10 20 M-60 -20 l8 24 M90 -16 l8 20', '#4a311c', 4) +
      ell(-282, 10, 14, 26, '#f7f0e2'),
    `translate(${x} ${y}) rotate(${rot}) scale(${s})`,
  );
const potato = (x, y, s, rot, c = '#b5543a') =>
  g(
    path(
      'M-200 0 C-180 -100 140 -110 210 -20 C240 30 160 100 40 100 C-100 100 -210 70 -200 0Z',
      rg(c),
    ) + shine(-60, -50, 50, 12, -5, 0.3),
    `translate(${x} ${y}) rotate(${rot}) scale(${s})`,
  );
const cocoyam = (x, y, s) =>
  g(
    ell(0, 0, 110, 130, rg('#7a5a3c')) +
      [-80, -40, 0, 40, 80]
        .map((d) =>
          line(`M-100 ${d} C-40 ${d + 16} 40 ${d + 16} 100 ${d}`, '#4b3423', 5, 'opacity=".6"'),
        )
        .join('') +
      line('M0 -130 v-30', '#6d8a3a', 12),
    `translate(${x} ${y}) scale(${s})`,
  );
const eggCrate = (x, y, s) => {
  let b = path('M-330 -40 L330 -40 L290 220 L-290 220 Z', hg('#c9b08a'));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 5; c++) {
      const ex = -240 + c * 120,
        ey = -60 + r * 100;
      b +=
        ell(ex, ey + 40, 52, 26, '#a68a63') +
        ell(ex, ey, 44, 58, rg(r === 1 && c === 2 ? '#f6efe2' : '#e9c69b'));
    }
  return g(b, `translate(${x} ${y - 40}) scale(${s})`);
};
const chicken = (x, y, s, c = '#ffffff') =>
  g(
    ell(0, 40, 200, 150, rg(c === '#ffffff' ? '#f4f1ea' : c)) +
      path(
        'M140 -20 C160 -140 260 -150 270 -60 C275 -10 220 20 170 20Z',
        rg(c === '#ffffff' ? '#f7f4ee' : c),
      ) +
      path('M215 -150 q15 -30 30 -10 q15 -30 30 -5 q10 30 -20 40 z', '#e0312c') +
      path('M265 -70 l45 14 l-45 12z', '#f2a516') +
      circle(240, -80, 9, '#222') +
      path('M260 -40 q10 30 -6 44 q-14 -20 6 -44z', '#e0312c') +
      path(
        'M-200 0 C-300 -120 -260 -170 -190 -100Z',
        rg(shade(c === '#ffffff' ? '#e8e2d6' : c, -0.1)),
      ) +
      path(
        'M-80 20 C-20 -40 100 -20 110 60 C40 110 -60 100 -80 20Z',
        shade(c === '#ffffff' ? '#e6e0d3' : c, -0.12),
      ) +
      line(
        'M-30 180 v70 l-30 20 M-30 250 l20 22 M50 180 v70 l-30 20 M50 250 l20 22',
        '#e9a520',
        12,
      ),
    `translate(${x} ${y - 30}) scale(${s})`,
  );
const turkey = (x, y, s) => {
  let tail = '';
  for (let i = -5; i <= 5; i++)
    tail += g(
      path('M0 0 C-40 -120 -30 -260 0 -300 C30 -260 40 -120 0 0Z', lg('#8a5a2b', '#3d2814')) +
        ell(0, -270, 16, 22, '#e6d2a2', 'opacity=".7"'),
      `rotate(${i * 15} 0 0)`,
    );
  return g(
    g(tail, 'translate(-40 40)') +
      ell(0, 60, 170, 150, rg('#4a3424')) +
      path('M90 0 C100 -120 180 -150 200 -80 C210 -40 170 -10 140 20Z', rg('#c9b7a3')) +
      path('M200 -100 q30 30 0 90 q-20 -40 0 -90z', '#d63a2c') +
      path('M200 -110 l40 14 l-40 10z', '#e7a03a') +
      circle(175, -110, 8, '#111') +
      line('M-20 200 v70 l-30 20 M60 200 v70 l-30 20', '#c28b3a', 12),
    `translate(${x} ${y - 40}) scale(${s})`,
  );
};
const goat = (x, y, s) =>
  g(
    path(
      'M-220 -40 C-220 -110 120 -120 150 -50 C170 0 160 90 120 110 L-190 110 C-230 90 -230 20 -220 -40Z',
      rg('#efe7da'),
    ) +
      line('M-170 100 v150 M-110 100 v150 M60 100 v150 M110 100 v150', '#d8cdbb', 30) +
      line('M-170 250 v10 M-110 250 v10 M60 250 v10 M110 250 v10', '#3a2c20', 30) +
      path(
        'M120 -60 C140 -150 220 -190 270 -150 C300 -120 290 -60 250 -40 C210 -20 170 -20 140 -20Z',
        rg('#f0e9dd'),
      ) +
      path('M200 -170 C200 -260 280 -280 300 -250 C260 -250 240 -220 230 -170Z', '#8b7458') +
      path('M250 -30 q-10 60 -30 70 q0 -40 10 -70z', '#cbbfa9') +
      circle(250, -120, 9, '#2a2018') +
      path('M150 -150 q-50 -30 -60 10 q30 0 60 -10z', '#e2d7c4') +
      path(
        'M-215 -40 q-50 10 -40 70',
        'none',
        'stroke="#e2d7c4" stroke-width="18" stroke-linecap="round"',
      ),
    `translate(${x - 20} ${y - 30}) scale(${s})`,
  );

// ---------- electronics ----------
const phone = (x, y, s, o = {}) =>
  g(
    rect(-150, -300, 300, 600, 48, vg(o.body || '#2b2f3a')) +
      rect(-134, -284, 268, 568, 36, lg(o.s1 || '#5b7cfa', o.s2 || '#b44cf0', 1, 1)) +
      rect(-40, -276, 80, 18, 9, '#111') +
      (o.apps
        ? [0, 1, 2, 3]
            .flatMap((r) =>
              [0, 1, 2, 3].map((c) =>
                rect(-110 + c * 58, -200 + r * 70, 42, 42, 12, '#fff', 'opacity=".75"'),
              ),
            )
            .join('')
        : '') +
      shine(-100, -150, 12, 120, 0, 0.25),
    `translate(${x} ${y}) rotate(${o.rot || 0}) scale(${s})`,
  );
const phoneBack = (x, y, s, c) =>
  g(
    rect(-150, -300, 300, 600, 48, vg(c)) +
      rect(-130, -280, 150, 150, 36, shade(c, -0.15)) +
      [
        [-90, -240],
        [-30, -190],
        [-90, -170],
      ]
        .map(([a, b]) => circle(a, b, 26, '#1d1f26') + circle(a, b, 14, '#3a4a6a'))
        .join('') +
      circle(-30, -250, 9, '#f6efe0') +
      shine(80, 50, 10, 160, 0, 0.3),
    `translate(${x} ${y}) rotate(-8) scale(${s})`,
  );
const laptop = (x, y, s) =>
  g(
    rect(-260, -230, 520, 330, 20, '#2d3240') +
      rect(-240, -212, 480, 290, 8, lg('#2a6bd8', '#59c2f2', 1, 1)) +
      path('M-320 100 H320 L290 150 H-290 Z', hg('#c7ccd6')) +
      rect(-60, 104, 120, 12, 6, '#9aa1ae'),
    `translate(${x} ${y + 40}) scale(${s})`,
  );
const earbuds = (x, y, s) =>
  g(
    rect(-160, -60, 320, 220, 100, vg('#f4f5f8')) +
      line('M-160 30 H160', '#d5d8df', 4) +
      circle(0, 70, 8, '#3ad15d') +
      g(
        ell(0, 0, 50, 56, rg('#fbfbfd')) +
          rect(-18, 30, 36, 130, 18, vg('#f3f4f7')) +
          circle(0, -6, 18, '#3c3f48'),
        'translate(-190 -190) rotate(-20)',
      ) +
      g(
        ell(0, 0, 50, 56, rg('#fbfbfd')) +
          rect(-18, 30, 36, 130, 18, vg('#f3f4f7')) +
          circle(0, -6, 18, '#3c3f48'),
        'translate(190 -200) rotate(25)',
      ),
    `translate(${x} ${y + 40}) scale(${s})`,
  );
const powerBank = (x, y, s) =>
  g(
    rect(-150, -240, 300, 480, 40, vg('#3a3f4c')) +
      [0, 1, 2, 3]
        .map((i) => circle(-60 + i * 40, 160, 10, i < 3 ? '#4cd964' : '#5a606e'))
        .join('') +
      text(0, -80, '20000', 54, '#fff', 800) +
      text(0, -24, 'mAh', 36, '#b9c0d0', 600) +
      line('M150 -180 C260 -180 260 0 200 120 C160 200 220 260 300 250', '#e9ecf2', 20) +
      rect(280, 230, 50, 36, 8, '#cfd4de'),
    `translate(${x - 30} ${y}) scale(${s})`,
  );
const speaker = (x, y, s, c = '#1f5fbf') => {
  let dots = '';
  for (let r = 0; r < 7; r++)
    for (let k = 0; k < 14; k++)
      dots += circle(-180 + k * 28, -110 + r * 34, 6, shade(c, -0.4), 'opacity=".7"');
  return g(
    rect(-220, -170, 440, 340, 170, vg(c)) +
      dots +
      ell(-220, 0, 40, 170, shade(c, -0.25)) +
      ell(220, 0, 40, 170, shade(c, 0.1)) +
      rect(-60, -200, 120, 30, 15, '#20232b'),
    `translate(${x} ${y}) scale(${s})`,
  );
};
const smartwatch = (x, y, s) =>
  g(
    rect(-90, -320, 180, 640, 60, vg('#2a2d36')) +
      rect(-150, -170, 300, 340, 70, vg('#3c404c')) +
      rect(-128, -148, 256, 296, 52, lg('#111522', '#26314f')) +
      text(0, -10, '10:09', 84, '#fff', 300) +
      text(0, 60, '8,240 steps', 32, '#7fd6ff', 600) +
      rect(150, -50, 26, 70, 10, '#5a5f6c'),
    `translate(${x} ${y}) rotate(-10) scale(${s})`,
  );
const headphones = (x, y, s, c = '#25283a') =>
  g(
    path(
      'M-210 40 C-230 -260 230 -260 210 40',
      'none',
      `stroke="${c}" stroke-width="40" stroke-linecap="round"`,
    ) +
      rect(-280, -10, 130, 230, 60, vg(c)) +
      rect(150, -10, 130, 230, 60, vg(c)) +
      rect(-170, 20, 40, 170, 20, '#555a6e') +
      rect(130, 20, 40, 170, 20, '#555a6e'),
    `translate(${x} ${y}) scale(${s})`,
  );

// ---------- fashion ----------
const pattern = (id, a, b, kind) => {
  defs.push(
    `<pattern id="${id}" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="${a}"/>` +
      (kind === 'circles'
        ? `<circle cx="40" cy="40" r="22" fill="${b}"/><circle cx="40" cy="40" r="10" fill="#fff" opacity=".8"/><circle cx="0" cy="0" r="10" fill="#f2c230"/><circle cx="80" cy="80" r="10" fill="#f2c230"/>`
        : kind === 'stripes'
          ? `<rect width="80" height="22" fill="${b}"/><rect y="40" width="80" height="8" fill="#f2c230"/><rect y="56" width="80" height="6" fill="#fff" opacity=".7"/>`
          : `<path d="M0 60 L20 20 L40 60 L60 20 L80 60" stroke="${b}" stroke-width="10" fill="none"/><circle cx="40" cy="70" r="6" fill="#fff"/>`) +
      `</pattern>`,
  );
  return `url(#${id})`;
};
const fabricStack = (x, y, s) =>
  g(
    [
      ['#1d6fb8', '#f28c28', 'circles', 120],
      ['#c0392b', '#2d8a4e', 'zig', 30],
      ['#6a2c91', '#f2c230', 'circles', -60],
    ]
      .map(
        ([a, b, k, dy], i) =>
          rect(-260 + i * 10, dy - 40, 520, 110, 24, pattern(`p${gid++}`, a, b, k)) +
          rect(-260 + i * 10, dy + 50, 520, 20, 10, '#000', 'opacity=".12"'),
      )
      .join(''),
    `translate(${x} ${y}) scale(${s})`,
  );
const asoOke = (x, y, s) =>
  g(
    rect(-250, -40, 500, 150, 24, pattern(`p${gid++}`, '#7a1f3d', '#d4a237', 'stripes')) +
      rect(-230, -170, 460, 140, 24, pattern(`p${gid++}`, '#d4a237', '#7a1f3d', 'stripes')) +
      path(
        'M-120 -170 C-160 -300 160 -300 120 -170Z',
        pattern(`p${gid++}`, '#7a1f3d', '#d4a237', 'stripes'),
      ),
    `translate(${x} ${y + 40}) scale(${s})`,
  );
const shirt = (x, y, s, c, trim = '#f2c230', num = '') =>
  g(
    path(
      'M-120 -250 L-280 -170 L-220 -40 L-160 -70 L-160 260 L160 260 L160 -70 L220 -40 L280 -170 L120 -250 C80 -200 -80 -200 -120 -250Z',
      hg(c),
    ) +
      path('M-120 -250 C-80 -200 80 -200 120 -250 L100 -260 C60 -220 -60 -220 -100 -260Z', trim) +
      (num
        ? text(0, 120, num, 200, '#fff', 900) + line('M-160 -70 V260 M160 -70 V260', trim, 14)
        : line('M0 -205 V260', shade(c, -0.25), 5) +
          [-140, -60, 20, 100, 180].map((yy) => circle(0, yy, 9, trim)).join('') +
          path('M-160 120 H160 V160 H-160Z', trim, 'opacity=".9"')),
    `translate(${x} ${y}) scale(${s})`,
  );
const sneaker = (x, y, s, c = '#ffffff', accent = '#26408f', studs = false) =>
  g(
    path(
      'M-300 40 C-300 -40 -260 -90 -200 -100 L-60 -120 C-20 -180 60 -200 120 -170 C180 -130 260 -60 300 0 C320 40 310 80 280 90 L-280 90 C-300 80 -300 60 -300 40Z',
      hg(c),
    ) +
      path(
        'M-310 60 H310 C312 100 300 120 270 120 H-280 C-305 120 -312 100 -310 60Z',
        studs ? '#222' : '#e9e3d6',
      ) +
      path(
        'M-150 -40 C-60 -20 60 -40 160 -110',
        'none',
        `stroke="${accent}" stroke-width="30" stroke-linecap="round"`,
      ) +
      line('M-40 -120 L20 -60 M0 -140 L60 -80 M40 -160 L100 -100', '#cfd4de', 8) +
      (studs
        ? [-230, -150, 140, 230].map((sx) => rect(sx - 14, 118, 28, 34, 6, '#555')).join('')
        : ''),
    `translate(${x} ${y + 30}) scale(${s})`,
  );
const handbag = (x, y, s, c = '#8a4b2a') =>
  g(
    path(
      'M-140 -120 C-140 -300 140 -300 140 -120',
      'none',
      `stroke="${shade(c, -0.2)}" stroke-width="30"`,
    ) +
      path('M-250 -120 H250 L220 220 H-220 Z', hg(c)) +
      path('M-250 -120 H250 L230 -20 H-230 Z', shade(c, -0.12)) +
      rect(-40, -40, 80, 50, 10, '#e2b24a'),
    `translate(${x} ${y + 40}) scale(${s})`,
  );
const beads = (x, y, s) => {
  let b = '';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40,
      a = Math.PI * (0.05 + 0.9 * t);
    b += circle(
      Math.cos(a) * 260,
      Math.sin(a) * 300 - 120,
      26,
      rg(i % 5 === 0 ? '#e2b24a' : '#d1452f'),
    );
  }
  for (let i = 0; i <= 22; i++) {
    const a = Math.PI * 2 * (i / 22);
    b += circle(
      Math.cos(a) * 110,
      Math.sin(a) * 60 + 240,
      18,
      rg(i % 4 === 0 ? '#e2b24a' : '#d1452f'),
    );
  }
  return g(b, `translate(${x} ${y - 40}) scale(${s})`);
};
const sandal = (x, y, s, c = '#7a4a26') =>
  g(
    path(
      'M-120 -260 C-60 -300 60 -300 120 -260 C150 -100 150 140 110 250 C60 290 -60 290 -110 250 C-150 140 -150 -100 -120 -260Z',
      hg('#c08a55'),
    ) +
      rect(-150, -140, 300, 80, 30, c) +
      rect(-150, 40, 300, 80, 30, c) +
      circle(0, -100, 14, '#e2b24a'),
    `translate(${x} ${y}) rotate(-15) scale(${s * 0.8} ${s})`,
  );
const sunglasses = (x, y, s) =>
  g(
    path(
      'M-300 -40 C-300 -80 -60 -80 -50 -40 C-40 60 -110 110 -190 100 C-280 90 -300 40 -300 -40Z',
      lg('#2c2f3a', '#6b4b8a', 1, 1),
    ) +
      path(
        'M300 -40 C300 -80 60 -80 50 -40 C40 60 110 110 190 100 C280 90 300 40 300 -40Z',
        lg('#2c2f3a', '#6b4b8a', 1, 1),
      ) +
      line('M-50 -40 C-20 -70 20 -70 50 -40 M-300 -50 L-360 -70 M300 -50 L360 -70', '#1d1f26', 18) +
      shine(-230, -20, 30, 12, -10, 0.4) +
      shine(130, -20, 30, 12, -10, 0.4),
    `translate(${x} ${y}) scale(${s})`,
  );

// ---------- home & kitchen ----------
const pot = (x, y, s, c, w) =>
  g(
    rect(-w / 2, -w * 0.35, w, w * 0.55, 30, vg(c)) +
      ell(0, -w * 0.35, w / 2, w * 0.1, shade(c, -0.35)) +
      ell(0, -w * 0.4, w / 2 + 6, w * 0.1, lg('#dfe5ee', '#9aa5b5', 1, 0), 'opacity=".9"') +
      circle(0, -w * 0.5, 16, '#222') +
      rect(-w / 2 - 50, -w * 0.25, 54, 26, 13, '#222') +
      rect(w / 2 - 4, -w * 0.25, 54, 26, 13, '#222'),
    `translate(${x} ${y}) scale(${s})`,
  );
const blender = (x, y, s) =>
  g(
    path(
      'M-130 -320 H130 L100 60 H-100 Z',
      'rgba(220,235,250,.75)',
      'stroke="#9fb3cc" stroke-width="8"',
    ) +
      path('M-110 -120 H110 L100 60 H-100 Z', '#e7553a', 'opacity=".85"') +
      rect(-150, -350, 300, 50, 16, '#2b2f3a') +
      path('M130 -260 C220 -260 220 -40 110 -40', 'none', 'stroke="#9fb3cc" stroke-width="24"') +
      rect(-160, 60, 320, 200, 30, vg('#2b2f3a')) +
      circle(0, 160, 34, '#cfd4de'),
    `translate(${x} ${y + 20}) scale(${s})`,
  );
const kettle = (x, y, s) =>
  g(
    path('M-180 220 L-150 -150 C-140 -210 140 -210 150 -150 L180 220 Z', vg('#c9ced8')) +
      path('M150 -150 C280 -150 280 140 170 140', 'none', 'stroke="#2b2f3a" stroke-width="40"') +
      path('M-160 -60 L-300 -170 L-280 -120 L-170 0Z', '#b4bac6') +
      rect(-200, 200, 400, 60, 20, '#2b2f3a') +
      rect(-90, -240, 180, 50, 25, '#2b2f3a') +
      rect(-20, -60, 40, 160, 20, '#8fd3ff', 'opacity=".7"'),
    `translate(${x} ${y}) scale(${s})`,
  );
const gasCooker = (x, y, s) =>
  g(
    path('M-320 -60 H320 L300 140 H-300 Z', hg('#2f333d')) +
      path('M-340 -100 H340 L320 -60 H-320Z', '#4a4f5c') +
      [-160, 160]
        .map(
          (bx) =>
            ell(bx, -80, 110, 30, '#1b1d22') +
            ell(bx, -86, 70, 18, '#666') +
            [0, 1, 2, 3, 4, 5]
              .map((k) =>
                ell(
                  bx + Math.cos(k) * 50,
                  -86 + Math.sin(k) * 12,
                  10,
                  14,
                  '#3a7bff',
                  'opacity=".85"',
                ),
              )
              .join(''),
        )
        .join('') +
      [-160, 160].map((bx) => circle(bx, 60, 30, '#c9ced8')).join(''),
    `translate(${x} ${y + 30}) scale(${s})`,
  );
const flask = (x, y, s, c = '#d63a5a') =>
  g(
    rect(-220, -160, 440, 360, 60, vg(c)) +
      rect(-240, -220, 480, 90, 40, shade(c, -0.15)) +
      rect(-280, -120, 60, 120, 20, '#2b2f3a') +
      rect(220, -120, 60, 120, 20, '#2b2f3a') +
      rect(-180, 20, 360, 40, 20, '#fff', 'opacity=".55"'),
    `translate(${x} ${y + 30}) scale(${s})`,
  );
const plates = (x, y, s) =>
  g(
    [0, 1, 2, 3, 4]
      .map(
        (i) =>
          ell(0, 160 - i * 34, 300, 70, lg('#ffffff', '#d9dee8')) +
          ell(0, 150 - i * 34, 190, 40, '#eef1f6'),
      )
      .join('') +
      ell(0, 14, 190, 40, '#f8f9fb') +
      line('M-150 14 A190 40 0 0 0 150 14', '#26408f', 6, 'opacity=".5"'),
    `translate(${x} ${y}) scale(${s})`,
  );
const mortar = (x, y, s) =>
  g(
    line('M80 -300 L-20 40', '#a2703e', 50) +
      ell(0, -30, 230, 50, '#5b3a1f') +
      path(
        'M-230 -30 C-230 160 -120 220 -90 230 L-120 300 H120 L90 230 C120 220 230 160 230 -30 Z',
        lg('#b07a44', '#6d4523', 1, 0),
      ) +
      ell(0, -30, 200, 38, '#3a2412'),
    `translate(${x} ${y}) scale(${s})`,
  );
const fan = (x, y, s) => {
  let blades = '';
  for (let i = 0; i < 3; i++)
    blades += g(ell(0, -90, 50, 90, '#7cc4f5', 'opacity=".9"'), `rotate(${i * 120})`);
  return g(
    circle(0, -150, 200, 'none', 'stroke="#c9ced8" stroke-width="14"') +
      g(blades + circle(0, 0, 34, '#26408f'), 'translate(0 -150)') +
      [0, 30, 60, 90, 120, 150]
        .map((a) =>
          line(
            `M${Math.cos((a * Math.PI) / 180) * 200} ${-150 + Math.sin((a * Math.PI) / 180) * 200} L${-Math.cos((a * Math.PI) / 180) * 200} ${-150 - Math.sin((a * Math.PI) / 180) * 200}`,
            '#d9dde5',
            4,
          ),
        )
        .join('') +
      rect(-16, 50, 32, 220, 16, '#c9ced8') +
      ell(0, 280, 150, 30, '#9aa1ae'),
    `translate(${x} ${y}) scale(${s})`,
  );
};

// ---------- beauty ----------
const jar = (x, y, s, c, lid, label, ink = '#26408f') =>
  g(
    rect(-170, -100, 340, 260, 40, vg(c)) +
      rect(-185, -170, 370, 90, 26, vg(lid)) +
      rect(-130, -20, 260, 110, 16, '#fff', 'opacity=".9"') +
      text(0, 50, label, label.length > 6 ? 34 : 44, ink, 900) +
      shine(-130, 40, 10, 70, 0, 0.3),
    `translate(${x} ${y + 30}) scale(${s})`,
  );
const soapBars = (x, y, s) =>
  g(
    g(
      rect(-200, -90, 400, 180, 60, rg('#3b2a20')) + shine(-100, -40, 60, 14, -10, 0.15),
      'translate(-60 60) rotate(-8)',
    ) +
      g(
        rect(-200, -90, 400, 180, 60, rg('#4a3426')) +
          text(0, 20, 'BLACK SOAP', 40, '#d8c3a5', 800) +
          shine(-100, -40, 60, 14, -10, 0.15),
        'translate(60 -80) rotate(6)',
      ),
    `translate(${x} ${y}) scale(${s})`,
  );
const perfume = (x, y, s) =>
  g(
    path(
      'M-170 -120 H170 L200 220 H-200 Z',
      lg('rgba(255,214,140,.95)', 'rgba(214,138,60,.95)', 1, 1),
      'stroke="#c58a3e" stroke-width="6"',
    ) +
      rect(-50, -190, 100, 80, 10, '#e2b24a') +
      rect(-90, -300, 180, 120, 30, lg('#2b2f3a', '#545b6e', 1, 0)) +
      text(0, 70, 'EAU DE', 34, '#6b3d12', 700) +
      text(0, 120, 'PARFUM', 46, '#6b3d12', 900) +
      shine(-120, 0, 12, 140, 6, 0.5),
    `translate(${x} ${y + 30}) scale(${s})`,
  );
const braids = (x, y, s) => {
  let b = rect(-180, -300, 360, 60, 20, '#d4a237');
  for (let i = 0; i < 16; i++)
    b += path(
      `M${-160 + i * 21} -250 C${-170 + i * 21} -50 ${-140 + i * 21} 150 ${-150 + i * 22} 300`,
      'none',
      `stroke="${i % 2 ? '#2b1d14' : '#3c2a1e'}" stroke-width="16" stroke-linecap="round"`,
    );
  return g(
    b +
      rect(-190, -20, 380, 140, 20, '#fff', 'opacity=".92"') +
      text(0, 60, 'BRAIDS', 64, '#26408f', 900),
    `translate(${x} ${y}) scale(${s})`,
  );
};
const lipstick = (x, y, s) =>
  g(
    g(
      rect(-60, -40, 120, 300, 16, vg('#d4a237')) +
        rect(-50, -160, 100, 130, 10, vg('#c9a03a')) +
        path('M-44 -160 V-260 L44 -300 V-160 Z', vg('#c2185b')),
      'translate(-80 0) rotate(-6)',
    ) +
      g(
        rect(-60, -100, 120, 340, 16, vg('#2b2f3a')) + rect(-50, -100, 100, 30, 6, '#d4a237'),
        'translate(110 30) rotate(8)',
      ),
    `translate(${x} ${y}) scale(${s})`,
  );
const brushes = (x, y, s) => {
  let b = '';
  [
    [-90, -18, '#e2b24a'],
    [-30, -6, '#2b2f3a'],
    [30, 6, '#c2185b'],
    [90, 18, '#2b2f3a'],
  ].forEach(
    ([bx, r, c]) =>
      (b += g(
        rect(-14, -300, 28, 300, 12, c) +
          path('M-34 -300 C-40 -380 40 -380 34 -300 Z', '#3b2a20') +
          rect(-18, -310, 36, 40, 6, '#c9ced8'),
        `translate(${bx} 0) rotate(${r})`,
      )),
  );
  return g(b + rect(-180, -60, 360, 300, 40, vg('#f3d1c0')), `translate(${x} ${y}) scale(${s})`);
};

// ---------- baby ----------
const diaperPack = (x, y, s) =>
  g(
    rect(-230, -260, 460, 520, 60, hg('#6ec1ea')) +
      circle(0, -60, 120, '#fff') +
      text(0, -30, '👶', 120, '#000', 400).replace('👶', '◕‿◕') +
      text(0, 150, 'DIAPERS', 74, '#fff', 900) +
      text(0, 210, 'JUMBO · SIZE 3', 34, '#eaf7ff', 700),
    `translate(${x} ${y}) scale(${s})`,
  );
const onesie = (x, y, s) =>
  g(
    path(
      'M-110 -260 L-260 -160 L-200 -60 L-150 -90 L-150 140 C-150 220 -60 260 0 260 C60 260 150 220 150 140 L150 -90 L200 -60 L260 -160 L110 -260 C80 -200 -80 -200 -110 -260Z',
      hg('#ffd36e'),
    ) +
      circle(0, 20, 70, '#fff', 'opacity=".9"') +
      text(0, 44, '★', 80, '#f28c28', 900) +
      [-110, -40].map((yy) => circle(0, yy, 10, '#fff')).join(''),
    `translate(${x} ${y}) scale(${s})`,
  );
const blocks = (x, y, s) => {
  const cube = (cx, cy, c, l) =>
    path(
      `M${cx - 110} ${cy - 50} L${cx} ${cy - 100} L${cx + 110} ${cy - 50} L${cx} ${cy}Z`,
      shade(c, 0.25),
    ) +
    path(`M${cx - 110} ${cy - 50} L${cx} ${cy} V${cy + 130} L${cx - 110} ${cy + 80}Z`, c) +
    path(
      `M${cx + 110} ${cy - 50} L${cx} ${cy} V${cy + 130} L${cx + 110} ${cy + 80}Z`,
      shade(c, -0.2),
    ) +
    text(cx - 55, cy + 70, l, 80, '#fff', 900);
  return g(
    cube(-120, 120, '#e74c3c', 'A') + cube(120, 120, '#26408f', 'B') + cube(0, -60, '#f2c230', 'C'),
    `translate(${x} ${y}) scale(${s})`,
  );
};
const backpack = (x, y, s, c = '#e74c3c') =>
  g(
    path(
      'M-90 -230 C-90 -320 90 -320 90 -230',
      'none',
      `stroke="${shade(c, -0.25)}" stroke-width="28"`,
    ) +
      rect(-220, -240, 440, 500, 90, hg(c)) +
      rect(-160, 40, 320, 190, 40, shade(c, -0.12)) +
      line('M-120 70 H120', '#f2c230', 10) +
      rect(-30, 60, 60, 24, 8, '#f2c230') +
      line('M-220 -100 H220', shade(c, -0.2), 6, 'opacity=".5"'),
    `translate(${x} ${y}) scale(${s})`,
  );
const teddy = (x, y, s) =>
  g(
    circle(-140, -230, 70, rg('#b07a44')) +
      circle(140, -230, 70, rg('#b07a44')) +
      ell(0, 140, 210, 190, rg('#b07a44')) +
      circle(0, -130, 160, rg('#c08a55')) +
      ell(0, -80, 70, 54, '#ead1b0') +
      ell(0, -100, 22, 16, '#2a1b10') +
      circle(-55, -160, 14, '#2a1b10') +
      circle(55, -160, 14, '#2a1b10') +
      ell(-180, 110, 60, 90, rg('#b07a44')) +
      ell(180, 110, 60, 90, rg('#b07a44')) +
      ell(0, 170, 110, 120, '#ead1b0', 'opacity=".7"') +
      path('M-60 10 L0 40 L60 10 L60 60 L0 40 L-60 60Z', '#c2185b'),
    `translate(${x} ${y + 20}) scale(${s})`,
  );
const stroller = (x, y, s) =>
  g(
    path('M-220 -40 C-220 -260 60 -300 120 -60 Z', hg('#26408f')) +
      rect(-240, -60, 400, 150, 40, hg('#3d5bb5')) +
      line('M160 -40 L260 -260 L320 -260', '#2b2f3a', 18) +
      line('M-180 90 L-200 200 M100 90 L130 200', '#2b2f3a', 16) +
      [-200, 130]
        .map((wx) => circle(wx, 230, 62, '#2b2f3a') + circle(wx, 230, 26, '#c9ced8'))
        .join(''),
    `translate(${x} ${y}) scale(${s})`,
  );
const feedingBottles = (x, y, s) =>
  g(
    [-140, 0, 140]
      .map((bx, i) =>
        g(
          rect(
            -55,
            -120,
            110,
            280,
            30,
            'rgba(240,248,255,.95)',
            'stroke="#b9c9dc" stroke-width="6"',
          ) +
            rect(-48, 10, 96, 140, 24, '#fffbea') +
            rect(-62, -170, 124, 60, 14, ['#f48fb1', '#6ec1ea', '#ffd36e'][i]) +
            path('M-30 -170 C-30 -250 30 -250 30 -170Z', '#f2d7b3') +
            [40, 80, 120].map((yy) => line(`M-48 ${yy - 60} h24`, '#9fb3cc', 4)).join(''),
          `translate(${bx} ${i === 1 ? -20 : 30})`,
        ),
      )
      .join(''),
    `translate(${x} ${y}) scale(${s})`,
  );

// ---------- auto ----------
const carBattery = (x, y, s) =>
  g(
    path('M-280 -160 L-200 -220 H280 L200 -160 Z', '#4a4f5c') +
      rect(-280, -160, 480, 380, 16, hg('#2f333d')) +
      path('M200 -160 L280 -220 V160 L200 220Z', '#22252d') +
      rect(-200, -250, 60, 50, 8, '#c0392b') +
      rect(120, -250, 60, 50, 8, '#2b2f3a') +
      text(-170, -270, '+', 60, '#c0392b', 900) +
      text(150, -270, '−', 60, '#ccc', 900) +
      rect(-240, -60, 400, 120, 12, '#f2c230') +
      text(-40, 25, '75Ah 12V', 66, '#2b2f3a', 900),
    `translate(${x + 20} ${y + 30}) scale(${s})`,
  );
const tyre = (x, y, s) => {
  let tread = '';
  for (let i = 0; i < 36; i++)
    tread += g(rect(-12, -300, 24, 46, 6, '#3a3d45'), `rotate(${i * 10})`);
  return g(
    circle(0, 0, 300, '#1d1f24') +
      tread +
      circle(0, 0, 200, '#2a2d34') +
      circle(0, 0, 160, rg('#c9ced8', 0.4, 0.4)) +
      [0, 72, 144, 216, 288]
        .map((a) => g(path('M-26 -40 L-40 -150 H40 L26 -40Z', '#9aa1ae'), `rotate(${a})`))
        .join('') +
      circle(0, 0, 44, '#6b7280'),
    `translate(${x} ${y}) scale(${s})`,
  );
};
const brakeDisc = (x, y, s) =>
  g(
    circle(-40, 0, 260, rg('#b9bec8', 0.4, 0.4)) +
      circle(-40, 0, 110, '#7d838f') +
      [0, 72, 144, 216, 288]
        .map((a) =>
          circle(
            -40 + Math.cos((a * Math.PI) / 180) * 60,
            Math.sin((a * Math.PI) / 180) * 60,
            14,
            '#3a3d45',
          ),
        )
        .join('') +
      circle(-40, 0, 26, '#3a3d45') +
      path('M160 -200 C280 -120 280 120 160 200 L120 160 C210 100 210 -100 120 -160Z', '#c0392b') +
      rect(130, -60, 90, 120, 20, '#8f2a20'),
    `translate(${x} ${y}) scale(${s})`,
  );
const oilJug = (x, y, s) =>
  g(
    path('M-180 -160 H140 L190 -100 V240 H-180 Z', hg('#f2c230')) +
      rect(-150, -250, 120, 80, 30, 'none', 'stroke="#e0a91c" stroke-width="36"') +
      rect(90, -230, 70, 70, 12, '#2b2f3a') +
      rect(-150, -40, 310, 200, 16, '#1d3f8f') +
      text(5, 40, '5W-30', 70, '#fff', 900) +
      text(5, 110, 'SYNTHETIC', 40, '#f2c230', 800),
    `translate(${x} ${y}) scale(${s})`,
  );
const headlamp = (x, y, s) =>
  g(
    path(
      'M-300 -80 C-260 -170 200 -200 300 -110 C330 -20 280 120 160 150 L-260 140 C-320 100 -330 0 -300 -80Z',
      lg('#e9eef5', '#9aa6b8', 1, 1),
      'stroke="#59606e" stroke-width="10"',
    ) +
      circle(-130, -10, 90, rg('#ffffff', 0.4, 0.4)) +
      circle(-130, -10, 50, '#cfe6ff') +
      circle(100, 0, 70, rg('#ffffff', 0.4, 0.4)) +
      rect(-260, 80, 380, 24, 12, '#f2a516'),
    `translate(${x} ${y}) scale(${s})`,
  );
const sideMirror = (x, y, s) =>
  g(
    path(
      'M-260 -150 C-150 -230 230 -200 270 -60 C300 60 230 160 100 170 L-200 170 C-280 140 -310 -80 -260 -150Z',
      hg('#2b2f3a'),
    ) +
      path(
        'M-230 -120 C-140 -180 200 -160 240 -50 C260 40 200 130 100 140 L-180 140 C-250 110 -270 -60 -230 -120Z',
        lg('#bfe0ff', '#5d8fc9', 1, 1),
      ) +
      rect(-120, 170, 140, 110, 20, '#2b2f3a'),
    `translate(${x} ${y}) scale(${s})`,
  );
const airFilter = (x, y, s) => {
  let p = '';
  for (let i = 0; i < 22; i++)
    p += line(`M${-240 + i * 22} -160 L${-229 + i * 22} 160 L${-218 + i * 22} -160`, '#e9d9a6', 6);
  return g(
    rect(-280, -200, 560, 400, 30, '#3a3d45') + rect(-250, -170, 500, 340, 12, '#f3e6bc') + p,
    `translate(${x} ${y}) skewX(-8) scale(${s})`,
  );
};
const wipers = (x, y, s) =>
  g(
    [0, 1]
      .map((i) =>
        g(
          rect(-330, -16, 660, 32, 16, '#2b2f3a') +
            rect(-310, 12, 620, 16, 8, '#111') +
            rect(-40, -50, 80, 40, 10, '#4a4f5c'),
          `translate(0 ${i * 160 - 80}) rotate(${i ? 6 : -6})`,
        ),
      )
      .join(''),
    `translate(${x} ${y}) scale(${s})`,
  );

// ---------- tools & building ----------
const paintBucket = (x, y, s) =>
  g(
    path('M-200 -160 H200 L170 240 H-170 Z', vg('#eef1f6')) +
      ell(0, -160, 200, 46, '#2f9e6b') +
      path(
        'M-200 -160 C-200 -40 -160 -60 -150 -10 C-140 40 -110 -40 -100 -100 L-80 -150Z',
        '#2f9e6b',
      ) +
      path(
        'M-200 -170 C-200 -330 200 -330 200 -170',
        'none',
        'stroke="#9aa1ae" stroke-width="12"',
      ) +
      rect(-150, 20, 300, 150, 16, '#26408f') +
      text(0, 110, 'EMULSION', 50, '#fff', 900),
    `translate(${x} ${y + 30}) scale(${s})`,
  );
const drill = (x, y, s) =>
  g(
    path(
      'M-240 -170 H180 C230 -170 240 -60 180 -40 H-60 L-30 140 H-170 L-200 -40 C-260 -60 -270 -170 -240 -170Z',
      hg('#f28c28'),
    ) +
      rect(180, -140, 100, 70, 12, '#2b2f3a') +
      rect(280, -118, 120, 26, 6, '#c9ced8') +
      rect(-200, 140, 210, 110, 20, '#2b2f3a') +
      rect(-110, -30, 50, 40, 10, '#2b2f3a') +
      line('M-200 -120 H140', '#2b2f3a', 10, 'opacity=".25"'),
    `translate(${x - 40} ${y}) scale(${s})`,
  );
const hammer = (x, y, s) =>
  g(
    rect(-36, -150, 72, 460, 30, lg('#d39b5a', '#8a5a2b', 1, 0)) +
      path(
        'M-200 -260 H160 C220 -260 240 -230 240 -200 C200 -210 180 -190 170 -150 H-200 Z',
        hg('#7d838f'),
      ) +
      rect(-220, -270, 60, 130, 14, '#5f6570'),
    `translate(${x} ${y}) rotate(-30) scale(${s})`,
  );
const toolbox = (x, y, s) =>
  g(
    path('M-120 -180 V-240 H120 V-180', 'none', 'stroke="#2b2f3a" stroke-width="30"') +
      rect(-300, -180, 600, 360, 30, hg('#c0392b')) +
      rect(-300, -180, 600, 90, 30, shade('#c0392b', -0.15)) +
      rect(-40, -110, 80, 50, 10, '#c9ced8') +
      g(
        rect(-30, -200, 60, 160, 10, '#e2b24a') + rect(-14, -360, 28, 170, 8, '#c9ced8'),
        'translate(-180 -120) rotate(-20)',
      ) +
      g(
        rect(-30, -200, 60, 160, 10, '#26408f') + rect(-14, -330, 28, 140, 8, '#c9ced8'),
        'translate(180 -120) rotate(15)',
      ),
    `translate(${x} ${y + 60}) scale(${s * 0.92})`,
  );
const wheelbarrow = (x, y, s) =>
  g(
    path('M-300 -140 H200 L120 60 H-200 Z', hg('#2f7d4f')) +
      line('M120 40 L320 160 M-200 60 L-240 220 M-60 60 L-80 220', '#3a3d45', 18) +
      line('M-300 -120 L-420 -40', '#3a3d45', 20) +
      circle(330, 170, 80, '#2b2f3a') +
      circle(330, 170, 30, '#c9ced8'),
    `translate(${x} ${y}) scale(${s})`,
  );
const pipes = (x, y, s) => {
  let b = '';
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4 - (r % 2); c++) {
      const px = -240 + c * 150 + (r % 2) * 75,
        py = 120 - r * 120;
      b +=
        rect(px - 330, py - 60, 330, 120, 10, vg('#e9edf3')) +
        circle(px, py, 62, '#f7f9fc') +
        circle(px, py, 42, '#9aa6b8');
    }
  return g(b, `translate(${x + 120} ${y}) scale(${s})`);
};
const padlock = (x, y, s) =>
  g(
    path(
      'M-130 -40 V-170 C-130 -320 130 -320 130 -170 V-40',
      'none',
      'stroke="#c9ced8" stroke-width="54"',
    ) +
      rect(-220, -60, 440, 340, 40, hg('#e2b24a')) +
      circle(0, 70, 36, '#5b4512') +
      rect(-14, 80, 28, 90, 10, '#5b4512'),
    `translate(${x} ${y}) scale(${s})`,
  );

// ---------- books & sport ----------
const bookStack = (x, y, s, colours) =>
  g(
    colours
      .map(
        (c, i) =>
          rect(-280 + (i % 2) * 30, 150 - i * 90, 520, 80, 10, hg(c)) +
          rect(-250 + (i % 2) * 30, 162 - i * 90, 470, 18, 4, '#fff', 'opacity=".75"') +
          rect(200 + (i % 2) * 30, 150 - i * 90, 40, 80, 8, shade(c, -0.25)),
      )
      .join(''),
    `translate(${x} ${y}) scale(${s})`,
  );
const bookStanding = (x, y, s, c, title, sub = '') =>
  g(
    rect(-210, -290, 420, 580, 20, hg(c)) +
      rect(-210, -290, 40, 580, 10, shade(c, -0.25)) +
      rect(-140, -200, 300, 6, 3, '#e2b24a') +
      text(10, -80, title, title.length > 6 ? 64 : 86, '#fff', 900) +
      (sub ? text(10, 0, sub, 40, '#f6e7b4', 700) : '') +
      rect(-140, 200, 300, 6, 3, '#e2b24a'),
    `translate(${x} ${y}) rotate(-6) scale(${s})`,
  );
const pens = (x, y, s) =>
  g(
    [
      ['#26408f', -40],
      ['#c0392b', -20],
      ['#2b2f3a', 0],
      ['#26408f', 20],
      ['#2f9e6b', 40],
    ]
      .map(([c, r], i) =>
        g(
          rect(-18, -300, 36, 520, 18, vg('#eef1f6')) +
            rect(-18, -300, 36, 90, 16, c) +
            path('M-18 220 L0 290 L18 220Z', '#cfd4de') +
            rect(14, -280, 10, 160, 5, c),
          `translate(${-160 + i * 80} 0) rotate(${r / 3})`,
        ),
      )
      .join(''),
    `translate(${x} ${y}) scale(${s})`,
  );
const calculator = (x, y, s) => {
  let k = '';
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 4; c++)
      k += rect(
        -170 + c * 90,
        -60 + r * 70,
        70,
        50,
        12,
        r === 4 && c === 3 ? '#f28c28' : c === 3 ? '#4a4f5c' : '#e9ecf2',
      );
  return g(
    rect(-220, -300, 440, 640, 40, hg('#2b2f3a')) +
      rect(-180, -260, 360, 150, 16, '#b8cfa6') +
      text(140, -160, '3.14159', 70, '#1f2b17', 700, 'text-anchor="end"') +
      k,
    `translate(${x} ${y}) scale(${s})`,
  );
};
const pencils = (x, y, s) =>
  g(
    ['#e74c3c', '#f28c28', '#f2c230', '#2f9e6b', '#26408f', '#8e44ad', '#c2185b']
      .map((c, i) =>
        g(
          rect(-20, -260, 40, 440, 6, vg(c)) +
            path('M-20 180 L0 260 L20 180Z', '#f2d7b3') +
            path('M-7 232 L0 260 L7 232Z', c),
          `translate(${-180 + i * 60} ${i % 2 ? 20 : 0}) rotate(${(i - 3) * 4})`,
        ),
      )
      .join('') +
      rect(-260, 60, 520, 220, 30, hg('#ffffff'), 'opacity=".95"') +
      text(0, 190, 'COLOURS', 70, '#26408f', 900),
    `translate(${x} ${y}) scale(${s})`,
  );
const football = (x, y, s) => {
  const pent = (cx, cy, r) =>
    path(
      Array.from(
        { length: 5 },
        (_, i) =>
          `${i ? 'L' : 'M'}${cx + r * Math.cos(((i * 72 - 90) * Math.PI) / 180)} ${cy + r * Math.sin(((i * 72 - 90) * Math.PI) / 180)}`,
      ).join(' ') + 'Z',
      '#1d1f24',
    );
  return g(
    circle(0, 0, 260, rg('#ffffff', 0.4, 0.35)) +
      pent(0, 0, 70) +
      pent(-170, -140, 60) +
      pent(170, -140, 60) +
      pent(-200, 110, 60) +
      pent(200, 110, 60) +
      pent(0, 230, 50) +
      line(
        'M0 -70 L0 -200 M-66 -22 L-150 -90 M66 -22 L150 -90 M-40 56 L-150 90 M40 56 L150 90',
        '#9aa1ae',
        5,
      ),
    `translate(${x} ${y}) scale(${s})`,
  );
};
const dumbbells = (x, y, s) => {
  const db = (dx, dy, r) =>
    g(
      rect(-170, -24, 340, 48, 16, vg('#c9ced8')) +
        rect(-250, -90, 80, 180, 24, hg('#2b2f3a')) +
        rect(170, -90, 80, 180, 24, hg('#2b2f3a')) +
        rect(-290, -70, 50, 140, 20, '#3a3d45') +
        rect(240, -70, 50, 140, 20, '#3a3d45') +
        text(-210, 16, '10', 44, '#fff', 900),
      `translate(${dx} ${dy}) rotate(${r})`,
    );
  return g(db(0, -100, -8) + db(0, 120, 6), `translate(${x} ${y}) scale(${s})`);
};
const yogaMat = (x, y, s) =>
  g(
    rect(-300, -20, 600, 160, 12, hg('#7c5cd6')) +
      circle(300, -60, 120, rg('#8e6ee6')) +
      circle(300, -60, 70, '#6a4cc4') +
      path('M-300 -20 L180 -180 H300 L-180 -20Z', '#9a80ee', 'opacity=".7"'),
    `translate(${x - 40} ${y + 60}) scale(${s})`,
  );
const bicycle = (x, y, s) =>
  g(
    [-230, 230]
      .map(
        (wx) =>
          circle(wx, 120, 170, 'none', 'stroke="#2b2f3a" stroke-width="22"') +
          circle(wx, 120, 20, '#9aa1ae') +
          Array.from({ length: 12 }, (_, i) =>
            line(
              `M${wx} 120 L${wx + Math.cos(i * 0.52) * 160} ${120 + Math.sin(i * 0.52) * 160}`,
              '#9aa1ae',
              3,
            ),
          ).join(''),
      )
      .join('') +
      line(
        'M-230 120 L-60 -120 L180 -120 L230 120 M-60 -120 L20 120 L180 -120 M20 120 L-230 120',
        '#c0392b',
        20,
      ) +
      line('M-60 -120 L-80 -190 M-130 -200 H-30 M180 -120 L160 -220 L220 -240', '#2b2f3a', 16) +
      circle(20, 120, 40, '#3a3d45'),
    `translate(${x} ${y - 40}) scale(${s})`,
  );
const rope = (x, y, s) =>
  g(
    path('M-260 -200 C-200 260 200 260 260 -200', 'none', 'stroke="#2f9e6b" stroke-width="16"') +
      path(
        'M-260 -200 C-300 100 300 300 200 -150',
        'none',
        'stroke="#2f9e6b" stroke-width="16" opacity=".35"',
      ) +
      rect(-300, -360, 70, 180, 30, hg('#26408f')) +
      rect(230, -360, 70, 180, 30, hg('#26408f')),
    `translate(${x} ${y + 40}) scale(${s})`,
  );
const tableTennis = (x, y, s) =>
  g(
    g(
      ell(0, -100, 150, 170, rg('#c0392b')) +
        rect(-30, 50, 60, 200, 20, lg('#d39b5a', '#8a5a2b', 1, 0)),
      'translate(-120 0) rotate(-20)',
    ) +
      g(
        ell(0, -100, 150, 170, rg('#2b2f3a')) +
          rect(-30, 50, 60, 200, 20, lg('#d39b5a', '#8a5a2b', 1, 0)),
        'translate(130 20) rotate(18)',
      ) +
      circle(0, 230, 40, rg('#ffffff')) +
      circle(90, 250, 40, rg('#ffa23a')) +
      circle(-90, 250, 40, rg('#ffffff')),
    `translate(${x} ${y - 30}) scale(${s})`,
  );

// ---------- the 104 products ----------
const C = 500;
const art = {
  'tomatoes-basket': () =>
    basket(C, 560, 560, 240) +
    [
      [-180, 470],
      [-60, 450],
      [60, 445],
      [180, 470],
      [-120, 380],
      [0, 370],
      [120, 380],
      [-60, 300],
      [60, 300],
    ]
      .map(([dx, yy]) => tomato(C + dx, yy, 82))
      .join(''),
  'scotch-bonnet': () =>
    pepperBonnet(360, 560, 1.5, '#e63323') +
    pepperBonnet(640, 560, 1.5, '#f6a01a') +
    pepperBonnet(500, 380, 1.5, '#ec5a1d'),
  'bell-peppers': () =>
    bellPepper(300, 540, 1.25, '#3a9a3a') +
    bellPepper(700, 540, 1.25, '#f2c230') +
    bellPepper(500, 470, 1.45, '#d8302a'),
  'onions-bag': () =>
    sack(340, 500, 0.95, '#c8a46b', 'ONIONS', '25 KG', '#7a2e5a') +
    onion(700, 600, 0.9) +
    onion(580, 680, 0.75),
  'ugu-leaves': () => leafBunch(C, 620, 1.35),
  cucumbers: () =>
    cucumber(500, 420, 1.2, -18) + cucumber(470, 560, 1.2, -6) + cucumber(520, 690, 1.2, 8),
  carrots: () => carrot(380, 560, 1.2, -25) + carrot(500, 540, 1.3, 0) + carrot(620, 560, 1.2, 25),
  cabbage: () => cabbage(C, 520, 1.45),
  pineapples: () => pineapple(C, 520, 1.25),
  watermelon: () => watermelon(470, 530, 1.3),
  oranges: () => orange(330, 600, 150) + orange(640, 600, 150) + orange(490, 420, 150),
  'ripe-plantain': () => bananaBunch(C, 470, 1.75, true),
  bananas: () => bananaBunch(C, 470, 1.75),
  pawpaw: () => pawpaw(C, 520, 1.35),
  mangoes: () => mango(340, 600, 1.15, -10) + mango(640, 600, 1.15, 15) + mango(490, 420, 1.15, 0),
  avocado: () => avocado(C, 520, 1.3),
  'rice-50kg': () => sack(C, 520, 1.2, '#f1ead9', 'RICE', 'LONG GRAIN · 50 KG', '#2f9e6b'),
  'beans-oloyin': () => bowlPile(C, 520, 1.25, { kind: 'beans', c: '#b8763d' }),
  'garri-ijebu': () => bowlPile(C, 520, 1.25, { kind: 'grain', c: '#f4ecd8' }, '#3d6fd1'),
  'palm-oil': () => jerrycan(C, 520, 1.25, '#d4471a', 'PALM OIL'),
  'groundnut-oil': () =>
    bottle(380, 540, 1.05, {
      w: 220,
      h: 420,
      nw: 80,
      nh: 60,
      c: '#f6d24a',
      cap: '#c0392b',
      label: 'OIL',
      liquid: '#e9b218',
    }) +
    bottle(650, 580, 0.85, {
      w: 220,
      h: 420,
      nw: 80,
      nh: 60,
      c: '#f6d24a',
      cap: '#c0392b',
      label: 'OIL',
      liquid: '#e9b218',
    }),
  'yellow-maize': () =>
    corn(360, 520, 1.25, -15) + corn(560, 520, 1.25, 10) + corn(720, 560, 1.05, 30),
  'spaghetti-carton': () => carton(C, 520, 1.25, 'SPAGHETTI'),
  egusi: () => bowlPile(C, 520, 1.25, { kind: 'grain', c: '#efe0b8' }, '#c0392b'),
  'yam-tubers': () => yam(500, 420, 1.2, -10) + yam(480, 600, 1.15, 8),
  cassava: () =>
    [380, 470, 560, 650].map((yy, i) => cassava(500, yy, 1.25, (i - 1.5) * 5)).join(''),
  'sweet-potato': () =>
    potato(380, 600, 1.0, -10) + potato(640, 580, 1.0, 15) + potato(500, 430, 1.05, 3),
  cocoyam: () => cocoyam(360, 600, 1.1) + cocoyam(640, 600, 1.1) + cocoyam(500, 450, 1.2),
  'eggs-crate': () => eggCrate(C, 540, 1.15),
  broiler: () => chicken(C, 520, 1.25),
  turkey: () => turkey(C, 540, 1.15),
  goat: () => goat(C, 520, 1.2),
  'android-phone': () => phone(C, 500, 1.15, { apps: true }),
  'used-iphone': () => phoneBack(C, 500, 1.15, '#d9c7e8'),
  laptop: () => laptop(C, 480, 1.2),
  earbuds: () => earbuds(C, 520, 1.25),
  'power-bank': () => powerBank(C, 500, 1.15),
  'bluetooth-speaker': () => speaker(C, 520, 1.25),
  smartwatch: () => smartwatch(C, 500, 1.15),
  headphones: () => headphones(C, 500, 1.3),
  'ankara-fabric': () => fabricStack(C, 520, 1.25),
  'aso-oke': () => asoOke(C, 520, 1.3),
  'mens-shirt': () => shirt(C, 500, 1.3, '#2c6e49', '#f2c230'),
  sneakers: () => sneaker(C, 520, 1.3),
  'leather-bag': () => handbag(C, 500, 1.25),
  beads: () => beads(C, 500, 1.15),
  sandals: () => sandal(400, 500, 1.15) + sandal(620, 520, 1.15),
  sunglasses: () => sunglasses(C, 500, 1.15),
  'pot-set': () =>
    pot(500, 690, 1, '#c0392b', 560) +
    pot(500, 470, 1, '#d64d3c', 440) +
    pot(500, 300, 1, '#e8604c', 320),
  blender: () => blender(C, 520, 1.15),
  kettle: () => kettle(C, 520, 1.2),
  'gas-cooker': () => gasCooker(C, 520, 1.2),
  cooler: () => flask(C, 520, 1.2),
  plates: () => plates(C, 520, 1.3),
  mortar: () => mortar(C, 540, 1.2),
  'standing-fan': () => fan(C, 520, 1.15),
  'shea-butter': () => jar(C, 520, 1.3, '#f2e3c4', '#2f9e6b', 'SHEA', '#2f6b3a'),
  'black-soap': () => soapBars(C, 500, 1.2),
  perfume: () => perfume(C, 520, 1.15),
  'hair-cream': () => jar(C, 520, 1.3, '#c2185b', '#2b2f3a', 'HAIR CREAM', '#c2185b'),
  braids: () => braids(C, 500, 1.2),
  lipstick: () => lipstick(C, 500, 1.2),
  'body-lotion': () =>
    bottle(C, 540, 1.1, {
      w: 260,
      h: 500,
      nw: 90,
      nh: 40,
      c: '#f7e6d6',
      cap: '#8a4b2a',
      label: 'COCOA',
      labelInk: '#8a4b2a',
      r: 70,
    }),
  'makeup-brushes': () => brushes(C, 600, 1.15),
  diapers: () => diaperPack(C, 500, 1.15),
  'baby-clothes': () => onesie(C, 500, 1.25),
  'toy-blocks': () => blocks(C, 460, 1.25),
  'school-bag': () => backpack(C, 520, 1.15, '#e74c3c'),
  teddy: () => teddy(C, 500, 1.15),
  stroller: () => stroller(C, 520, 1.1),
  'feeding-bottles': () => feedingBottles(C, 520, 1.3),
  'kids-shoes': () => sneaker(C, 520, 1.1, '#ffd36e', '#e74c3c'),
  'car-battery': () => carBattery(C, 500, 1.1),
  tyres: () => tyre(C, 500, 1.2),
  'brake-pads': () => brakeDisc(C, 500, 1.2),
  'engine-oil': () => oilJug(C, 520, 1.15),
  headlamp: () => headlamp(C, 500, 1.2),
  'side-mirror': () => sideMirror(C, 480, 1.15),
  'air-filter': () => airFilter(C, 500, 1.2),
  'car-wiper': () => wipers(C, 500, 1.2),
  cement: () =>
    sack(380, 520, 1.05, '#c7c9cc', 'CEMENT', '50 KG · 42.5R', '#26408f') +
    sack(720, 640, 0.62, '#c7c9cc', 'CEMENT', '50 KG', '#26408f'),
  paint: () => paintBucket(C, 500, 1.2),
  drill: () => drill(C, 500, 1.2),
  hammer: () => hammer(C, 520, 1.2),
  toolbox: () => toolbox(C, 500, 1.15),
  wheelbarrow: () => wheelbarrow(C, 540, 1.05),
  'plumbing-pipes': () => pipes(C + 40, 520, 0.95),
  padlock: () => padlock(C, 500, 1.2),
  novel: () => bookStack(C, 520, 1.15, ['#26408f', '#c0392b', '#2f9e6b', '#f28c28', '#6a2c91']),
  notebooks: () =>
    bookStack(C, 520, 1.15, ['#3d6fd1', '#3d6fd1', '#e74c3c', '#e74c3c', '#2f9e6b', '#f2c230']),
  textbook: () => bookStanding(C, 500, 1.15, '#1d6fb8', 'WAEC', 'PAST QUESTIONS'),
  pens: () => pens(C, 500, 1.15),
  calculator: () => calculator(C, 500, 1.15),
  'backpack-laptop': () => backpack(C, 520, 1.15, '#2b2f3a'),
  'art-set': () => pencils(C, 480, 1.15),
  bible: () => bookStanding(C, 500, 1.15, '#2b1d14', 'HOLY', 'BIBLE'),
  football: () => football(C, 500, 1.3),
  jersey: () => shirt(C, 500, 1.3, '#2f9e6b', '#ffffff', '10'),
  dumbbells: () => dumbbells(C, 500, 1.2),
  'yoga-mat': () => yogaMat(C, 500, 1.15),
  bicycle: () => bicycle(C, 520, 1.1),
  'skipping-rope': () => rope(C, 500, 1.15),
  boots: () => sneaker(C, 520, 1.3, '#2b2f3a', '#f2c230', true),
  'table-tennis': () => tableTennis(C, 500, 1.1),
};

const backdrop = {
  Vegetables: ['#eef7e8', '#cfe6c2'],
  Fruit: ['#fff4dc', '#ffd99a'],
  Grains: ['#f8efe0', '#e8d2b0'],
  'Food & groceries': ['#fbf1e4', '#ecd5b6'],
  Tubers: ['#f4ece2', '#ddc9b0'],
  Livestock: ['#eef5f9', '#cfe2ee'],
  'Phones & electronics': ['#eef1f9', '#c9d3ea'],
  'Fashion & accessories': ['#fbedf2', '#ecc9d8'],
  'Home & kitchen': ['#f2f4f7', '#d5dae2'],
  'Beauty & personal care': ['#fdf1ea', '#f1d3c2'],
  'Baby & kids': ['#eef7fc', '#cde6f4'],
  'Auto & spare parts': ['#f1f2f4', '#cfd2d6'],
  'Tools & building materials': ['#f7f2e6', '#e0d5bb'],
  'Books & stationery': ['#f5effa', '#dccdea'],
  'Sports & hobbies': ['#eaf7f1', '#c3e7d6'],
};

function scene(product) {
  defs = [];
  gid = 0;
  const [a, b] = backdrop[product.category] || ['#f2f4f7', '#d5dae2'];
  const body = art[product.slug]();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
<defs><radialGradient id="bg" cx="0.5" cy="0.38" r="0.75"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
<radialGradient id="floor" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>${defs.join('')}</defs>
<rect width="1000" height="1000" fill="url(#bg)"/><ellipse cx="500" cy="860" rx="360" ry="46" fill="url(#floor)"/>${body}</svg>`;
}

await mkdir(out, { recursive: true });
const only = process.argv.slice(2);
const products = demoSellers
  .flatMap((s) => s.products)
  .filter((p) => !only.length || only.includes(p.slug));
const missing = products.filter((p) => !art[p.slug]).map((p) => p.slug);
if (missing.length) throw new Error(`No drawing for: ${missing.join(', ')}`);
for (const product of products)
  await sharp(Buffer.from(scene(product)))
    .jpeg({ quality: 88 })
    .toFile(join(out, `${product.slug}.jpg`));
console.log(`Drew ${products.length} product pictures in ${out}`);
