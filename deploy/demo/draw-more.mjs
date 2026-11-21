// More demo product drawings (homes, offices, parties, food, other cities). Used by draw-photos.mjs,
// which passes in its drawing helpers and existing shapes.
export function moreArt(h) {
  const { g, circle, ell, rect, path, line, text, shine, shade, lg, rg, vg, hg } = h;
  const {
    sack,
    bowlPile,
    bottle,
    carton,
    jar,
    fabricStack,
    shirt,
    sneaker,
    sandal,
    flask,
    plates,
  } = h;
  const { phone, laptop, speaker, earbuds, powerBank, leafBunch, bellPepper, yam, tomato, basket } =
    h;
  const { onion, bananaBunch, pepperBonnet, jerrycan, pencils, backpack } = h;
  const C = 500;

  // ----- furniture -----
  const sofa = (x, y, s, c, wide = 1) =>
    g(
      rect(-300 * wide, -170, 600 * wide, 170, 50, hg(c)) +
        rect(-340 * wide, -60, 680 * wide, 160, 40, hg(shade(c, -0.08))) +
        rect(-380 * wide, -110, 90, 220, 40, hg(shade(c, -0.15))) +
        rect(290 * wide, -110, 90, 220, 40, hg(shade(c, -0.15))) +
        [-1, 0, 1]
          .map((k) => rect(k * 190 * wide - 85 * wide, -40, 170 * wide, 70, 24, shade(c, 0.12)))
          .join('') +
        line(`M${-300 * wide} 100 v60 M${300 * wide} 100 v60`, '#3a2a1c', 18),
      `translate(${x} ${y}) scale(${s})`,
    );
  const table = (x, y, s, top = '#bfe3f5', leg = '#6d4523', glass = true) =>
    g(
      path(
        'M-300 -40 L300 -40 L240 40 L-360 40 Z',
        glass ? 'rgba(190,227,245,.85)' : hg(top),
        `stroke="${shade(top, -0.3)}" stroke-width="6"`,
      ) + line('M-320 40 V220 M220 40 V220 M-250 -30 V160 M280 -30 V160', leg, 22),
      `translate(${x} ${y}) scale(${s})`,
    );
  const bed = (x, y, s, c = '#8a5a2b', sheet = '#e9eef8', bunk = false) => {
    const one = (dy) =>
      rect(-330, dy - 40, 660, 90, 20, hg(c)) +
      rect(-310, dy - 90, 620, 70, 26, sheet) +
      rect(-300, dy - 120, 160, 50, 24, '#fff') +
      rect(-120, dy - 110, 400, 60, 20, shade(sheet, -0.1));
    return g(
      rect(-360, bunk ? -420 : -260, 50, bunk ? 640 : 480, 14, c) +
        rect(310, bunk ? -360 : -120, 50, bunk ? 580 : 340, 14, c) +
        (bunk ? one(-200) : rect(-360, -260, 50, 200, 14, shade(c, -0.15))) +
        one(100) +
        line('M-330 150 V220 M330 150 V220', shade(c, -0.3), 22),
      `translate(${x} ${y}) scale(${s})`,
    );
  };
  const wardrobe = (x, y, s, c = '#a77a4f', shelves = false) =>
    g(
      rect(-240, -320, 480, 600, 16, hg(c)) +
        (shelves
          ? [-200, -60, 80, 220]
              .map(
                (yy) =>
                  rect(-220, yy, 440, 16, 4, shade(c, -0.3)) +
                  [0, 1, 2, 3, 4]
                    .map((k) =>
                      rect(
                        -200 + k * 40,
                        yy - 110,
                        30,
                        110,
                        4,
                        ['#c0392b', '#26408f', '#2f9e6b', '#f2c230', '#6a2c91'][k],
                      ),
                    )
                    .join(''),
              )
              .join('')
          : line('M-80 -310 V270 M80 -310 V270', shade(c, -0.3), 6) +
            rect(-70, -280, 140, 520, 10, 'rgba(200,225,245,.7)') +
            [-110, 110].map((hx) => rect(hx - 8, -40, 16, 70, 8, '#e2b24a')).join('')) +
        rect(-250, 270, 500, 30, 8, shade(c, -0.35)),
      `translate(${x} ${y}) scale(${s})`,
    );
  const chair = (x, y, s, c = '#e74c3c', plastic = true) =>
    g(
      (plastic
        ? path('M-110 -260 C-110 -300 110 -300 110 -260 L120 -40 H-120 Z', hg(c))
        : rect(-120, -280, 240, 240, 30, hg(c))) +
        rect(-150, -50, 300, 60, 20, hg(shade(c, 0.05))) +
        line(
          'M-130 10 L-150 240 M130 10 L150 240 M-90 10 L-100 220 M90 10 L100 220',
          shade(c, -0.25),
          18,
        ),
      `translate(${x} ${y}) scale(${s})`,
    );
  const desk = (x, y, s, c = '#c08a55') =>
    g(
      rect(-340, -120, 680, 50, 10, hg(c)) +
        rect(150, -70, 170, 280, 10, hg(shade(c, -0.1))) +
        [-20, 70, 160]
          .map(
            (yy) =>
              rect(170, yy - 70, 130, 70, 6, shade(c, 0.1)) +
              rect(220, yy - 40, 30, 10, 5, '#5b4512'),
          )
          .join('') +
        line('M-310 -70 V220', shade(c, -0.3), 24) +
        laptop(-120, -230, 0.38),
      `translate(${x} ${y}) scale(${s})`,
    );
  const officeChair = (x, y, s, c = '#2b2f3a', exec = false) =>
    g(
      rect(-130, exec ? -360 : -280, 260, exec ? 330 : 250, 60, hg(c)) +
        (exec ? '' : rect(-110, -260, 220, 200, 40, 'rgba(255,255,255,.08)')) +
        rect(-170, -40, 340, 70, 30, hg(shade(c, 0.1))) +
        rect(-210, -120, 50, 120, 20, shade(c, -0.2)) +
        rect(160, -120, 50, 120, 20, shade(c, -0.2)) +
        rect(-14, 30, 28, 130, 10, '#9aa1ae') +
        line('M0 170 L-200 230 M0 170 L200 230 M0 170 L-90 250 M0 170 L90 250', '#3a3d45', 18) +
        [-200, 200, -90, 90].map((wx) => circle(wx, 240, 18, '#1d1f24')).join(''),
      `translate(${x} ${y + 20}) scale(${s})`,
    );
  const cabinet = (x, y, s) =>
    g(
      rect(-170, -320, 340, 620, 16, hg('#9aa6b8')) +
        [0, 1, 2, 3]
          .map(
            (k) =>
              rect(-150, -300 + k * 150, 300, 135, 10, hg('#b8c2d1')) +
              rect(-50, -250 + k * 150, 100, 20, 10, '#5f6570'),
          )
          .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const dining = (x, y, s) =>
    g(
      chair(-300, 20, 0.8, '#7a4a26', false) +
        chair(300, 20, 0.8, '#7a4a26', false) +
        table(0, 0, 0.9, '#a77a4f', '#5b3a1f', false) +
        chair(-120, 120, 0.75, '#8a5a2b', false) +
        chair(120, 120, 0.75, '#8a5a2b', false),
      `translate(${x} ${y}) scale(${s})`,
    );
  const tvStand = (x, y, s) =>
    g(
      rect(-330, 40, 660, 180, 16, hg('#5b3a1f')) +
        rect(-300, 70, 280, 120, 10, '#7a4a26') +
        rect(20, 70, 280, 120, 10, '#7a4a26') +
        tv(0, -150, 0.7, 40),
      `translate(${x} ${y}) scale(${s})`,
    );

  // ----- bedding -----
  const mattress = (x, y, s, c = '#eef1f8', quilt = '#26408f') =>
    g(
      path('M-360 -40 L-200 -180 H360 L220 -40 Z', hg(c)) +
        rect(-360, -40, 580, 160, 30, hg(shade(c, -0.05))) +
        path('M220 -40 L360 -180 V-20 L220 120 Z', shade(c, -0.15)) +
        [-300, -200, -100, 0, 100]
          .map((mx) => line(`M${mx} -10 v100`, quilt, 4, 'opacity=".35"'))
          .join('') +
        line('M-360 20 H220', quilt, 8, 'opacity=".5"') +
        rect(-280, 60, 160, 30, 8, quilt),
      `translate(${x} ${y + 60}) scale(${s})`,
    );
  const pillows = (x, y, s) =>
    g(
      [0, 1]
        .map((k) =>
          g(
            rect(-230, -90, 460, 180, 80, rg('#f7f8fc', 0.4, 0.3)) +
              line('M-180 -40 C-100 -20 100 -20 180 -40', '#d9dee8', 5),
            `translate(${k ? 60 : -40} ${k ? -90 : 60}) rotate(${k ? -6 : 4})`,
          ),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const folded = (x, y, s, colors) =>
    g(
      colors
        .map(
          (c, i) =>
            rect(-260 + i * 8, 140 - i * 100, 520, 90, 20, hg(c)) +
            rect(-260 + i * 8, 200 - i * 100, 520, 18, 9, shade(c, -0.2)),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const net = (x, y, s) =>
    g(
      path(
        'M0 -320 C-60 -260 -280 -100 -300 260 H300 C280 -100 60 -260 0 -320Z',
        'rgba(240,245,255,.85)',
        'stroke="#9fb3cc" stroke-width="4"',
      ) +
        Array.from({ length: 10 }, (_, i) =>
          line(`M0 -320 L${-300 + i * 66} 260`, '#c5d2e3', 3),
        ).join('') +
        rect(-310, 250, 620, 20, 10, '#26408f'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const cot = (x, y, s) =>
    g(
      rect(-320, -160, 640, 300, 20, 'none', 'stroke="#f2c230" stroke-width="20"') +
        Array.from({ length: 11 }, (_, i) =>
          line(`M${-280 + i * 56} -150 V130`, '#f2c230', 12),
        ).join('') +
        rect(-300, 60, 600, 70, 16, '#f6a5c0') +
        line('M-320 140 V240 M320 140 V240', '#d9a51c', 22),
      `translate(${x} ${y}) scale(${s})`,
    );

  // ----- electronics & appliances -----
  const tv = (x, y, s, w = 0) =>
    g(
      rect(-340 - w, -210, 680 + w * 2, 400, 20, '#1d1f24') +
        rect(-320 - w, -190, 640 + w * 2, 360, 8, lg('#2a6bd8', '#f5a524', 1, 1)) +
        circle(-60, -30, 70, '#ffd36e', 'opacity=".8"') +
        path(
          `M${-320 - w} 170 L-120 20 L40 120 L180 0 L${320 + w} 170Z`,
          '#1f6f43',
          'opacity=".75"',
        ) +
        rect(-60, 190, 120, 40, 8, '#2b2f3a') +
        rect(-180, 228, 360, 22, 10, '#2b2f3a'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const fridge = (x, y, s, kind = 'double') =>
    kind === 'chest'
      ? g(
          rect(-320, -120, 640, 330, 30, hg('#f4f6fa')) +
            rect(-320, -170, 640, 70, 26, hg('#e3e7ee')) +
            rect(-60, -120, 120, 26, 10, '#9aa1ae') +
            rect(-260, 0, 200, 40, 10, '#26408f') +
            text(-160, 30, 'FREEZER', 26, '#fff', 800),
          `translate(${x} ${y + 40}) scale(${s})`,
        )
      : g(
          rect(
            -200,
            kind === 'small' ? -220 : -340,
            400,
            kind === 'small' ? 460 : 640,
            30,
            vg('#e9edf3'),
          ) +
            line(`M-200 ${kind === 'small' ? -80 : -120} H200`, '#c5ccd8', 6) +
            rect(140, kind === 'small' ? -190 : -300, 20, 90, 10, '#9aa1ae') +
            rect(140, kind === 'small' ? -40 : -80, 20, 140, 10, '#9aa1ae') +
            shine(-150, 0, 10, 200, 0, 0.5),
          `translate(${x} ${y}) scale(${s})`,
        );
  const inverter = (x, y, s) =>
    g(
      rect(-330, -150, 330, 380, 20, hg('#2f333d')) +
        rect(-300, -110, 270, 90, 10, '#9ad6a5') +
        text(-165, -50, '230V', 46, '#1f3b24', 800) +
        [0, 1, 2]
          .map((k) => circle(-250 + k * 60, 40, 16, ['#4cd964', '#f2c230', '#c0392b'][k]))
          .join('') +
        g(
          rect(-150, -120, 300, 330, 16, hg('#1d1f24')) +
            rect(-110, -150, 50, 40, 6, '#c0392b') +
            rect(60, -150, 50, 40, 6, '#555') +
            rect(-120, 0, 240, 90, 10, '#f2c230') +
            text(0, 60, '200Ah', 46, '#1d1f24', 900),
          'translate(180 20)',
        ),
      `translate(${x} ${y}) scale(${s})`,
    );
  const generator = (x, y, s) =>
    g(
      rect(-330, -60, 660, 300, 30, hg('#c0392b')) +
        rect(-360, -120, 720, 70, 20, '#2b2f3a') +
        line('M-360 -120 V260 M360 -120 V260', '#2b2f3a', 26) +
        rect(-260, 0, 260, 170, 16, '#3a3d45') +
        Array.from({ length: 6 }, (_, i) => line(`M-240 ${30 + i * 25} H-20`, '#5f6570', 6)).join(
          '',
        ) +
        circle(150, 80, 70, '#2b2f3a') +
        circle(150, 80, 40, '#9aa1ae') +
        rect(60, -50, 200, 40, 10, '#f2c230') +
        text(160, -20, '3.5kVA', 30, '#1d1f24', 900),
      `translate(${x} ${y}) scale(${s})`,
    );
  const lamp = (x, y, s) =>
    g(
      rect(-150, -200, 300, 360, 40, hg('#f2c230')) +
        rect(-120, -170, 240, 230, 20, rg('#ffffff', 0.5, 0.5)) +
        Array.from({ length: 4 }, (_, r) =>
          Array.from({ length: 5 }, (_, c) =>
            circle(-80 + c * 40, -130 + r * 50, 12, '#fff7c2'),
          ).join(''),
        ).join('') +
        path(
          'M-100 -200 C-100 -320 100 -320 100 -200',
          'none',
          'stroke="#2b2f3a" stroke-width="24"',
        ) +
        rect(-150, 160, 300, 60, 20, '#2b2f3a'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const iron = (x, y, s) =>
    g(
      path('M-320 120 C-300 -20 -60 -100 300 -40 L320 120 Z', hg('#26408f')) +
        path('M-340 120 H330 L320 170 H-330 Z', lg('#e9edf3', '#9aa1ae', 1, 0)) +
        path(
          'M-120 -60 C-120 -220 220 -220 220 -50',
          'none',
          'stroke="#2b2f3a" stroke-width="50"',
        ) +
        circle(80, 30, 30, '#f2c230') +
        line('M300 -20 C380 -20 400 100 460 120', '#2b2f3a', 10),
      `translate(${x - 40} ${y + 40}) scale(${s})`,
    );
  const socket = (x, y, s) =>
    g(
      rect(-330, -80, 660, 160, 40, hg('#f4f6fa')) +
        [-210, -70, 70, 210]
          .map(
            (sx) =>
              rect(sx - 50, -45, 100, 90, 16, '#d9dee8') +
              rect(sx - 22, -20, 12, 30, 4, '#3a3d45') +
              rect(sx + 10, -20, 12, 30, 4, '#3a3d45'),
          )
          .join('') +
        circle(-300, 0, 14, '#c0392b') +
        line('M330 0 C430 0 420 200 300 220', '#2b2f3a', 18),
      `translate(${x} ${y}) scale(${s})`,
    );
  const bulb = (x, y, s) =>
    g(
      circle(0, -80, 180, rg('#fff7c2', 0.4, 0.35)) +
        path('M-90 60 H90 L70 140 H-70 Z', '#e9edf3') +
        [0, 1, 2].map((k) => rect(-75, 150 + k * 34, 150, 24, 10, '#9aa1ae')).join('') +
        path('M-40 -60 Q0 -140 40 -60 Q0 0 -40 -60', 'none', 'stroke="#f2a516" stroke-width="10"') +
        [-1, 1]
          .map((k) =>
            line(`M${k * 230} -200 l${k * 50} -40 M${k * 250} -60 l${k * 70} 0`, '#f2c230', 14),
          )
          .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const printer = (x, y, s) =>
    g(
      rect(-300, -80, 600, 240, 30, hg('#e9edf3')) +
        rect(-220, -220, 440, 160, 10, '#fff', 'stroke="#c5ccd8" stroke-width="6"') +
        Array.from({ length: 4 }, (_, i) =>
          line(`M-180 ${-180 + i * 30} H${120 - i * 30}`, '#9aa1ae', 6),
        ).join('') +
        rect(-240, 120, 480, 120, 10, hg('#c5ccd8')) +
        rect(-200, 150, 400, 40, 6, '#fff') +
        circle(220, -20, 16, '#4cd964'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const router = (x, y, s) =>
    g(
      rect(-300, -40, 600, 160, 40, hg('#2b2f3a')) +
        [-200, -80, 40, 160].map((dx) => circle(dx, 40, 12, '#4cd964')).join('') +
        line('M-220 -40 L-260 -280 M0 -40 V-300 M220 -40 L260 -280', '#2b2f3a', 24) +
        [80, 140, 200]
          .map((r) =>
            path(
              `M${-r * 0.7} ${-360 + r * 0.2} A${r} ${r} 0 0 1 ${r * 0.7} ${-360 + r * 0.2}`,
              'none',
              'stroke="#26408f" stroke-width="14" opacity=".55"',
            ),
          )
          .join(''),
      `translate(${x} ${y + 60}) scale(${s})`,
    );
  const waterDispenser = (x, y, s) =>
    g(
      path(
        'M-120 -340 H120 C150 -340 160 -300 160 -260 V-120 H-160 V-260 C-160 -300 -150 -340 -120 -340Z',
        'rgba(150,200,240,.8)',
      ) +
        rect(-180, -120, 360, 460, 24, vg('#f4f6fa')) +
        rect(-120, -60, 240, 90, 12, '#d9dee8') +
        rect(-80, 30, 40, 50, 8, '#c0392b') +
        rect(40, 30, 40, 50, 8, '#26408f') +
        rect(-140, 200, 280, 20, 8, '#9aa1ae'),
      `translate(${x} ${y + 20}) scale(${s})`,
    );
  const paperReam = (x, y, s, c = '#ffffff', band = '#26408f', label = 'A4 · 80gsm') =>
    g(
      path('M-300 -60 L0 -160 L300 -60 L0 40Z', shade(c, 0.02)) +
        path('M-300 -60 L0 40 V200 L-300 100Z', c === '#ffffff' ? '#eef1f6' : c) +
        path('M300 -60 L0 40 V200 L300 100Z', shade(c === '#ffffff' ? '#e3e7ee' : c, -0.1)) +
        path('M-300 -10 L0 90 V140 L-300 40Z', band) +
        text(-150, 85, label, 30, '#fff', 800, 'transform="skewY(18)" transform-origin="-150 85"'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const tablet = (x, y, s) =>
    g(
      rect(-300, -220, 600, 440, 40, vg('#2b2f3a')) +
        rect(-270, -190, 540, 380, 20, lg('#3aa0ff', '#7c5cd6', 1, 1)) +
        [0, 1, 2, 3, 4]
          .map((k) => rect(-220 + k * 95, -130, 60, 60, 14, '#fff', 'opacity=".75"'))
          .join(''),
      `translate(${x} ${y}) rotate(-6) scale(${s})`,
    );
  const charger = (x, y, s) =>
    g(
      rect(-120, -120, 240, 240, 40, hg('#f4f6fa')) +
        rect(-60, -200, 30, 90, 8, '#c9ced8') +
        rect(30, -200, 30, 90, 8, '#c9ced8') +
        line('M0 120 C0 260 260 200 280 320', '#f4f6fa', 30) +
        rect(250, 300, 70, 110, 16, '#e9edf3'),
      `translate(${x - 60} ${y - 60}) scale(${s})`,
    );

  // ----- home essentials -----
  const curtains = (x, y, s, c = '#26408f') =>
    g(
      rect(-340, -330, 680, 30, 15, '#5b3a1f') +
        [-1, 1]
          .map(
            (k) =>
              path(
                `M${k * 330} -300 C${k * 300} -100 ${k * 170} 100 ${k * 230} 300 L${k * 40} 300 C${k * 60} 100 ${k * 30} -100 ${k * 20} -300Z`,
                hg(c),
              ) +
              [0.2, 0.45, 0.7]
                .map((t) =>
                  line(
                    `M${k * (20 + 310 * t)} -300 C${k * (20 + 280 * t)} 0 ${k * (40 + 190 * t)} 200 ${k * (40 + 190 * t)} 300`,
                    shade(c, -0.25),
                    6,
                    'opacity=".5"',
                  ),
                )
                .join(''),
          )
          .join('') +
        rect(-340, -300, 680, 600, 0, 'rgba(255,255,255,.15)', 'opacity=".2"'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const towels = (x, y, s) => folded(x, y, s, ['#f4f6fa', '#6ec1ea', '#f6a5c0', '#2f9e6b']);
  const bucketBowl = (x, y, s) =>
    g(
      path('M-160 -150 H160 L130 230 H-130 Z', hg('#2f7dd1')) +
        ell(0, -150, 160, 34, '#1d5fa8') +
        path(
          'M-170 -160 C-170 -330 170 -330 170 -160',
          'none',
          'stroke="#9aa1ae" stroke-width="12"',
        ) +
        g(
          path('M-180 0 H180 L130 110 H-130Z', hg('#f2c230')) + ell(0, 0, 180, 30, '#d9a51c'),
          'translate(-160 180) scale(.8)',
        ),
      `translate(${x + 60} ${y}) scale(${s})`,
    );
  const doorMat = (x, y, s) =>
    g(
      path('M-340 -60 L280 -160 L360 120 L-260 220Z', hg('#7a4a26')) +
        path('M-300 -40 L270 -130 L330 100 L-240 190Z', '#a26b3c') +
        text(30, 50, 'WELCOME', 70, '#f3e1c4', 900, 'transform="rotate(-9 30 50)"'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const rug = (x, y, s) =>
    g(
      path('M-360 -120 L300 -200 L380 160 L-280 240Z', hg('#c0392b')) +
        path('M-310 -90 L270 -160 L330 130 L-240 200Z', '#e74c3c') +
        path('M-200 -40 L180 -90 L220 90 L-150 140Z', '#f2c230') +
        circle(10, 25, 50, '#26408f'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const gasCylinder = (x, y, s) =>
    g(
      rect(-170, -200, 340, 460, 120, vg('#2f9e6b')) +
        rect(-90, -300, 180, 120, 30, 'none', 'stroke="#1f6f43" stroke-width="28"') +
        rect(-30, -260, 60, 70, 10, '#9aa1ae') +
        rect(-150, 220, 300, 60, 20, '#1f6f43') +
        rect(-110, -40, 220, 90, 14, '#fff') +
        text(0, 20, '12.5 KG', 40, '#1f6f43', 900),
      `translate(${x} ${y}) scale(${s})`,
    );
  const cutlery = (x, y, s) =>
    g(
      [
        [-150, '#c9ced8', 'spoon'],
        [-50, '#c9ced8', 'fork'],
        [50, '#c9ced8', 'knife'],
        [150, '#8a5a2b', 'ladle'],
      ]
        .map(([cx, c, kind]) =>
          g(
            rect(-14, -60, 28, 360, 14, vg(c)) +
              (kind === 'spoon' || kind === 'ladle'
                ? ell(0, -140, kind === 'ladle' ? 70 : 50, kind === 'ladle' ? 90 : 80, vg(c))
                : kind === 'fork'
                  ? rect(-40, -260, 80, 200, 10, vg(c)) +
                    [-24, -8, 8, 24].map((t) => rect(t - 5, -300, 10, 80, 4, c)).join('')
                  : path('M-20 -320 C40 -300 40 -120 14 -60 H-20Z', vg(c))),
            `translate(${cx} 0)`,
          ),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const containers = (x, y, s) =>
    g(
      [
        [-150, 80, '#6ec1ea'],
        [130, 90, '#f2c230'],
        [0, -120, '#2f9e6b'],
      ]
        .map(([cx, cy, c]) =>
          g(
            rect(
              -150,
              -80,
              300,
              180,
              26,
              'rgba(240,248,255,.9)',
              'stroke="#c5d2e3" stroke-width="6"',
            ) + rect(-160, -110, 320, 50, 18, c),
            `translate(${cx} ${cy})`,
          ),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );

  // ----- provisions -----
  const bottlesPack = (x, y, s, colors, cap = '#c0392b', clear = false) =>
    g(
      colors
        .map((c, i) =>
          g(
            rect(
              -55,
              -170,
              110,
              300,
              40,
              clear ? 'rgba(170,215,245,.75)' : vg(c),
              clear ? 'stroke="#8fc3e8" stroke-width="5"' : '',
            ) +
              rect(-25, -240, 50, 80, 12, clear ? 'rgba(170,215,245,.75)' : vg(c)) +
              rect(-30, -270, 60, 34, 8, cap) +
              rect(-55, -40, 110, 70, 6, clear ? '#26408f' : '#fff', 'opacity=".9"'),
            `translate(${-240 + i * 120} ${i % 2 ? 30 : 0})`,
          ),
        )
        .join('') +
        rect(-320, 120, 640, 90, 14, 'rgba(255,255,255,.35)', 'stroke="#c5ccd8" stroke-width="4"'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const tin = (x, y, s, c, label, sub = '') =>
    g(
      rect(-180, -200, 360, 420, 40, vg(c)) +
        ell(0, -200, 180, 40, shade(c, 0.25)) +
        rect(-180, -60, 360, 160, 0, '#fff', 'opacity=".92"') +
        text(0, 20, label, 56, c, 900) +
        (sub ? text(0, 75, sub, 30, shade(c, -0.2), 700) : ''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const cake = (x, y, s, tiers = 1, c = '#f6a5c0') => {
    let b = '';
    for (let i = 0; i < tiers; i++) {
      const w = 300 - i * 70,
        yy = 120 - i * 150;
      b +=
        rect(-w, yy - 140, w * 2, 160, 24, vg(i % 2 ? '#fff4e0' : c)) +
        path(
          `M${-w} ${yy - 120} ` +
            Array.from({ length: 8 }, (_, k) => `q${w / 8} 40 ${w / 4} 0`).join(' '),
          'none',
          `stroke="#fff" stroke-width="16"`,
        );
    }
    b += ell(0, 150, 360, 40, '#d9dee8');
    for (let k = 0; k < (tiers === 1 ? 5 : 1); k++)
      b +=
        rect(
          -120 + k * 60 - 6,
          120 - tiers * 150 - 30,
          12,
          60,
          6,
          ['#26408f', '#f2c230', '#2f9e6b', '#c0392b', '#6a2c91'][k],
        ) + ell(-120 + k * 60, 120 - tiers * 150 - 40, 10, 18, '#ffb02e');
    return g(b, `translate(${x} ${y + 40}) scale(${s})`);
  };
  const breadLoaf = (x, y, s, c = '#d9963f') =>
    g(
      path('M-320 100 C-340 -160 -200 -200 0 -200 C200 -200 340 -160 320 100 Z', rg(c, 0.4, 0.2)) +
        rect(-320, 60, 640, 120, 20, shade(c, -0.1)) +
        [-160, -40, 80, 200]
          .map((bx) =>
            path(
              `M${bx - 40} -140 q40 -40 80 0`,
              'none',
              `stroke="${shade(c, 0.3)}" stroke-width="12"`,
            ),
          )
          .join('') +
        rect(-300, 90, 600, 60, 10, 'rgba(255,255,255,.35)'),
      `translate(${x} ${y + 30}) scale(${s})`,
    );
  const pastries = (x, y, s) =>
    g(
      [
        [-200, 60],
        [0, 90],
        [200, 60],
        [-100, -70],
        [100, -70],
      ]
        .map(([px, py]) =>
          g(
            path('M-110 40 C-110 -70 110 -70 110 40Z', rg('#e2a64a', 0.4, 0.2)) +
              line('M-100 40 H100', '#b5741a', 8) +
              [-60, -20, 20, 60].map((cx) => line(`M${cx} 32 l8 -14`, '#b5741a', 6)).join(''),
            `translate(${px} ${py})`,
          ),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const cupcakes = (x, y, s) =>
    g(
      [
        [-180, 60, '#f6a5c0'],
        [0, 80, '#c49a6c'],
        [180, 60, '#9ad6f5'],
        [-90, -100, '#f2c230'],
        [90, -100, '#f6a5c0'],
      ]
        .map(([cx, cy, c]) =>
          g(
            path('M-80 0 L80 0 L60 110 H-60Z', '#e9d3b0') +
              circle(0, -20, 90, rg(c, 0.4, 0.3)) +
              circle(0, -90, 18, '#c0392b'),
            `translate(${cx} ${cy})`,
          ),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const drumsticks = (x, y, s, c = '#d9963f') =>
    g(
      [
        [-120, 0, -30],
        [120, 20, 30],
        [0, -80, 0],
      ]
        .map(([dx, dy, r]) =>
          g(
            ell(0, -80, 110, 140, rg(c, 0.4, 0.3)) +
              rect(-22, 40, 44, 180, 18, '#f3e6cf') +
              circle(-24, 230, 26, '#f3e6cf') +
              circle(24, 230, 26, '#f3e6cf'),
            `translate(${dx} ${dy}) rotate(${r})`,
          ),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const meatSlab = (x, y, s, c = '#b3332b', fat = '#f3e6cf') =>
    g(
      path(
        'M-320 -60 C-300 -180 200 -200 300 -100 C360 -40 330 120 220 160 C40 220 -260 200 -320 120 C-350 60 -340 0 -320 -60Z',
        rg(c, 0.4, 0.3),
      ) +
        path(
          'M-260 -40 C-120 -100 80 -100 200 -60',
          'none',
          `stroke="${fat}" stroke-width="22" opacity=".85"`,
        ) +
        path(
          'M-220 80 C-80 40 100 50 220 90',
          'none',
          `stroke="${fat}" stroke-width="14" opacity=".7"`,
        ) +
        shine(-150, -100, 60, 14, -8, 0.3),
      `translate(${x} ${y + 30}) scale(${s})`,
    );
  const fish = (x, y, s, c = '#8fa3b8', dried = false) =>
    g(
      path(
        'M-320 0 C-200 -170 160 -170 260 0 C160 170 -200 170 -320 0Z',
        dried ? lg('#b5741a', '#6b3d12', 1, 1) : lg(shade(c, 0.35), shade(c, -0.2)),
      ) +
        path('M240 0 L380 -120 L360 0 L380 120Z', dried ? '#7a4a26' : shade(c, -0.15)) +
        circle(-220, -30, 22, '#fff') +
        circle(-220, -30, 12, '#1d1f24') +
        path(
          'M-140 -60 C-110 0 -110 40 -140 80',
          'none',
          `stroke="${shade(c, -0.35)}" stroke-width="8"`,
        ) +
        (dried
          ? ''
          : Array.from({ length: 5 }, (_, i) =>
              path(
                `M${-60 + i * 60} -40 q20 40 0 80`,
                'none',
                `stroke="${shade(c, 0.1)}" stroke-width="5" opacity=".6"`,
              ),
            ).join('')),
      `translate(${x} ${y}) scale(${s})`,
    );
  const okra = (x, y, s) =>
    g(
      Array.from({ length: 6 }, (_, i) =>
        g(
          path(
            'M0 -200 C40 -160 50 100 0 180 C-50 100 -40 -160 0 -200Z',
            lg('#6fbf4a', '#2f7d33', 1, 0),
          ) +
            line('M0 -190 V170', '#2f7d33', 5, 'opacity=".5"') +
            rect(-14, -240, 28, 50, 8, '#3f7d2c'),
          `translate(${-250 + i * 100} ${i % 2 ? 30 : 0}) rotate(${(i - 2.5) * 10})`,
        ),
      ).join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const prawns = (x, y, s) =>
    g(
      [
        [-160, 0, -20],
        [140, 20, 20],
        [0, -120, 0],
        [-40, 120, 10],
      ]
        .map(([px, py, r]) =>
          g(
            path(
              'M-140 0 C-140 -110 120 -120 140 0 C110 -60 -110 -60 -100 20 Z',
              lg('#ff9a6b', '#e2532b', 1, 1),
            ) +
              [0, 1, 2, 3].map((k) => line(`M${-80 + k * 50} -60 v40`, '#c94422', 5)).join('') +
              line('M140 0 l60 -40 M140 0 l70 10', '#e2532b', 6) +
              circle(110, -20, 8, '#1d1f24'),
            `translate(${px} ${py}) rotate(${r})`,
          ),
        )
        .join(''),
      `translate(${x} ${y}) scale(${s})`,
    );
  const balloons = (x, y, s) =>
    g(
      [
        [-150, -120, '#e74c3c'],
        [0, -200, '#26408f'],
        [150, -120, '#f2c230'],
        [-60, 20, '#2f9e6b'],
        [80, 0, '#f6a5c0'],
      ]
        .map(
          ([bx, by, c]) =>
            line(`M${bx} ${by + 130} C${bx + 20} ${by + 250} 0 300 0 360`, '#9aa1ae', 4) +
            ell(bx, by, 100, 125, rg(c, 0.35, 0.3)) +
            path(`M${bx - 12} ${by + 125} h24 l-12 18z`, shade(c, -0.2)),
        )
        .join(''),
      `translate(${x} ${y - 40}) scale(${s})`,
    );
  const giftBag = (x, y, s, c = '#c2185b', band = '#f2c230') =>
    g(
      path('M-90 -200 C-90 -320 90 -320 90 -200', 'none', `stroke="${band}" stroke-width="18"`) +
        path('M-230 -200 H230 L200 260 H-200Z', hg(c)) +
        rect(-30, -200, 60, 460, 0, band, 'opacity=".9"') +
        path(
          'M-120 -260 C-60 -330 0 -260 0 -230 C0 -260 60 -330 120 -260 C80 -200 0 -220 0 -230 C0 -220 -80 -200 -120 -260Z',
          band,
        ),
      `translate(${x} ${y + 30}) scale(${s})`,
    );
  const hamper = (x, y, s) =>
    g(
      bottlesPack(
        0,
        -60,
        0.85,
        ['#7a1f3d', '#2f9e6b', '#d4a237', '#7a1f3d', '#26408f'],
        '#d4a237',
      ) +
        giftBag(-230, -40, 0.4, '#26408f') +
        giftBag(230, -30, 0.4, '#c2185b') +
        basket(0, 80, 680, 240, '#b9803f'),
      `translate(${x} ${y}) scale(${s})`,
    );
  const socks = (x, y, s) =>
    g(
      [
        [-90, '#ffffff', -6],
        [90, '#f4f6fa', 6],
      ]
        .map(([sx, c, r]) =>
          g(
            path(
              'M-60 -260 H60 V60 C60 120 160 120 200 140 C250 165 230 240 170 240 H-20 C-60 240 -60 200 -60 160 Z',
              hg(c),
              'stroke="#c5ccd8" stroke-width="6"',
            ) +
              rect(-60, -260, 120, 60, 10, '#26408f') +
              rect(-60, -180, 120, 16, 4, '#c0392b'),
            `translate(${sx} 0) rotate(${r})`,
          ),
        )
        .join(''),
      `translate(${x - 40} ${y}) scale(${s})`,
    );
  const mathsSet = (x, y, s) =>
    g(
      rect(-300, -200, 600, 400, 30, hg('#26408f')) +
        rect(-270, -170, 540, 340, 20, '#e9edf3') +
        path(
          'M-230 120 A140 140 0 0 1 50 120Z',
          'rgba(240,248,255,.9)',
          'stroke="#26408f" stroke-width="6"',
        ) +
        rect(-240, 140, 300, 24, 4, '#f2c230') +
        line('M120 -130 L170 120 M120 -130 L230 110', '#5f6570', 10) +
        circle(120, -140, 14, '#5f6570') +
        path(
          'M80 -120 L230 -120 L230 30Z',
          'rgba(240,248,255,.9)',
          'stroke="#26408f" stroke-width="6"',
        ),
      `translate(${x} ${y}) scale(${s})`,
    );
  const pile = (c, bowl = '#d6dbe4', beans = false) =>
    bowlPile(C, 520, 1.25, { kind: beans ? 'beans' : 'grain', c }, bowl);

  return {
    // furniture
    'sofa-3-seater': () => sofa(C, 520, 1.1, '#7d8794'),
    'sofa-set': () =>
      sofa(C, 500, 0.85, '#7a4a26', 1.25) +
      sofa(200, 700, 0.5, '#7a4a26', 0.6) +
      sofa(800, 700, 0.5, '#7a4a26', 0.6),
    'centre-table': () => table(C, 520, 1.15),
    'bed-frame-6ft': () => bed(C, 540, 1.05),
    'wardrobe-3door': () => wardrobe(C, 500, 1.15),
    'dining-set': () => dining(C, 520, 1.05),
    'tv-stand': () => tvStand(C, 520, 1.1),
    bookshelf: () => wardrobe(C, 500, 1.1, '#8a5a2b', true),
    'plastic-chairs': () => chair(380, 520, 1, '#e74c3c') + chair(620, 540, 1, '#26408f'),
    'office-desk-home': () => desk(C, 520, 1.1, '#e0c49a'),
    // bedding
    'ortho-mattress': () => mattress(C, 480, 1.15),
    'foam-mattress': () => mattress(C, 480, 1.15, '#f6efe0', '#c0392b'),
    pillows: () => pillows(C, 520, 1.2),
    'bedsheet-set': () => folded(C, 520, 1.1, ['#26408f', '#6ec1ea', '#f4f6fa']),
    duvet: () => folded(C, 520, 1.1, ['#f4f6fa', '#e9d3f0', '#f6a5c0']),
    'mosquito-net': () => net(C, 500, 1.1),
    'bunk-bed': () => bed(C, 560, 0.95, '#3a3d45', '#cfe0f7', true),
    'baby-cot': () => cot(C, 520, 1.1),
    // electronics
    'smart-tv-43': () => tv(C, 480, 1.25, 30),
    'tv-32': () => tv(C, 480, 1.05),
    'fridge-double': () => fridge(C, 500, 1.15),
    'fridge-small': () => fridge(C, 520, 1.15, 'small'),
    'chest-freezer': () => fridge(C, 520, 1.15, 'chest'),
    inverter: () => inverter(C, 500, 1.15),
    generator: () => generator(C, 520, 1.1),
    'rechargeable-lamp': () => lamp(C, 500, 1.15),
    'pressing-iron': () => iron(C, 500, 1.1),
    // home essentials
    curtains: () => curtains(C, 500, 1.15, '#c0392b'),
    'bath-towels': () => towels(C, 520, 1.1),
    'bucket-bowl': () => bucketBowl(C, 480, 1.1),
    'extension-socket': () => socket(C, 500, 1.15),
    'led-bulbs': () => bulb(C, 500, 1.15),
    'door-mat': () => doorMat(C, 520, 1.1),
    rug: () => rug(C, 520, 1.1),
    'gas-cylinder': () => gasCylinder(C, 500, 1.15),
    cutlery: () => cutlery(C, 500, 1.15),
    'food-containers': () => containers(C, 500, 1.15),
    // office
    'office-desk': () => desk(C, 520, 1.1),
    'executive-chair': () => officeChair(C, 500, 1.1, '#3a2418', true),
    'office-chair': () => officeChair(C, 500, 1.1),
    'filing-cabinet': () => cabinet(C, 500, 1.15),
    printer: () => printer(C, 520, 1.15),
    router: () => router(C, 520, 1.1),
    'a4-paper': () => paperReam(C, 520, 1.15),
    'water-dispenser': () => waterDispenser(C, 500, 1.15),
    'visitor-chair': () => chair(C, 520, 1.15, '#26408f', false),
    // provisions
    'soft-drinks': () =>
      bottlesPack(C, 520, 1.15, ['#c0392b', '#f28c28', '#2f9e6b', '#6a2c91', '#c0392b']),
    'bottled-water': () =>
      bottlesPack(C, 520, 1.15, ['#fff', '#fff', '#fff', '#fff', '#fff'], '#26408f', true),
    juice: () => carton(C, 520, 1.2, 'JUICE', '#f28c28', '#2f9e6b'),
    'seasoning-cubes': () => carton(C, 520, 1.05, 'CUBES', '#f2c230', '#c0392b'),
    salt: () => sack(C, 520, 1.05, '#f4f6fa', 'SALT', '1 KG', '#26408f'),
    sugar: () => sack(C, 520, 1.05, '#f4f6fa', 'SUGAR', '1 KG', '#c0392b'),
    'milk-powder': () => tin(C, 500, 1.1, '#26408f', 'MILK', 'FULL CREAM'),
    'cocoa-beverage': () => tin(C, 500, 1.1, '#6b3d12', 'COCOA', 'MALT DRINK'),
    semolina: () => sack(C, 520, 1.05, '#f6efe0', 'SEMO', '1 KG', '#2f9e6b'),
    'noodles-carton': () => carton(C, 520, 1.2, 'NOODLES', '#d9963f', '#c0392b'),
    'vegetable-oil-1l': () =>
      bottle(C, 540, 1.05, {
        w: 220,
        h: 420,
        nw: 80,
        nh: 60,
        c: '#f6d24a',
        cap: '#2f9e6b',
        label: 'OIL',
        liquid: '#e9b218',
      }),
    // bakery
    'birthday-cake': () => cake(C, 500, 1.1),
    'wedding-cake': () => cake(C, 560, 1.05, 3, '#ffffff'),
    'sliced-bread': () => breadLoaf(C, 500, 1.1),
    'small-chops': () => bowlPile(C, 520, 1.25, { kind: 'beans', c: '#d9963f' }, '#c0392b'),
    cupcakes: () => cupcakes(C, 520, 1.15),
    'meat-pies': () => pastries(C, 520, 1.15),
    'chin-chin': () => jar(C, 520, 1.3, 'rgba(255,240,210,.95)', '#c0392b', 'CHIN CHIN', '#8a4b2a'),
    // meat and fish
    'chicken-kg': () => drumsticks(C, 500, 1.1),
    'beef-kg': () => meatSlab(C, 500, 1.1),
    'goat-meat-kg': () => meatSlab(C, 500, 1.1, '#9b3a2c', '#f6efe0'),
    'catfish-kg': () => fish(C, 500, 1.15, '#5f6b78'),
    'titus-fish': () => fish(C, 500, 1.15, '#7fa0c4'),
    stockfish: () => fish(C, 500, 1.1, '#c9b48a', true),
    ponmo: () => meatSlab(C, 500, 1.05, '#d9c3a0', '#f3e6cf'),
    'turkey-wings': () => drumsticks(C, 500, 1.1, '#a8642e'),
    // soup ingredients
    crayfish: () => pile('#e2532b'),
    ogbono: () => pile('#c8a46b', '#2b2f3a'),
    iru: () => pile('#4a3426', '#d6dbe4', true),
    okra: () => okra(C, 500, 1.15),
    'efo-spinach': () => leafBunch(C, 620, 1.35, '#2f7d33'),
    tatashe: () => bellPepper(360, 540, 1.25, '#d8302a') + bellPepper(640, 540, 1.25, '#e2532b'),
    uziza: () => leafBunch(C, 620, 1.35, '#1f5a2a'),
    'pepper-soup-spice': () => jar(C, 520, 1.3, '#6b3d12', '#c0392b', 'SPICE', '#6b3d12'),
    ogi: () => pile('#f7f4ec', '#26408f'),
    // party
    'disposable-plates': () => plates(C, 500, 1.2),
    balloons: () => balloons(C, 520, 1.1),
    souvenirs: () => giftBag(C, 500, 1.1),
    'food-warmers': () => flask(350, 560, 0.8, '#2f9e6b') + flask(650, 480, 0.8, '#c0392b'),
    'table-cloths': () => fabricStack(C, 520, 1.25),
    napkins: () => paperReam(C, 520, 1.15, '#fbd3e2', '#c2185b', 'NAPKINS'),
    'gift-hamper': () => hamper(C, 540, 1.1),
    'kids-party-packs': () =>
      giftBag(380, 520, 0.8, '#f2c230', '#26408f') + giftBag(640, 560, 0.8, '#2f9e6b', '#f6a5c0'),
    // school
    'school-uniform': () => shirt(C, 500, 1.3, '#6ec1ea', '#26408f'),
    'school-socks': () => socks(C, 520, 1.1),
    'lunch-box': () => flask(C, 520, 1.1, '#f2c230'),
    'school-shoes': () => sneaker(C, 520, 1.3, '#1d1f24', '#3a3d45'),
    'maths-set': () => mathsSet(C, 500, 1.15),
    'school-sandals': () => sandal(400, 500, 1.15, '#4a3426') + sandal(620, 520, 1.15, '#4a3426'),
    'water-bottle': () =>
      bottle(C, 540, 1.05, {
        w: 200,
        h: 440,
        nw: 90,
        nh: 50,
        c: '#6ec1ea',
        cap: '#26408f',
        label: 'SCHOOL',
        ls: 34,
        r: 60,
      }),
    // Abuja
    'abj-rice': () => sack(C, 520, 1.2, '#f1ead9', 'RICE', '50 KG · ABUJA', '#c0392b'),
    'abj-beans': () => bowlPile(C, 520, 1.25, { kind: 'beans', c: '#9b5f30' }),
    'abj-garri': () => bowlPile(C, 520, 1.25, { kind: 'grain', c: '#f4ecd8' }, '#2f9e6b'),
    'abj-yam': () => yam(500, 420, 1.2, 8) + yam(500, 600, 1.15, -6),
    'abj-tomatoes': () =>
      basket(C, 560, 560, 240, '#a06a33') +
      [
        [-150, 460],
        [0, 445],
        [150, 460],
        [-75, 370],
        [75, 370],
        [0, 300],
      ]
        .map(([dx, yy]) => tomato(C + dx, yy, 85))
        .join(''),
    'abj-onions': () =>
      onion(360, 560, 0.95) + onion(640, 560, 0.95) + onion(500, 440, 1.05, '#a24a7e'),
    'abj-palm-oil': () => jerrycan(C, 520, 1.25, '#c0392b', 'PALM OIL'),
    'abj-pepper': () =>
      pepperBonnet(360, 560, 1.5, '#e63323') +
      pepperBonnet(640, 560, 1.5, '#e63323') +
      pepperBonnet(500, 390, 1.5, '#f6a01a'),
    'abj-phone': () => phone(C, 500, 1.15, { s1: '#2f9e6b', s2: '#26408f', apps: true }),
    'abj-tablet': () => tablet(C, 500, 1.15),
    'abj-charger': () => charger(C, 500, 1.15),
    'abj-speaker': () => speaker(C, 520, 1.25, '#c0392b'),
    'abj-earbuds': () => earbuds(C, 520, 1.25),
    'abj-laptop': () => laptop(C, 480, 1.2),
    // Ibadan
    'ib-yam': () => yam(500, 440, 1.25, -4) + yam(470, 610, 1.1, 10),
    'ib-beans': () => bowlPile(C, 520, 1.25, { kind: 'beans', c: '#c48a4a' }, '#f2c230'),
    'ib-garri': () => bowlPile(C, 520, 1.25, { kind: 'grain', c: '#f2d06b' }),
    'ib-plantain': () => bananaBunch(C, 470, 1.75, true),
    'ib-elubo': () => bowlPile(C, 520, 1.25, { kind: 'grain', c: '#a8865f' }, '#3a3d45'),
    'ib-ofada': () => sack(C, 520, 1.15, '#e8d2b0', 'OFADA', 'LOCAL RICE', '#7a4a26'),
    'ib-iru': () => pile('#3d2a1d', '#f2c230', true),
    'ib-smoked-fish': () => fish(C, 500, 1.1, '#8a5a2b', true),
    // Port Harcourt
    'ph-fresh-fish': () => fish(C, 500, 1.15, '#c9c3b5'),
    'ph-periwinkle': () => pile('#2b2f3a', '#e9edf3', true),
    'ph-prawns': () => prawns(C, 500, 1.1),
    'ph-crayfish': () => pile('#d9532b', '#2b2f3a'),
    'ph-dried-fish': () => fish(C, 500, 1.1, '#a8642e', true),
    'ph-bitter-leaf': () => leafBunch(C, 620, 1.35, '#4f7d33'),
    'ph-ugu': () => leafBunch(C, 620, 1.35),
  };
}
