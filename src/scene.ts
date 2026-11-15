import { Pixels, RGB, BAYER4, clamp, hash, hsv, mix, mul, ramp, scale } from './pixels';
import type { SkyState } from './sky';

export const W = 384;
export const H = 108;
const HALF = W / 2;

// ---------------------------------------------------------------- lighting

const SKY_TOP: [number, RGB][] = [
  [-18, [7, 9, 26]], [-10, [13, 17, 50]], [-5, [32, 36, 92]], [-1, [56, 70, 142]],
  [3, [84, 122, 192]], [10, [70, 140, 222]], [30, [48, 122, 226]],
];
const SKY_HORIZON: [number, RGB][] = [
  [-18, [20, 22, 54]], [-10, [44, 38, 90]], [-5, [150, 80, 112]], [-1, [242, 128, 88]],
  [3, [252, 186, 120]], [10, [176, 216, 240]], [30, [152, 210, 250]],
];
const AMBIENT: [number, RGB][] = [
  [-12, [0.2, 0.24, 0.44]], [-4, [0.42, 0.38, 0.6]], [0, [0.86, 0.6, 0.56]],
  [5, [1, 0.86, 0.74]], [15, [1, 1, 1]],
];

interface Light {
  t: number; // seconds, for animation
  top: RGB;
  horizon: RGB;
  amb: RGB;
  night: number; // 0 = day, 1 = full night
  litChance: number; // share of windows lit
}

function lightFor(sky: SkyState, t: number): Light {
  const e = sky.elevation;
  return {
    t,
    top: ramp(SKY_TOP, e),
    horizon: ramp(SKY_HORIZON, e),
    amb: ramp(AMBIENT, e),
    night: clamp((-e - 2) / 8),
    litChance: clamp((4 - e) / 10) * 0.55,
  };
}

const WARM: RGB = [255, 212, 138];
const COOL: RGB = [206, 224, 255];

// ---------------------------------------------------------------- shared sky

function drawSky(p: Pixels, ox: number, horizonY: number, L: Light, sky: SkyState, seed: number) {
  const BANDS = 12;
  for (let y = 0; y < horizonY; y++) {
    const f = Math.pow(y / horizonY, 1.25) * BANDS;
    const k = Math.floor(f), frac = f - k;
    for (let x = ox; x < ox + HALF; x++) {
      const band = frac > BAYER4[(y & 3) * 4 + (x & 3)] ? k + 1 : k;
      p.set(x, y, mix(L.top, L.horizon, band / BANDS));
    }
  }

  // Stars
  if (L.night > 0) {
    for (let i = 0; i < 70; i++) {
      const x = ox + Math.floor(hash(i, seed) * HALF);
      const y = Math.floor(hash(seed, i, 7) * horizonY * 0.8);
      const tw = 0.55 + 0.45 * Math.sin(L.t * (1 + hash(i, 3)) * 2 + i);
      p.blend(x, y, [255, 250, 230], L.night * tw * (hash(i, seed, 2) > 0.85 ? 1 : 0.6));
    }
  }

  const arcX = (ha: number) => ox + HALF / 2 + (ha / sky.sunsetHourAngle) * HALF * 0.44;

  // Sun
  if (sky.elevation > -4) {
    const x = arcX(sky.hourAngle);
    const height = Math.sqrt(Math.max(0, sky.elevation) / Math.max(10, sky.noonElevation));
    const y = horizonY - 6 - 62 * height + Math.max(0, -sky.elevation) * 2;
    const low = clamp(1 - sky.elevation / 12);
    const core = mix([255, 250, 214], [255, 150, 70], low);
    p.disc(x, y, 9, core, 0.12);
    p.disc(x, y, 7, core, 0.18);
    p.disc(x, y, 4.5, core);
  }

  // Moon, with a real phase
  if (L.night > 0.15) {
    let mh = sky.hourAngle - sky.moonPhase * 360;
    mh = ((mh + 540) % 360) - 180;
    if (Math.abs(mh) < sky.sunsetHourAngle) {
      const cx = Math.round(arcX(mh)), cy = Math.round(12 + (Math.abs(mh) / sky.sunsetHourAngle) * 44);
      const r = 4.5, ph = sky.moonPhase, cosP = Math.cos(2 * Math.PI * ph);
      p.disc(cx, cy, 8, [200, 210, 255], 0.08 * L.night);
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          if (dx * dx + dy * dy > r * r + 1) continue;
          const w = Math.sqrt(Math.max(0, r * r - dy * dy));
          const lit = ph < 0.5 ? dx > w * cosP : dx < -w * cosP;
          const crater = hash(dx + 9, dy + 9, 5) > 0.8;
          p.blend(cx + dx, cy + dy, lit ? (crater ? [214, 214, 200] : [246, 242, 220]) : [52, 56, 88], L.night);
        }
    }
  }

  // Drifting clouds
  const cloudLit = mix(mul([255, 255, 255], L.amb), L.horizon, 0.35);
  const cloudShade = mix(cloudLit, L.top, 0.35);
  for (let i = 0; i < 3; i++) {
    const span = HALF + 60;
    const cx = ox - 30 + ((hash(i, seed, 11) * span + L.t * (0.6 + i * 0.25)) % span);
    const cy = 10 + i * 9 + hash(i, seed, 12) * 6;
    const blobs = [[0, 0, 5], [6, 1, 4], [-6, 2, 3.5], [11, 3, 2.5], [-11, 3, 2]];
    for (const [bx, by, r] of blobs) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r * 1.6; dx <= r * 1.6; dx++) {
          if ((dx / 1.6) ** 2 + dy * dy > r * r || cy + by + dy > cy + 3) continue;
          p.blend(cx + bx + dx, cy + by + dy, dy + by > 1 ? cloudShade : cloudLit, 0.9);
        }
    }
  }
}

function litWindow(L: Light, x: number, y: number, seed: number, dayGlass: RGB): RGB {
  const r = hash(x, y, seed);
  if (r < L.litChance) return hash(x >> 1, y, seed + 1) > 0.3 ? WARM : COOL;
  return mul(dayGlass, L.amb);
}

// ---------------------------------------------------------------- Cambridge

function drawCambridge(p: Pixels, sky: SkyState, t: number) {
  const L = lightFor(sky, t);
  const lit = (c: RGB) => mul(c, L.amb);
  p.clipX0 = 0;
  p.clipX1 = HALF;
  drawSky(p, 0, 86, L, sky, 1);

  // Distant trees along the Backs
  for (let x = 0; x < HALF; x++) {
    const top = Math.round(69 + 2.5 * Math.sin(x * 0.31) + 1.8 * Math.sin(x * 0.11 + 2) + Math.sin(x * 0.73));
    for (let y = top; y < 81; y++) p.set(x, y, lit(y === top ? [60, 104, 58] : [40, 78, 44]));
  }

  // Gibbs Building (classical, to the right of the chapel)
  const stone: RGB = [224, 210, 172], stoneHi: RGB = [238, 228, 196], stoneLo: RGB = [176, 160, 124];
  p.rect(158, 58, 33, 22, lit(stone));
  p.rect(158, 56, 33, 2, lit(stoneHi));
  for (let x = 158; x < 191; x += 3) p.set(x, 56, lit(stoneLo));
  for (let y = 74; y < 80; y += 2) p.rect(158, y, 33, 1, lit(stoneLo));
  for (let j = 0; j < 6; j++) p.rect(174 - j, 50 + j, 2 * j + 1, 1, lit(j === 5 ? stoneHi : stone));
  p.rect(172, 53, 5, 2, lit(stoneLo));
  for (const cx of [169, 172, 176, 179]) p.rect(cx, 58, 1, 16, lit(stoneHi));
  for (const wx of [160, 163, 166, 182, 185, 188])
    for (const wy of [61, 67]) p.rect(wx, wy, 2, 3, litWindow(L, wx, wy, 31, [70, 74, 88]));
  p.rect(173, 68, 3, 12, L.night > 0.3 ? WARM : lit([44, 40, 44]));
  p.set(174, 67, L.night > 0.3 ? WARM : lit([44, 40, 44]));

  // King's College Chapel
  const body0 = 74, body1 = 148, top = 42;
  p.rect(body0, 37, body1 - body0, 3, lit([118, 124, 132])); // lead roof
  p.rect(body0, top, body1 - body0, 80 - top, lit(stone));
  p.rect(body0, 40, body1 - body0, 2, lit(stoneHi));
  for (let x = body0; x < body1; x += 2) p.set(x, 39, lit(stoneHi)); // battlements
  p.rect(body0, 76, body1 - body0, 4, lit(stoneLo));

  const glass = [[255, 186, 86], [226, 88, 70], [92, 122, 222], [250, 222, 140], [120, 200, 160]] as RGB[];
  for (let k = 0; k < 8; k++) {
    const wx = 77 + 9 * k;
    for (let y = 46; y < 75; y++) {
      for (let i = 0; i < 5; i++) {
        if ((y === 46 && i !== 2) || (y === 47 && (i === 0 || i === 4))) continue;
        const frame = (i === 2 && y > 48) || y === 58 || y === 66;
        let c: RGB;
        if (frame) c = lit(stoneLo);
        else if (L.night > 0.05) {
          const g = glass[Math.floor(hash(wx + i, y, 4) * glass.length)];
          const flicker = 0.85 + 0.15 * Math.sin(t * 1.3 + hash(wx, y) * 6);
          c = mix(lit([58, 66, 84]), scale(g, flicker), L.night);
        } else c = lit(y < 52 ? [96, 108, 130] : [58, 66, 84]);
        p.set(wx + i, y, c);
      }
    }
  }
  for (let k = 0; k < 7; k++) {
    const bx = 83 + 9 * k;
    p.rect(bx, top, 1, 38, lit(stoneHi));
    p.rect(bx + 1, top, 1, 38, lit(stoneLo));
    p.rect(bx, 36, 2, 4, lit(stoneHi));
    p.rect(bx, 33, 1, 3, lit(stoneHi));
  }
  for (const tx of [68, 148]) {
    p.rect(tx, 22, 6, 58, lit(stone));
    p.rect(tx, 22, 2, 58, lit(stoneHi));
    p.rect(tx + 5, 22, 1, 58, lit(stoneLo));
    for (const by of [30, 41, 60]) p.rect(tx, by, 6, 1, lit(stoneLo));
    p.rect(tx + 2, 33, 2, 4, lit([60, 58, 64]));
    p.rect(tx + 2, 49, 2, 5, L.night > 0.3 ? WARM : lit([60, 58, 64]));
    p.rect(tx, 20, 6, 2, lit(stoneHi));
    p.set(tx + 1, 20, lit(stoneLo));
    p.set(tx + 4, 20, lit(stoneLo));
    p.rect(tx + 1, 17, 4, 3, lit(stone));
    p.rect(tx + 2, 15, 2, 2, lit(stoneHi));
    p.rect(tx + 2, 12, 1, 3, lit(stoneHi));
    p.rect(tx, 17, 1, 3, lit(stoneHi));
    p.rect(tx + 5, 17, 1, 3, lit(stoneLo));
  }

  // Weeping willow, swaying
  p.rect(24, 62, 4, 20, lit([84, 60, 40]));
  p.rect(24, 62, 1, 20, lit([110, 82, 56]));
  for (let x = 4; x < 50; x++) {
    const d = x - 27;
    const top = Math.round(50 + (d * d) / 38);
    const bottom = Math.round(80 - Math.abs(d) / 2.5 - hash(x, 9) * 4);
    const sway = Math.round(Math.sin(t * 0.9 + x * 0.18) * 0.9);
    const gap = hash(x, 3) > 0.7;
    for (let y = top; y < bottom; y++) {
      if (gap && y > top + 7) continue;
      const g: RGB = (x + y * 2) % 5 === 0 ? [140, 176, 74] : (x + y) % 3 === 0 ? [74, 122, 48] : [100, 150, 60];
      p.set(x + (y > top + 6 ? sway : 0), y, lit(g));
    }
  }

  // Lawn with mowing stripes
  for (let x = 0; x < HALF; x++)
    for (let y = 80; y < 86; y++)
      p.set(x, y, lit(y === 80 ? [58, 96, 46] : Math.floor((x + y) / 6) % 2 ? [94, 152, 70] : [80, 136, 62]));

  // River Cam: wobbling reflection of everything above it
  const waterY = 86;
  const water = mix(L.horizon, [30, 60, 72], 0.55);
  for (let y = waterY; y < H; y++) {
    const depth = y - waterY;
    const wob = Math.round(Math.sin(y * 0.9 + t * 2.2) * (0.5 + depth / 10));
    for (let x = 0; x < HALF; x++) {
      const src = p.get(x + wob, waterY - depth - 1);
      let c = mix(scale(src, 0.82), water, 0.42 + depth * 0.012);
      if (hash(x, y, Math.floor(t * 3)) < 0.012) c = mix(c, [255, 255, 255], 0.35);
      p.set(x, y, c);
    }
  }
  p.rect(0, waterY, HALF, 1, lit([46, 74, 40]));

  // A punt drifting along
  const px = Math.round(((t / 80) % 1) * (HALF + 50) - 30);
  const wood = lit([100, 64, 38]), woodHi = lit([150, 104, 64]);
  p.rect(px, 98, 20, 2, wood);
  p.rect(px, 97, 20, 1, woodHi);
  const shirts = [[230, 80, 80], [80, 130, 220], [240, 200, 80]] as RGB[];
  shirts.forEach((s, i) => {
    p.rect(px + 7 + i * 4, 95, 2, 2, lit(s));
    p.set(px + 7 + i * 4, 94, lit([236, 190, 150]));
  });
  // punter on the till, with straw boater
  p.rect(px + 1, 93, 2, 4, lit([40, 40, 60]));
  p.rect(px + 1, 89, 2, 4, lit([246, 246, 240]));
  p.rect(px + 1, 87, 2, 2, lit([236, 190, 150]));
  p.rect(px, 86, 4, 1, lit([230, 200, 110]));
  const push = Math.sin(t * 0.8) * 3;
  p.line(px + 3 + push * 0.3, 84, px - 3 + push, 105, lit([150, 110, 70]));
  if (L.night > 0.2) {
    p.disc(px + 19, 95, 3, WARM, 0.25 * L.night);
    p.set(px + 19, 95, WARM);
  }
}

// ---------------------------------------------------------------- Dallas

function tower(
  p: Pixels, L: Light, x: number, w: number, top: number, color: RGB, seed: number, bottom = 90,
) {
  for (let i = 0; i < w; i++) {
    const edge = i === w - 1 ? 0.7 : i === 0 ? 1.12 : 1;
    for (let y = top; y < bottom; y++) {
      const isWin = (y - top) % 3 === 1 && i % 2 === 1 && i < w - 1;
      const c = isWin ? litWindow(L, x + i, y, seed, scale(color, 0.62)) : mul(scale(color, edge), L.amb);
      p.set(x + i, y, c);
    }
  }
}

function drawDallas(p: Pixels, sky: SkyState, t: number) {
  const L = lightFor(sky, t);
  const lit = (c: RGB) => mul(c, L.amb);
  const ox = HALF;
  p.clipX0 = HALF;
  p.clipX1 = W;
  drawSky(p, ox, 90, L, sky, 2);

  // Hazy background towers
  const haze = (c: RGB) => mix(lit(c), L.horizon, 0.45);
  const back: [number, number, number][] = [
    [0, 10, 62], [8, 12, 56], [28, 9, 58], [34, 8, 50], [56, 8, 46], [76, 8, 52],
    [98, 6, 54], [116, 8, 48], [134, 10, 60], [146, 12, 66], [160, 10, 70], [176, 16, 64],
  ];
  back.forEach(([bx, bw, bt], i) => {
    for (let y = bt; y < 90; y++)
      for (let x = 0; x < bw; x++) {
        const win = (y - bt) % 3 === 1 && x % 2 === 1 && hash(ox + bx + x, y, 40 + i) < L.litChance * 0.7;
        p.set(ox + bx + x, y, win ? mix(WARM, L.horizon, 0.35) : haze([96, 104, 120]));
      }
  });

  // Mid-height filler towers
  tower(p, L, ox + 27, 8, 54, [132, 138, 150], 50);
  tower(p, L, ox + 137, 11, 44, [118, 132, 150], 51);
  tower(p, L, ox + 112, 9, 50, [150, 140, 126], 52);

  // Hyatt Regency (gold glass)
  for (let y = 66; y < 90; y++)
    for (let x = 2; x < 18; x++) {
      if (x > 14 && y < 70) continue;
      const band = (y % 2 === 0 ? 1 : 0.86) * (x > 14 ? 0.78 : 1);
      const c = L.night > 0.3 && hash(x, y, 60) < L.litChance ? WARM : lit(scale([200, 170, 104], band));
      p.set(ox + x, y, c);
    }

  // Reunion Tower: concrete shaft + geodesic ball with LED show at night
  const rx = ox + 24;
  const shaft = [[1.08, 0], [1.18, 0], [1, 0], [0.82, 0], [0.7, 0]];
  shaft.forEach(([k], i) => p.rect(rx - 2 + i, 40, 1, 50, lit(scale([188, 184, 174], k))));
  p.rect(rx - 3, 39, 7, 2, lit([170, 168, 160]));
  p.rect(rx, 20, 1, 5, lit([200, 200, 200]));
  for (let dy = -8; dy <= 8; dy++)
    for (let dx = -8; dx <= 8; dx++) {
      if (dx * dx + dy * dy > 70) continue;
      const lattice = (dx + dy + 100) % 3 === 0 || (dx - dy + 100) % 3 === 0;
      const shadeK = 1.15 - (dx + 8) / 22;
      let c: RGB = lit(scale(lattice ? [128, 132, 142] : [176, 180, 190], shadeK));
      if (L.night > 0.1 && (dx & 1) === 0 && (dy & 1) === 0) {
        const led = hsv((dx * 14 + dy * 9 + t * 50) % 360, 0.55, 1);
        c = mix(c, led, L.night);
      }
      p.set(rx + dx, 32 + dy, c);
    }

  // Fountain Place: faceted teal prism
  const fx = ox + 38;
  for (let i = 0; i < 19; i++) {
    const top = i < 3 ? 26 + (2 - i) * 2 : Math.round(26 + (i - 2) * 1.2);
    const face: RGB = i < 9 ? [96, 172, 160] : [58, 120, 122];
    for (let y = top; y < 90; y++) {
      let c = mul((y - top) % 3 === 0 ? scale(face, 0.85) : face, L.amb);
      if ((i + y) % 13 === 0) c = mix(c, lit([220, 250, 246]), 0.5);
      if (L.night > 0.2) {
        c = mix(c, [16, 40, 46], L.night * 0.8);
        if (y === top) c = mix(c, [120, 230, 255], L.night);
        else if ((y - top) % 3 === 1 && hash(fx + i, y, 70) < L.litChance * 0.6) c = COOL;
      }
      p.set(fx + i, y, c);
    }
  }

  // Bank of America Plaza: tallest, outlined in green argon at night
  const bx = ox + 61, bw = 17, bt = 10;
  tower(p, L, bx, bw, bt + 6, [92, 112, 104], 80);
  for (let i = 2; i < bw - 2; i++) for (let y = bt; y < bt + 6; y++) p.set(bx + i, y, lit([100, 122, 112]));
  for (let x = bx + 3; x < bx + bw - 3; x += 3) p.rect(x, bt + 6, 1, 84 - bt, lit([124, 146, 136]));
  if (L.night > 0.05) {
    const g: RGB = [80, 255, 120], a = L.night;
    for (let y = bt + 6; y < 90; y++) {
      p.blend(bx, y, g, a);
      p.blend(bx + bw - 1, y, g, a);
    }
    for (let y = bt; y < bt + 6; y++) {
      p.blend(bx + 2, y, g, a);
      p.blend(bx + bw - 3, y, g, a);
    }
    for (let i = 0; i < bw; i++) p.blend(bx + i, bt + 6, g, a);
    for (let i = 2; i < bw - 2; i++) p.blend(bx + i, bt, g, a);
  }

  // Renaissance Tower: twin spires and the X crown
  const nx = ox + 83;
  tower(p, L, nx, 15, 24, [142, 162, 188], 90);
  p.rect(nx + 3, 14, 1, 10, lit([210, 214, 220]));
  p.rect(nx + 11, 14, 1, 10, lit([210, 214, 220]));
  const xc: RGB = L.night > 0.2 ? [255, 255, 255] : lit([196, 210, 228]);
  p.line(nx, 24, nx + 14, 34, xc);
  p.line(nx + 14, 24, nx, 34, xc);

  // Comerica Bank Tower: gabled crown
  const cx = ox + 101;
  tower(p, L, cx, 15, 34, [172, 160, 138], 100);
  for (let j = 0; j < 7; j++) {
    const c = L.night > 0.3 ? mix(lit([172, 160, 138]), [255, 238, 196], L.night) : lit([190, 178, 154]);
    p.rect(cx + 7 - j, 28 + j, 2 * j + 1, 1, c);
  }

  // Magnolia Building + the red Pegasus
  const mx = ox + 122;
  tower(p, L, mx, 10, 58, [180, 140, 104], 110);
  for (let j = 0; j < 8; j++) {
    const half = 1 + Math.floor(j / 3);
    p.set(mx + 5 - half, 50 + j, lit([150, 150, 150]));
    p.set(mx + 4 + half, 50 + j, lit([150, 150, 150]));
    if (j % 2) p.rect(mx + 5 - half, 50 + j, half * 2, 1, lit([130, 130, 130]));
  }
  const red: RGB = L.night > 0.2 ? [255, 50, 50] : lit([212, 36, 36]);
  if (L.night > 0.2) p.disc(mx + 5, 46, 6, [255, 40, 40], 0.18 * L.night);
  p.sprite(mx, 42, [
    '..RR.......',
    '...RRR...RR',
    '....RRR.RRR',
    '.RRRRRRRRR.',
    'R.RRRRRRR..',
    '..R.R.R.R..',
  ], { R: red });

  // Trees along the Trinity levee
  for (let x = ox; x < W; x++) {
    const top = Math.round(87 + Math.sin(x * 0.5) + Math.sin(x * 0.21));
    for (let y = top; y < 93; y++) p.set(x, y, lit(y === top ? [64, 104, 56] : [44, 80, 46]));
  }

  // Margaret Hunt Hill Bridge
  const bcx = ox + 164, span = 26;
  const archY = (x: number) => 91 - 30 * (1 - ((x - bcx) / span) ** 2);
  const archC: RGB = L.night > 0.2 ? mix(lit([236, 236, 230]), [245, 248, 255], L.night) : lit([236, 236, 230]);
  for (let k = -12; k <= 12; k++) {
    const ax = bcx + k * 2;
    p.line(ax, archY(ax) + 1, bcx + k * 3.3, 91, lit([200, 200, 200]), 0.45);
  }
  for (let x = bcx - span; x <= bcx + span; x++) {
    p.set(x, archY(x), archC);
    p.set(x, archY(x) + 1, archC);
  }
  p.rect(ox + 126, 91, 66, 2, lit([214, 214, 208]));
  p.rect(ox + 126, 93, 66, 1, lit([120, 120, 116]));

  // Grass, highway with traffic, and the Trinity River
  p.rect(ox, 93, HALF, 2, lit([82, 128, 64]));
  p.rect(ox, 95, HALF, 4, lit([62, 62, 68]));
  for (let x = ox; x < W; x += 6) p.rect(x, 97, 3, 1, lit([200, 190, 120]));
  p.rect(ox, 99, HALF, 2, lit([82, 128, 64]));
  const river = mix(L.horizon, [40, 78, 90], 0.5);
  for (let y = 101; y < 105; y++)
    for (let x = ox; x < W; x++)
      p.set(x, y, hash(x, y, Math.floor(t * 3)) < 0.03 ? mix(river, [255, 255, 255], 0.3) : river);
  for (let y = 105; y < H; y++)
    for (let x = ox; x < W; x++) p.set(x, y, lit((x + y) % 7 === 0 ? [92, 138, 70] : [76, 120, 58]));

  const paints = [[220, 60, 60], [240, 240, 240], [60, 100, 200], [30, 30, 36], [200, 180, 60]] as RGB[];
  for (let lane = 0; lane < 2; lane++) {
    for (let i = 0; i < 6; i++) {
      const speed = lane ? -9 : 11;
      const span2 = HALF + 10;
      const off = (hash(i, lane, 91) * span2 + t * speed) % span2;
      const x = Math.round(ox - 5 + (off < 0 ? off + span2 : off));
      const y = lane ? 97 : 95;
      const body = paints[Math.floor(hash(i, lane, 92) * paints.length)];
      p.rect(x, y + 1, 4, 1, L.night > 0.4 ? [40, 40, 48] : lit(body));
      p.rect(x + 1, y, 2, 1, L.night > 0.4 ? [30, 30, 36] : lit(scale(body, 0.8)));
      if (L.night > 0.2) {
        const front = lane ? x : x + 3, back = lane ? x + 3 : x;
        p.set(front, y + 1, [255, 250, 200]);
        p.set(back, y + 1, [255, 40, 40]);
      }
    }
  }
}

// ---------------------------------------------------------------- frame

const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

export function render(p: Pixels, cambridge: SkyState, dallas: SkyState, t: number) {
  drawCambridge(p, cambridge, t);
  drawDallas(p, dallas, t);

  p.clipX0 = 0;
  p.clipX1 = W;
  p.rect(HALF - 1, 0, 2, H, [18, 12, 30]);
  const beat = (Math.sin(t * 3) + 1) / 2;
  p.sprite(HALF - 4, 3, HEART, { X: [40, 10, 24] });
  p.sprite(HALF - 3, 2, HEART, { X: mix([240, 70, 110], [255, 150, 180], beat) });
  p.set(HALF - 2, 3, [255, 220, 230]);
}
