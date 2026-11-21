import { Pixels, RGB, BAYER4, clamp, hash, hsv, lerp, mix, mul, ramp, scale } from './pixels';
import type { SkyState } from './sky';
import type { Season } from './season';

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
  sunX: number;
  sunY: number;
  sunCol: RGB;
  golden: number; // 1 around sunrise/sunset
  morning: boolean;
}

function lightFor(sky: SkyState, t: number, ox: number, horizonY: number): Light {
  const e = sky.elevation;
  const height = Math.sqrt(Math.max(0, e) / Math.max(10, sky.noonElevation));
  return {
    t,
    top: ramp(SKY_TOP, e),
    horizon: ramp(SKY_HORIZON, e),
    amb: ramp(AMBIENT, e),
    night: clamp((-e - 2) / 8),
    litChance: clamp((4 - e) / 10) * 0.55,
    sunX: ox + HALF / 2 + (sky.hourAngle / sky.sunsetHourAngle) * HALF * 0.44,
    sunY: horizonY - 6 - 62 * height + Math.max(0, -e) * 2,
    sunCol: mix([255, 250, 214], [255, 150, 70], clamp(1 - e / 12)),
    golden: clamp(1 - Math.abs(e - 1) / 9),
    morning: sky.hourAngle < 0,
  };
}

const WARM: RGB = [255, 212, 138];
const COOL: RGB = [206, 224, 255];
const WHITE: RGB = [255, 255, 255];

/** Subtle per-pixel variation so flat surfaces read as stone or concrete. */
const tex = (c: RGB, x: number, y: number, amt = 0.07): RGB => scale(c, 1 + (hash(x, y, 77) - 0.5) * amt);

// ---------------------------------------------------------------- shared sky

function drawCloud(p: Pixels, cx: number, base: number, size: number, seed: number, hi: RGB, mid: RGB, lo: RGB, a: number) {
  const n = 4 + Math.floor(hash(seed, 1, 50) * 4);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = i - (n - 1) / 2;
    const r = size * (0.65 + hash(seed, i, 51) * 0.55) * (1 - (Math.abs(u) / n) * 1.1);
    blobs.push([u * size * 0.95 + (hash(seed, i, 52) - 0.5) * size * 0.5, -r * 0.45, r]);
  }
  const inside = (x: number, y: number) =>
    y <= 0 && blobs.some(([bx, by, r]) => ((x - bx) / 1.5) ** 2 + (y - by) ** 2 <= r * r);
  const x0 = Math.floor(cx), ext = Math.ceil(n * size);
  for (let y = -Math.ceil(size * 2); y <= 0; y++)
    for (let x = -ext; x <= ext; x++) {
      if (!inside(x, y)) continue;
      const c = !inside(x, y - 1) || !inside(x - 1, y - 1) ? hi : y >= -1 || !inside(x, y + 2) ? lo : mid;
      p.blend(x0 + x, base + y, c, a);
    }
}

function drawSky(p: Pixels, ox: number, horizonY: number, L: Light, sky: SkyState, seed: number) {
  const BANDS = 18;
  const dayHalo = clamp(sky.elevation / 6) * 0.3;
  for (let y = 0; y < horizonY; y++) {
    const f = Math.pow(y / horizonY, 1.25) * BANDS;
    const k = Math.floor(f), frac = f - k;
    for (let x = ox; x < ox + HALF; x++) {
      const b = BAYER4[(y & 3) * 4 + (x & 3)];
      let c = mix(L.top, L.horizon, (frac > b ? k + 1 : k) / BANDS);
      // Dithered glow spreading out from the sun
      const d = Math.hypot(x - L.sunX, (y - L.sunY) * 1.7);
      const g = Math.max(clamp(1 - d / 90) ** 2 * L.golden * 0.75, clamp(1 - d / 24) ** 2 * dayHalo) * 8;
      const gq = (Math.floor(g) + (g % 1 > b ? 1 : 0)) / 8;
      if (gq > 0) c = mix(c, L.sunCol, gq);
      p.set(x, y, c);
    }
  }

  // Stars, a few of them big enough to sparkle
  if (L.night > 0) {
    for (let i = 0; i < 95; i++) {
      const x = ox + Math.floor(hash(i, seed) * HALF);
      const y = Math.floor(hash(seed, i, 7) * horizonY * 0.82);
      const tw = 0.55 + 0.45 * Math.sin(L.t * (1 + hash(i, 3)) * 2 + i);
      const tint = hash(i, seed, 5);
      const c: RGB = tint < 0.2 ? [190, 210, 255] : tint < 0.35 ? [255, 214, 170] : [255, 250, 230];
      const big = hash(i, seed, 2) > 0.9;
      p.blend(x, y, c, L.night * tw * (big ? 1 : 0.6));
      if (big && tw > 0.7) {
        const a = L.night * (tw - 0.7) * 1.6;
        p.blend(x - 1, y, c, a); p.blend(x + 1, y, c, a); p.blend(x, y - 1, c, a); p.blend(x, y + 1, c, a);
      }
    }
    // Shooting star every so often
    const period = 19 + seed * 7, n = Math.floor(L.t / period), ph = (L.t / period - n) * period;
    if (ph < 0.7) {
      const sx = ox + 30 + hash(n, seed, 60) * (HALF - 70), sy = 6 + hash(n, seed, 61) * 20;
      for (let k = 0; k < 9; k++) {
        const q = ph * 46 - k;
        if (q > 0) p.blend(sx + q, sy + q * 0.45, [255, 255, 240], L.night * (1 - k / 9) * (1 - ph / 0.7));
      }
    }
  }

  // Sun
  if (sky.elevation > -4) {
    p.glow(L.sunX, L.sunY, 13, L.sunCol, 0.3);
    p.disc(L.sunX, L.sunY, 4.5, L.sunCol);
    p.disc(L.sunX - 1, L.sunY - 1, 2.5, mix(L.sunCol, WHITE, 0.5));
  }

  // Moon, with a real phase
  if (L.night > 0.15) {
    let mh = sky.hourAngle - sky.moonPhase * 360;
    mh = ((mh + 540) % 360) - 180;
    if (Math.abs(mh) < sky.sunsetHourAngle) {
      const cx = Math.round(ox + HALF / 2 + (mh / sky.sunsetHourAngle) * HALF * 0.44);
      const cy = Math.round(12 + (Math.abs(mh) / sky.sunsetHourAngle) * 44);
      const r = 4.5, ph = sky.moonPhase, cosP = Math.cos(2 * Math.PI * ph);
      p.glow(cx, cy, 14, [120, 140, 230], 0.3 * L.night * (1 - Math.abs(cosP + 1) / 2 + 0.3));
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

  // Two layers of drifting clouds, rim-lit by the sun
  const body = mix(mul(WHITE, L.amb), L.horizon, 0.3);
  const hi = mix(body, mix(WHITE, L.sunCol, L.golden), 0.65 * (1 - L.night));
  const lo = mix(mix(body, L.top, 0.4), [255, 120, 110], L.golden * 0.3);
  for (let i = 0; i < 6; i++) {
    const far = i >= 3;
    const span = HALF + 90;
    const cx = ox - 45 + ((hash(i, seed, 11) * span + L.t * (far ? 0.25 : 0.55 + i * 0.2)) % span);
    const cy = far ? 44 + (i - 3) * 7 + hash(i, seed, 12) * 4 : 12 + i * 9 + hash(i, seed, 12) * 6;
    const fade = far ? 0.45 : 0.92;
    drawCloud(p, cx, Math.round(cy), far ? 2.6 : 3.6 + hash(i, seed, 13) * 2, seed * 10 + i,
      far ? mix(hi, L.horizon, 0.4) : hi, far ? mix(body, L.horizon, 0.4) : body, far ? mix(lo, L.horizon, 0.4) : lo, fade);
  }

  // A flock of birds by day
  if (L.night < 0.25) {
    const period = 55 + seed * 13, ph = (L.t % period) / 30;
    if (ph < 1) {
      const n = Math.floor(L.t / period);
      const dir = hash(n, seed, 70) < 0.5 ? 1 : -1;
      const bx = ox + (dir > 0 ? ph : 1 - ph) * (HALF + 40) - 20;
      const by = 26 + hash(n, seed, 71) * 16 + Math.sin(L.t * 0.4) * 2;
      const ink = mix(L.top, [20, 20, 30], 0.75);
      for (let i = 0; i < 6; i++) {
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        const x = Math.round(bx - dir * row * 4), y = Math.round(by + side * row * 2);
        const up = Math.sin(L.t * 7 + i * 1.3) > 0 ? -1 : 1;
        p.set(x, y, ink); p.set(x - 1, y + up, ink); p.set(x + 1, y + up, ink);
      }
    }
  }
}

function litWindow(L: Light, x: number, y: number, seed: number, dayGlass: RGB): RGB {
  // Each window re-rolls on its own schedule, so lights blink on and off through the evening.
  const slot = Math.floor(L.t / 40 + hash(x, y, seed + 7) * 40);
  if (hash(x + y * 512, slot, seed) < L.litChance) return hash(x >> 1, y, seed + 1) > 0.3 ? WARM : COOL;
  return mul(dayGlass, L.amb);
}

// ---------------------------------------------------------------- seasons

/** Canopy pixel for deciduous trees: leafy, thinning, or bare twigs depending on the season. */
function foliage(S: Season, x: number, y: number, edge: boolean): RGB | null {
  if (hash(x, y, 300) < S.leafDensity) return edge ? mix(S.leaf, [255, 250, 200], 0.18) : S.leaf;
  return hash(x, y, 301) < 0.55 ? (edge ? [126, 110, 92] : [88, 74, 62]) : null;
}

/** A round-crowned tree with a visible trunk and branches; the crown thins out with the season. */
function drawTree(p: Pixels, L: Light, S: Season, cx: number, base: number, r: number, seed: number, dim = 1) {
  const lit = (c: RGB) => mul(scale(c, dim), L.amb);
  const bark = lit([72, 56, 44]);
  const fork = base - r, cy = fork - Math.round(r * 0.55);
  p.rect(cx, fork, r > 5 ? 2 : 1, r, bark);
  for (let i = -2; i <= 2; i++) {
    const ang = -Math.PI / 2 + i * 0.52;
    p.line(cx, fork, cx + Math.cos(ang) * r * 0.85, cy + r * 0.35 + Math.sin(ang) * r * 0.9, bark);
  }
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const x = cx + dx, y = cy + dy;
      const d = (dx / (r + 1)) ** 2 + (dy / (r * 0.9)) ** 2;
      if (d > 0.72 + hash(x, y, seed) * 0.4) continue;
      if (hash(x, y, 300) >= S.leafDensity) {
        if (hash(x, y, 301) < 0.22) p.set(x, y, lit([96, 80, 66])); // twigs
        continue;
      }
      let k = 0.74 + 0.34 * clamp((-dx * 0.6 - dy) / r * 0.5 + 0.5);
      if (hash(x >> 1, y >> 1, seed + 5) < 0.3) k *= 0.84; // leaf clumps
      let c = scale(S.leaf, k);
      if (S.snowing && dy < -r * 0.3 && hash(x, y, seed + 6) < 0.6) c = [236, 240, 248];
      p.set(x, y, lit(c));
    }
}

/** Falling leaves, snow, and summer fireflies, drawn over everything in one city's half. */
function drawWeather(p: Pixels, ox: number, groundY: number, S: Season, L: Light) {
  const t = L.t;
  if (S.snowing) {
    for (let i = 0; i < 110; i++) {
      const near = i % 3 === 0;
      const speed = (near ? 9 : 4) + hash(i, ox, 1) * 4;
      const y = (hash(i, ox, 2) * H + t * speed) % H;
      const x = ox + ((hash(i, ox, 3) * HALF + Math.sin(t * 0.7 + i) * 3 + t * 1.5) % HALF);
      p.blend(x, y, [250, 252, 255], near ? 0.95 : 0.55);
      if (near) p.blend(x, y + 1, [250, 252, 255], 0.5);
    }
  }
  if (S.fallingLeaves) {
    for (let i = 0; i < 18; i++) {
      const speed = 3 + hash(i, ox, 5) * 3;
      const y = 40 + ((hash(i, ox, 6) * 60 + t * speed) % (groundY - 40));
      const x = ox + ((hash(i, ox, 7) * HALF + t * 4 + Math.sin(t * 1.6 + i) * 4) % HALF);
      const c: RGB = ([[214, 128, 48], [200, 170, 60], [170, 84, 44]] as RGB[])[i % 3];
      p.set(x, y, mul(c, L.amb));
      if (Math.sin(t * 3 + i) > 0.3) p.set(x + 1, y, mul(scale(c, 0.8), L.amb)); // tumbling
    }
  }
  if (S.fireflies && L.night > 0.3) {
    for (let i = 0; i < 24; i++) {
      const glow = Math.sin(t * (1.5 + hash(i, 8)) + i * 2);
      if (glow < 0.3) continue;
      const x = ox + hash(i, ox, 9) * HALF + Math.sin(t * 0.5 + i) * 3;
      const y = groundY - 6 + hash(i, ox, 10) * 20 + Math.cos(t * 0.4 + i) * 2;
      p.glow(x, y, 2, [200, 255, 90], 0.3 * glow * L.night);
      p.blend(x, y, [230, 255, 120], glow * L.night);
    }
  }
}

/** Low mist that hangs over the water around sunrise. */
function drawMist(p: Pixels, ox: number, y0: number, y1: number, L: Light, sky: SkyState, strength: number) {
  const s = L.morning ? clamp(1 - Math.abs(sky.elevation - 2) / 9) * strength : 0;
  if (s <= 0.02) return;
  const col = mix(mul(WHITE, L.amb), L.horizon, 0.35);
  const mid = (y0 + y1) / 2, half = (y1 - y0) / 2;
  for (let y = y0; y < y1; y++)
    for (let x = ox; x < ox + HALF; x++) {
      const n = Math.sin((x + L.t * 2) * 0.07 + y * 0.9) + Math.sin((x - L.t * 1.3) * 0.031 + y * 1.7);
      const a = clamp(n * 0.4 + 0.45) * s * (1 - Math.abs(y - mid) / half);
      p.blend(x, y, col, Math.round(a * 5) / 5 * 0.75); // soft stepped bands
    }
}

function drawFireworks(p: Pixels, ox: number, L: Light) {
  if (L.night < 0.5) return;
  for (let s = 0; s < 3; s++) {
    const period = 2.7 + s * 0.8, n = Math.floor(L.t / period), ph = L.t / period - n;
    const bx = Math.round(ox + 40 + hash(n, s, 400) * (HALF - 80)), by = 16 + hash(n, s, 401) * 22;
    const hue = hash(n, s, 402) * 360;
    if (ph < 0.25) {
      const y = lerp(80, by, ph / 0.25);
      p.set(bx, y, WARM);
      p.blend(bx, y + 1, WARM, 0.5);
      p.blend(bx, y + 2, WARM, 0.25);
      continue;
    }
    const q = (ph - 0.25) / 0.75, fade = (1 - q) ** 0.7;
    const R = 15 * (1 - (1 - q) ** 2) * (0.7 + hash(n, s, 403) * 0.5);
    if (q < 0.2) p.glow(bx, by, 12, hsv(hue, 0.3, 1), 0.45 * (1 - q / 0.2));
    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * Math.PI * 2 + hash(n, s, 404);
      const rr = R * (0.55 + 0.45 * hash(i, n, s));
      const c = hsv((hue + (i % 2) * 40) % 360, 0.65, 1);
      for (let tail = 0; tail < 3; tail++) {
        const r2 = rr * (1 - tail * 0.13);
        p.add(bx + Math.cos(ang) * r2, by + Math.sin(ang) * r2 * 0.9 + q * q * 6, c, fade * (1 - tail * 0.35));
      }
    }
  }
}

// ---------------------------------------------------------------- Christmas

const BULBS: RGB[] = [[255, 70, 60], [255, 210, 90], [80, 220, 120], [90, 150, 255]];

/** A string of fairy lights hanging between two points; the bulbs twinkle after dark. */
function fairyLights(p: Pixels, L: Light, x0: number, y0: number, x1: number, y1: number, sag: number, seed: number) {
  const n = Math.max(2, Math.round(Math.abs(x1 - x0)));
  const wire = mul([40, 44, 40], L.amb);
  for (let k = 0; k <= n; k++) {
    const u = k / n, x = lerp(x0, x1, u), y = lerp(y0, y1, u) + sag * 4 * u * (1 - u);
    if (k % 3 !== 1) { p.blend(x, y, wire, 0.6); continue; }
    const c = BULBS[(Math.floor(k / 3) + seed) % BULBS.length];
    const on = Math.sin(L.t * 1.8 + k * 1.3 + seed) > -0.4;
    if (L.night > 0.1 && on) {
      p.set(x, y, c);
      p.glow(x, y, 2, c, 0.35 * L.night);
    } else p.set(x, y, mul(scale(c, 0.6), L.amb));
  }
}

/** Santa and three reindeer cross the whole banner every forty seconds, day or night. */
function drawSanta(p: Pixels, L: Light) {
  const period = 40, ph = (L.t % period) / 26;
  if (ph >= 1) return;
  const sx = Math.round(-50 + ph * (W + 90)), sy = Math.round(30 + Math.sin(ph * 9) * 4);
  // after dark they're moonlit, so lighter than a silhouette
  const k = (c: RGB): RGB => mix(mul(c, L.amb), c, 0.55 * L.night);
  for (let i = 1; i < 14; i++) p.blend(sx - i, sy + 2 + Math.round(Math.sin(i * 0.8 + L.t * 3)), [255, 230, 150], 0.5 * (1 - i / 14) * (Math.sin(i * 2.7 + L.t * 9) > 0 ? 1 : 0.3)); // sparkle trail
  const red = k([200, 30, 36]), gold = k([230, 190, 80]), brown = k([120, 80, 50]);
  p.rect(sx, sy - 2, 7, 3, red); // sleigh
  p.rect(sx, sy - 4, 2, 2, red);
  p.rect(sx - 1, sy + 2, 9, 1, gold); // runner
  p.set(sx + 8, sy + 1, gold);
  p.rect(sx, sy - 2, 7, 1, gold);
  p.rect(sx + 1, sy - 5, 2, 2, brown); // sack
  p.rect(sx + 3, sy - 4, 2, 2, red); // Santa
  p.set(sx + 4, sy - 5, k([236, 190, 150]));
  p.set(sx + 4, sy - 4, k([250, 250, 250])); // beard
  p.rect(sx + 3, sy - 6, 2, 1, red);
  p.set(sx + 2, sy - 6, k([250, 250, 250]));
  p.line(sx + 6, sy - 3, sx + 28, sy - 4, gold, 0.6); // reins
  for (let i = 0; i < 3; i++) {
    const rx = sx + 12 + i * 7, ry = sy - 3 + Math.round(Math.sin(L.t * 6 + i) * 0.6);
    const gallop = Math.sin(L.t * 8 + i * 1.5) > 0 ? 1 : 0;
    p.rect(rx, ry, 4, 2, brown);
    p.set(rx + 4, ry - 1, brown); p.set(rx + 5, ry - 1, brown); // head
    p.set(rx + 4, ry - 2, k([180, 150, 110])); p.set(rx + 3, ry - 3, k([180, 150, 110])); p.set(rx + 5, ry - 3, k([180, 150, 110])); // antlers
    p.set(rx + gallop, ry + 2, brown); p.set(rx + 3 - gallop, ry + 2, brown); // legs
    if (i === 2) { p.set(rx + 6, ry - 1, [255, 60, 50]); p.glow(rx + 6, ry - 1, 3, [255, 40, 40], 0.2 + 0.4 * L.night); } // Rudolph
  }
}

function lamp(p: Pixels, L: Light, x: number, base: number, h: number) {
  const iron = mul([36, 38, 46], L.amb);
  p.rect(x, base - h, 1, h, iron);
  p.rect(x - 1, base - h - 3, 3, 1, iron);
  p.rect(x - 1, base - h - 2, 3, 2, L.night > 0.15 ? WARM : mul([200, 204, 196], L.amb));
  if (L.night > 0.15) {
    p.glow(x, base - h - 1, 9, [255, 190, 110], 0.4 * L.night);
    p.glow(x, base + 1, 6, [255, 190, 110], 0.18 * L.night);
  }
}

function drawWillow(p: Pixels, L: Light, S: Season, t: number) {
  const lit = (c: RGB) => mul(c, L.amb);
  const cx = 27;
  const bark = lit([74, 56, 42]), barkHi = lit([112, 88, 62]);

  // Clumps of hanging foliage, back to front: [centre x, top y, half-width, curtain bottom, depth shade]
  const clumps: [number, number, number, number, number][] = [
    [27, 43, 9, 64, 0.72], [14, 50, 8, 73, 0.8], [40, 49, 8, 72, 0.74],
    [5, 57, 5, 79, 0.9], [49, 56, 5, 78, 0.82], [21, 55, 6, 77, 1], [34, 55, 6, 76, 0.94],
  ];

  // Trunk, roots and limbs reaching up into each clump (seen through the gaps, fully in winter)
  p.rect(cx - 2, 62, 4, 20, bark);
  p.rect(cx - 2, 62, 1, 20, barkHi);
  for (let y = 64; y < 80; y += 3) p.set(cx + (y % 2), y, lit([56, 42, 32])); // bark furrows
  p.rect(cx - 4, 81, 8, 1, bark);
  p.rect(cx - 3, 80, 6, 1, bark);
  for (const [x, y] of clumps) {
    p.line(cx, 64, x, y + 2, bark);
    p.line(cx + (x < cx ? -1 : 1), 65, x, y + 3, bark);
  }

  const leafy = S.willowLeafy;
  const hi = mix(mix(S.willow, [255, 252, 205], 0.35), L.sunCol, L.golden * 0.3);
  const gust = Math.max(0, Math.sin(t * 0.23)) ** 3; // the breeze picks up now and then
  clumps.forEach(([ccx, top, w, bottom, depth], ci) => {
    const leaf = scale(S.willow, depth), lo = scale(S.willow, depth * 0.62);
    for (let x = ccx - w; x <= ccx + w; x++) {
      const u = (x - ccx) / w;
      if (hash(x, ci, 21) < (leafy > 0.2 ? 0.1 : 0.55)) continue; // gaps between strands
      const y0 = top + Math.round(u * u * w * 0.55);
      const len = Math.round(bottom - y0 - hash(x, ci, 22) * 5 - Math.abs(u) * 3);
      const dark = hash(x, ci, 24) < 0.3;
      const phase = t * 0.9 + x * 0.17 + ci;
      for (let k = 0; k < len; k++) {
        if (leafy < 0.2 && hash(x, k + ci * 50, 23) > 0.75) continue; // bare golden wands in winter
        const f = k / len;
        const sway = (Math.sin(phase - k * 0.09) * 2 + gust * 3) * f ** 1.5;
        const splay = u * 2.5 * f;
        let c: RGB = k < 2 && u < 0.5 ? hi : k > len - 3 ? lo : dark ? mix(leaf, lo, 0.6) : leaf;
        if (u < -0.5 && k < len * 0.6) c = mix(c, hi, 0.35); // sunlit left edge
        if (u > 0.4) c = mix(c, lo, 0.35);
        if (S.snowing && k === 0) c = [240, 244, 250];
        p.set(x + sway + splay, y0 + k, lit(c));
      }
    }
  });
}

// ---------------------------------------------------------------- Cambridge

const COW_UP = ['.bbbbb.hh', 'bbwbbbbhh', 'bbbbwbb..', 'b.b..b.b.'];
const COW_GRAZE = ['.bbbbb...', 'bbwbbbb..', 'bbbbwbbhh', 'b.b..b.bh'];
const SWAN = ['.w....', 'ow....', '.w.www', '.wwwww'];

function drawCambridge(p: Pixels, sky: SkyState, S: Season, t: number): RGB {
  const L = lightFor(sky, t, 0, 86);
  const lit = (c: RGB) => mul(c, L.amb);
  p.clipX0 = 0;
  p.clipX1 = HALF;
  drawSky(p, 0, 86, L, sky, 1);
  if (S.fireworks) drawFireworks(p, 0, L);

  // Distant tree line along the Backs, hazed by distance
  for (let x = 0; x < HALF; x++) {
    const top = Math.round(69 + 2.5 * Math.sin(x * 0.31) + 1.8 * Math.sin(x * 0.11 + 2) + Math.sin(x * 0.73));
    for (let y = top; y < 81; y++) {
      const c = y > 77 ? [44, 60, 44] as RGB : foliage(S, x, y, y === top);
      if (c) p.set(x, y, mix(lit(scale(c, y === top ? 0.9 : 0.7)), L.horizon, 0.22));
      else if (y > top + 3 && hash(x, y, 302) < 0.3) p.set(x, y, lit([70, 62, 56]));
    }
  }
  // Nearer trees between the buildings
  const trees: [number, number, number][] = [[60, 81, 7], [8, 81, 8], [44, 81, 7], [156, 81, 6], [189, 81, 8]];
  trees.forEach(([x, b, r], i) => drawTree(p, L, S, x, b, r, 340 + i, 0.92));

  // Gibbs Building (classical, to the right of the chapel)
  const stone: RGB = [224, 210, 172], stoneHi: RGB = [238, 228, 196], stoneLo: RGB = [176, 160, 124];
  const dark: RGB = [44, 40, 44];
  for (let y = 58; y < 80; y++) for (let x = 158; x < 191; x++) p.set(x, y, lit(tex(stone, x, y)));
  p.rect(158, 56, 33, 2, lit(stoneHi));
  p.rect(158, 58, 33, 1, lit(stoneLo)); // cornice shadow
  for (let x = 158; x < 191; x += 2) p.set(x, 55, lit(stoneHi)); // balustrade
  for (let y = 74; y < 80; y += 2) p.rect(158, y, 33, 1, lit(stoneLo)); // rusticated base
  for (let j = 0; j < 6; j++) p.rect(174 - j, 50 + j, 2 * j + 1, 1, lit(j === 5 ? stoneHi : stone));
  p.rect(172, 53, 5, 2, lit(stoneLo));
  p.set(174, 53, lit(dark));
  for (const cx of [169, 172, 176, 179]) {
    p.rect(cx, 59, 1, 15, lit(stoneHi));
    p.set(cx + 1, 59, lit(stoneLo));
  }
  for (const wx of [160, 163, 166, 182, 185, 188])
    for (const wy of [61, 67]) {
      p.rect(wx, wy, 2, 3, litWindow(L, wx, wy, 31, [70, 74, 88]));
      p.rect(wx, wy + 3, 2, 1, lit(stoneHi)); // sill
      p.rect(wx, wy - 1, 2, 1, lit(stoneLo));
    }
  const doorLit = L.night > 0.3;
  p.rect(173, 68, 3, 12, doorLit ? WARM : lit(dark));
  p.set(174, 67, doorLit ? WARM : lit(dark));
  if (doorLit) p.glow(174, 76, 8, [255, 190, 110], 0.25 * L.night);

  // King's College Chapel
  const body0 = 74, body1 = 148, top = 42;
  p.rect(body0, 37, body1 - body0, 3, lit([118, 124, 132])); // lead roof
  for (let x = body0; x < body1; x += 4) p.rect(x, 37, 1, 3, lit([100, 106, 116])); // roof seams
  for (let y = top; y < 80; y++)
    for (let x = body0; x < body1; x++) {
      const course = y % 4 === 0 ? 0.95 : 1; // masonry courses
      p.set(x, y, lit(scale(tex(stone, x, y), course * (1.04 - (y - top) * 0.002))));
    }
  p.rect(body0, 40, body1 - body0, 2, lit(stoneHi));
  for (let x = body0; x < body1; x += 2) p.set(x, 39, lit(stoneHi)); // battlements
  for (let x = body0 + 1; x < body1; x += 2) p.set(x, 41, lit(stoneLo)); // pierced parapet
  p.rect(body0, 42, body1 - body0, 1, lit(stoneLo));
  p.rect(body0, 76, body1 - body0, 4, lit(stoneLo));
  p.rect(body0, 76, body1 - body0, 1, lit(stoneHi)); // plinth moulding

  const glass = [[255, 186, 86], [226, 88, 70], [92, 122, 222], [250, 222, 140], [120, 200, 160]] as RGB[];
  const skyGlass = mix([58, 66, 84], L.top, 0.35);
  for (let k = 0; k < 8; k++) {
    const wx = 77 + 9 * k;
    for (let y = 45; y < 75; y++) {
      for (let i = 0; i < 5; i++) {
        if ((y === 45 && i !== 2) || (y === 46 && (i === 0 || i === 4))) continue;
        const tracery = y < 50 && (i + y) % 2 === 0 && i !== 0 && i !== 4;
        const frame = (i === 2 && y > 49) || y === 58 || y === 66 || tracery;
        let c: RGB;
        if (frame) c = lit(stoneLo);
        else if (L.night > 0.05) {
          const g = glass[Math.floor(hash(wx + i, y, 4) * glass.length)];
          const flicker = 0.85 + 0.15 * Math.sin(t * 1.3 + hash(wx, y) * 6);
          c = mix(lit([58, 66, 84]), scale(g, flicker), L.night);
        } else {
          // by day the glass mirrors the sky, with a slow glint sliding across
          const glint = ((wx + i + y * 2 - Math.floor(t * 6)) % 140 + 140) % 140 < 3 ? 1.5 : 1;
          c = lit(scale(mix(skyGlass, [40, 44, 58], (y - 45) / 40), glint));
        }
        p.set(wx + i, y, c);
      }
    }
    p.rect(wx, 75, 5, 1, lit(stoneHi)); // sill
    if (L.night > 0.05) {
      p.glow(wx + 2, 60, 8, [255, 170, 90], 0.11 * L.night);
    }
  }
  for (let k = 0; k < 7; k++) {
    const bx = 83 + 9 * k;
    p.rect(bx, top, 1, 38, lit(stoneHi));
    p.rect(bx + 1, top, 1, 38, lit(stoneLo));
    for (const sy of [52, 64]) p.rect(bx, sy, 2, 1, lit(stone)); // buttress set-offs
    p.rect(bx - 1, 72, 4, 8, lit(stone));
    p.rect(bx - 1, 72, 4, 1, lit(stoneHi));
    p.rect(bx, 36, 2, 4, lit(stoneHi));
    p.rect(bx, 33, 1, 3, lit(stoneHi));
    p.set(bx + 1, 35, lit(stoneLo));
  }
  for (const tx of [68, 148]) {
    for (let y = 22; y < 80; y++) for (let i = 0; i < 6; i++) p.set(tx + i, y, lit(tex(stone, tx + i, y)));
    p.rect(tx, 22, 2, 58, lit(stoneHi));
    p.rect(tx + 5, 22, 1, 58, lit(stoneLo));
    for (const by of [30, 41, 60, 72]) p.rect(tx, by, 6, 1, lit(stoneLo));
    for (const by of [31, 42, 61]) p.rect(tx, by, 5, 1, lit(stoneHi));
    p.rect(tx + 2, 33, 2, 4, lit([60, 58, 64]));
    p.set(tx + 2, 32, lit([60, 58, 64]));
    p.rect(tx + 2, 49, 2, 5, L.night > 0.3 ? WARM : lit([60, 58, 64]));
    for (const sy of [24, 26, 44, 46, 64, 66]) p.set(tx + 3, sy, lit(stoneLo)); // arrow slits
    p.rect(tx - 1, 20, 8, 2, lit(stoneHi));
    for (const bx of [0, 2, 5]) p.set(tx + bx, 19, lit(stoneHi));
    p.set(tx + 1, 20, lit(stoneLo));
    p.set(tx + 4, 20, lit(stoneLo));
    p.rect(tx + 1, 16, 4, 4, lit(stone)); // ogee cap
    p.rect(tx + 1, 16, 1, 4, lit(stoneHi));
    p.rect(tx + 4, 16, 1, 4, lit(stoneLo));
    p.rect(tx + 2, 14, 2, 2, lit(stoneHi));
    p.rect(tx + 2, 10, 1, 4, lit(stoneHi));
    p.set(tx + 1, 12, lit(stoneHi));
    p.set(tx + 3, 12, lit(stoneHi));
  }

  drawWillow(p, L, S, t);

  // Snow on the rooftops
  if (S.snowing) {
    const snow: RGB = lit([240, 244, 252]);
    for (let x = 74; x < 148; x++) p.set(x, 37, snow), hash(x, 5, 9) < 0.4 && p.set(x, 38, snow);
    for (let x = 158; x < 191; x++) p.set(x, 55, snow);
    for (let j = 0; j < 6; j++) p.set(174 - j, 50 + j, snow), p.set(174 + j, 50 + j, snow);
    for (const tx of [68, 148]) p.rect(tx + 1, 16, 4, 1, snow), p.rect(tx - 1, 19, 8, 1, snow);
    for (let k = 0; k < 7; k++) p.set(83 + 9 * k, 33, snow), p.rect(82 + 9 * k, 72, 4, 1, snow);
  }

  if (S.christmas) {
    const posts = [74, ...Array.from({ length: 7 }, (_, k) => 83 + 9 * k), 148];
    for (let k = 0; k + 1 < posts.length; k++) fairyLights(p, L, posts[k], 43, posts[k + 1], 43, 2, k);
    const holly = lit([40, 110, 60]);
    for (const [dx, dy] of [[0, 0], [1, -1], [2, 0], [-1, 1], [3, 1], [-1, 2], [3, 2], [0, 3], [2, 3], [1, 3]]) p.set(173 + dx, 69 + dy, holly);
    p.set(174, 72, lit([220, 40, 40])); // wreath bow
  }

  // Lawn with mowing stripes, and light spilling from the windows after dark
  for (let x = 0; x < HALF; x++)
    for (let y = 80; y < 86; y++)
      p.set(x, y, lit(lawn(S, x, y)));
  if (L.night > 0.05) for (let k = 0; k < 8; k++) p.glow(79 + 9 * k, 81, 5, [255, 180, 100], 0.1 * L.night);

  // Spring crocuses on the Backs
  if (S.crocuses)
    for (let x = 0; x < HALF; x++)
      for (let y = 81; y < 86; y++) {
        const r = hash(x, y, 310);
        if (r < 0.1) p.set(x, y, lit(r < 0.05 ? [170, 110, 220] : r < 0.08 ? [250, 250, 240] : [250, 210, 70]));
      }

  // Cattle grazing on the Backs (they stay in when it snows)
  if (!S.snowing)
    [[59, 0], [152, 1], [164, 2]].forEach(([x0, i]) => {
      const x = Math.round(x0 + Math.sin(t * 0.05 + i * 2) * 3);
      const coat: RGB = i === 1 ? [70, 52, 44] : [146, 84, 52];
      p.sprite(x, 81, Math.sin(t * 0.3 + i * 1.7) > -0.2 ? COW_GRAZE : COW_UP,
        { b: lit(coat), w: lit(i === 2 ? [236, 228, 214] : coat), h: lit(scale(coat, 0.82)) });
    });

  lamp(p, L, 64, 82, 6);
  lamp(p, L, 155, 82, 6);

  // River Cam: rippling reflection of everything above it
  const waterY = 86;
  const water = mix(L.horizon, [30, 60, 72], 0.55);
  for (let y = waterY; y < H; y++) {
    const depth = y - waterY;
    const wob = Math.round(Math.sin(y * 0.9 + t * 2.2) * (0.5 + depth / 9) + Math.sin(y * 0.37 - t * 1.1) * depth / 14);
    const band = (y * 3 + Math.floor(t * 1.5)) % 7 === 0;
    for (let x = 0; x < HALF; x++) {
      const src = p.get(x + wob, waterY - depth - 1);
      let c = mix(scale(src, 0.82), water, 0.4 + depth * 0.012);
      if (band && hash(x >> 2, y, Math.floor(t * 1.2)) < 0.4) c = mix(c, L.horizon, 0.22); // ripple crests
      const bright = (src[0] + src[1] + src[2]) / 765;
      if (hash(x, y, Math.floor(t * 4)) < 0.004 + bright ** 3 * 0.09) c = mix(c, WHITE, 0.4); // glints
      p.set(x, y, c);
    }
  }
  p.rect(0, waterY, HALF, 1, lit([46, 74, 40]));
  for (let x = 0; x < HALF; x++) if (hash(x, 3, 312) < 0.3) p.set(x, waterY + 1, lit([40, 62, 40])); // ragged bank

  // A swan and two cygnets gliding upstream
  const sx = Math.round(HALF + 12 - ((t / 150) % 1) * (HALF + 60));
  const feather = lit([246, 246, 240]);
  p.sprite(sx, 89, SWAN, { w: feather, o: lit([236, 140, 50]) });
  for (let i = 0; i < 2; i++) {
    const gx = sx + 10 + i * 5 + Math.round(Math.sin(t * 0.7 + i) * 1);
    p.rect(gx, 92, 2, 1, lit([170, 164, 150]));
    p.set(gx, 91, lit([170, 164, 150]));
  }
  for (let k = 0; k < 14; k++) {
    p.blend(sx + 3 + k, 93 + (k >> 2), WHITE, 0.3 * (1 - k / 14)); // wake
    if (k < 4) p.blend(sx + 1 + k + Math.round(Math.sin(t * 2 + k)), 93 + k, feather, 0.3 - k * 0.06); // reflection
  }

  // A punt drifting along
  const px = Math.round(((t / 80) % 1) * (HALF + 50) - 30);
  const wood = lit([100, 64, 38]), woodHi = lit([150, 104, 64]);
  for (let k = 0; k < 16; k++) {
    p.blend(px - 1 - k, 100 + (k >> 3), WHITE, 0.28 * (1 - k / 16)); // wake
    p.blend(px - 1 - k, 97 - (k >> 3), WHITE, 0.14 * (1 - k / 16));
  }
  for (let x = 0; x < 22; x++) p.blend(px - 1 + x, 100 + (hash(x, Math.floor(t * 3), 9) < 0.3 ? 1 : 0), [20, 26, 30], 0.4);
  p.rect(px, 98, 20, 2, wood);
  p.rect(px - 1, 97, 22, 1, woodHi);
  p.set(px - 1, 98, wood);
  p.set(px + 20, 98, wood);
  const shirts = [[230, 80, 80], [80, 130, 220], [240, 200, 80]] as RGB[];
  shirts.forEach((s, i) => {
    p.rect(px + 7 + i * 4, 95, 2, 2, lit(s));
    p.set(px + 7 + i * 4, 94, lit([236, 190, 150]));
    p.set(px + 8 + i * 4, 94, lit(i === 1 ? [90, 60, 40] : [50, 40, 36])); // hair
  });
  // punter on the till, with straw boater
  p.rect(px + 1, 93, 2, 4, lit([40, 40, 60]));
  p.rect(px + 1, 89, 2, 4, lit([246, 246, 240]));
  p.rect(px + 1, 87, 2, 2, lit([236, 190, 150]));
  p.rect(px, 86, 4, 1, lit([230, 200, 110]));
  p.rect(px + 1, 85, 2, 1, lit([240, 214, 130]));
  const push = Math.sin(t * 0.8) * 3;
  p.line(px + 3 + push * 0.3, 84, px - 3 + push, 105, lit([150, 110, 70]));
  if (L.night > 0.2) {
    p.glow(px + 19, 95, 7, WARM, 0.4 * L.night);
    p.glow(px + 19, 102, 5, WARM, 0.15 * L.night);
    p.set(px + 19, 95, WARM);
    p.set(px + 19, 96, lit([60, 50, 40]));
  }

  drawMist(p, 0, 74, 96, L, sky, S.mist);

  // Reeds on the near bank, swaying in the foreground
  for (let i = 0; i < 46; i++) {
    const side = i % 2, u = hash(i, 5, 350);
    const x = side ? HALF - 2 - u * u * 34 : u * u * 30;
    const h = 5 + hash(i, 6, 350) * 9 * (1 - u * 0.5);
    const lean = (hash(i, 7, 350) - 0.5) * 4 + Math.sin(t * 1.1 + i * 0.7) * 1.4;
    const c = lit(S.snowing || S.name === 'winter' ? [120, 108, 72] : scale(S.grass, 0.42 + hash(i, 8, 350) * 0.2));
    p.line(x, H - 1, x + lean, H - 1 - h, c);
    if (i % 5 === 0) p.rect(Math.round(x + lean), Math.round(H - 2 - h), 1, 3, lit([84, 56, 38])); // cattail
  }

  if (S.christmas) drawSanta(p, L);
  drawWeather(p, 0, 86, S, L);
  return L.top;
}

function lawn(S: Season, x: number, y: number): RGB {
  if (S.snowing) return y === 80 ? [196, 204, 216] : hash(x, y, 311) < 0.15 ? [214, 222, 234] : [236, 240, 248];
  if (y === 80) return scale(S.grass, 0.62);
  const stripe = Math.floor((x + y) / 6) % 2 ? S.grass : scale(S.grass, 0.88);
  return hash(x, y, 313) < 0.08 ? scale(stripe, 1.1) : stripe;
}

// ---------------------------------------------------------------- Dallas

/** Faces that look towards a low sun pick up its colour; glass also carries a slow moving sheen. */
function sunlit(L: Light, c: RGB, x: number, y: number, mid: number, glassy: boolean): RGB {
  if (L.golden > 0 && (L.sunX < mid ? x < mid : x >= mid)) c = mix(c, L.sunCol, 0.3 * L.golden);
  if (glassy && L.night < 0.3 && ((x + y * 0.6 - L.t * 2.5) % 80 + 80) % 80 < 5) c = scale(c, 1.14);
  return c;
}

function tower(
  p: Pixels, L: Light, x: number, w: number, top: number, color: RGB, seed: number, glassy = false, bottom = 90,
) {
  const mid = x + w / 2;
  for (let i = 0; i < w; i++) {
    const edge = i === w - 1 ? 0.7 : i === 0 ? 1.12 : i === w - 2 ? 0.9 : 1;
    for (let y = top; y < bottom; y++) {
      const isWin = (y - top) % 3 === 1 && i % 2 === 1 && i < w - 1;
      let c: RGB;
      if (isWin) {
        c = litWindow(L, x + i, y, seed, scale(color, 0.62));
        if (c !== WARM && c !== COOL) c = sunlit(L, c, x + i, y, mid, glassy);
      } else {
        const floor = (y - top) % 3 === 2 ? 0.94 : 1;
        c = sunlit(L, mul(scale(tex(color, x + i, y, 0.04), edge * floor), L.amb), x + i, y, mid, glassy);
      }
      // a touch of ground haze towards the street
      p.set(x + i, y, mix(c, L.horizon, 0.14 * ((y - top) / (bottom - top)) ** 2));
    }
  }
  p.rect(x, top, w, 1, mul(scale(color, 1.2), L.amb));
}

/** Reunion Tower's holiday show: a lit tree, red and green rings, then sparkle. */
function xmasLed(show: number, dx: number, dy: number, t: number): RGB {
  if (show === 0) {
    if (dy === -6 && dx === 0) return [255, 220, 90];
    if (dy > -6 && dy < 6 && Math.abs(dx) <= (dy + 6) / 2.2) return hash(dx, dy, Math.floor(t * 2)) < 0.2 ? [255, 220, 90] : [60, 220, 90];
    return [200, 30, 40];
  }
  if (show === 1) return Math.floor(Math.hypot(dx, dy) / 2 - t * 3) & 1 ? [220, 30, 40] : [50, 210, 90];
  const r = hash(dx, dy, Math.floor(t * 5));
  return r < 0.35 ? WHITE : r < 0.7 ? [220, 30, 40] : [40, 180, 80];
}

/** Red aircraft-warning light. */
function beacon(p: Pixels, L: Light, x: number, y: number, phase: number) {
  const on = (L.t * 0.7 + phase) % 1 < 0.5;
  if (L.night > 0.1 && on) {
    p.glow(x, y, 4, [255, 40, 30], 0.7 * L.night);
    p.set(x, y, [255, 90, 70]);
  } else p.set(x, y, mul([150, 40, 40], L.amb));
}

function drawDallas(p: Pixels, sky: SkyState, S: Season, t: number): RGB {
  const L = lightFor(sky, t, HALF, 90);
  const lit = (c: RGB) => mul(c, L.amb);
  const ox = HALF;
  p.clipX0 = HALF;
  p.clipX1 = W;
  drawSky(p, ox, 90, L, sky, 2);

  // A jet climbing out of DFW
  {
    const period = 47, n = Math.floor(t / period), ph = (t % period) / 22;
    if (ph < 1) {
      const x = Math.round(ox - 12 + ph * (HALF + 24)), y = Math.round(30 - ph * 10 + hash(n, 2, 80) * 8);
      if (L.night < 0.4) {
        for (let k = 0; k < 26; k++) p.blend(x - 3 - k, y + Math.round(k * 0.08), WHITE, 0.5 * (1 - k / 26) * (1 - L.night));
        p.rect(x - 2, y, 5, 1, lit([232, 234, 240]));
        p.set(x - 2, y - 1, lit([200, 60, 60]));
        p.set(x, y + 1, lit([180, 184, 196]));
      } else p.rect(x - 1, y, 3, 1, [40, 44, 64]);
      if (L.night > 0.2) {
        p.set(x - 2, y, [255, 60, 60]);
        if ((t * 1.4) % 1 < 0.15) { p.set(x + 2, y, WHITE); p.glow(x + 2, y, 3, WHITE, 0.6); }
      }
    }
  }
  if (S.fireworks) drawFireworks(p, ox, L);

  // Hazy background towers, two layers deep
  const back: [number, number, number][] = [
    [0, 10, 62], [8, 12, 56], [28, 9, 58], [34, 8, 50], [56, 8, 46], [76, 8, 52],
    [98, 6, 54], [116, 8, 48], [134, 10, 60], [146, 12, 66], [160, 10, 70], [176, 16, 64],
  ];
  back.forEach(([bx, bw, bt], i) => {
    const hz = i % 2 ? 0.58 : 0.42;
    const base: RGB = i % 3 === 0 ? [112, 106, 112] : [96, 104, 120];
    for (let y = bt; y < 90; y++)
      for (let x = 0; x < bw; x++) {
        if (i % 3 === 1 && y < bt + 3 && (x < 2 || x >= bw - 2)) continue; // stepped crown
        const win = (y - bt) % 3 === 1 && x % 2 === 1 &&
          hash(ox + bx + x + y * 512, Math.floor(t / 50 + hash(x, y, i) * 50), 40 + i) < L.litChance * 0.7;
        const face = scale(base, x === 0 ? 1.1 : x === bw - 1 ? 0.8 : (y - bt) % 3 === 1 ? 0.9 : 1);
        p.set(ox + bx + x, y, win ? mix(WARM, L.horizon, 0.35) : mix(sunlit(L, lit(face), ox + bx + x, y, ox + bx + bw / 2, false), L.horizon, hz));
      }
    if (i % 4 === 2) p.rect(ox + bx + (bw >> 1), bt - 4, 1, 4, mix(lit([120, 124, 134]), L.horizon, hz)); // mast
  });

  // Mid-height filler towers
  tower(p, L, ox + 27, 8, 54, [132, 138, 150], 50);
  tower(p, L, ox + 137, 11, 44, [118, 132, 150], 51, true);
  p.rect(ox + 139, 42, 7, 2, lit([100, 112, 128]));
  p.rect(ox + 142, 36, 1, 6, lit([170, 174, 182]));
  beacon(p, L, ox + 142, 35, 0.3);
  tower(p, L, ox + 112, 9, 50, [150, 140, 126], 52);
  p.rect(ox + 114, 48, 5, 2, lit([128, 120, 108]));

  // Hyatt Regency (gold glass)
  for (let y = 66; y < 90; y++)
    for (let x = 2; x < 18; x++) {
      if (x > 14 && y < 70) continue;
      if (x > 9 && x < 15 && y < 68) continue;
      const band = (y % 2 === 0 ? 1 : 0.86) * (x > 14 ? 0.78 : x === 2 ? 1.1 : 1);
      const c = L.night > 0.3 && y % 2 === 0 && x % 2 === 0 && hash(x + y * 512, Math.floor(t / 40 + hash(x, y, 61) * 40), 60) < L.litChance
        ? WARM : sunlit(L, lit(scale([200, 170, 104], band)), ox + x, y, ox + 10, true);
      p.set(ox + x, y, c);
    }

  // Reunion Tower: concrete shaft + geodesic ball with LED show at night
  const rx = ox + 24;
  p.glow(rx, 32, 16, [190, 150, 255], 0.2 * L.night);
  [1.08, 1.18, 1, 0.82, 0.7].forEach((k, i) => p.rect(rx - 2 + i, 40, 1, 50, lit(scale([188, 184, 174], k))));
  for (let y = 46; y < 90; y += 6) p.rect(rx - 2, y, 5, 1, lit([150, 146, 138])); // pour lines
  p.rect(rx - 4, 39, 9, 1, lit([196, 194, 186]));
  p.rect(rx - 3, 40, 7, 2, lit([150, 148, 142]));
  for (let x = rx - 3; x < rx + 4; x += 2) p.set(x, 40, L.night > 0.2 ? WARM : lit([60, 70, 90])); // deck windows
  p.rect(rx, 19, 1, 6, lit([200, 200, 200]));
  beacon(p, L, rx, 18, 0);
  for (let dy = -8; dy <= 8; dy++)
    for (let dx = -8; dx <= 8; dx++) {
      if (dx * dx + dy * dy > 70) continue;
      const lattice = (dx + dy + 100) % 3 === 0 || (dx - dy + 100) % 3 === 0;
      const shadeK = 1.2 - (dx + 8) / 20 - Math.max(0, dy) / 30;
      let c: RGB = lit(scale(lattice ? [128, 132, 142] : [176, 180, 190], shadeK));
      if (dx * dx + dy * dy < 12 && dx < 0 && dy < 0) c = mix(c, lit(WHITE), 0.25); // specular
      if (L.night > 0.1 && (dx & 1) === 0 && (dy & 1) === 0) {
        // the light show cycles between a colour sweep, rings and sparkle
        const show = Math.floor(t / 12) % 3;
        const led = S.christmas ? xmasLed(show, dx, dy, t) : show === 0 ? hsv((dx * 14 + dy * 9 + t * 50) % 360, 0.55, 1)
          : show === 1 ? hsv((Math.hypot(dx, dy) * 30 - t * 90 + 3600) % 360, 0.6, 1)
          : hash(dx, dy, Math.floor(t * 5)) < 0.45 ? WHITE : hsv(220, 0.7, 0.6);
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
      if (i === 9) c = scale(c, 1.25); // the ridge between the two facets
      // the glass mirrors the sky, lighter towards the top
      c = mix(c, L.top, 0.22 * (1 - (y - top) / 64));
      c = sunlit(L, c, fx + i, y, fx + 9, true);
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
  tower(p, L, bx, bw, bt + 6, [92, 112, 104], 80, true);
  for (let i = 2; i < bw - 2; i++) for (let y = bt; y < bt + 6; y++) p.set(bx + i, y, lit(scale([100, 122, 112], i < 4 ? 1.1 : i > bw - 5 ? 0.8 : 1)));
  for (let x = bx + 3; x < bx + bw - 3; x += 3) p.rect(x, bt + 6, 1, 84 - bt, lit([124, 146, 136]));
  for (const sy of [34, 58]) p.rect(bx, sy, bw, 1, lit([70, 88, 82])); // setback bands
  if (L.night > 0.05) {
    const g: RGB = [80, 255, 120], a = L.night;
    for (let y = bt + 6; y < 90; y++) {
      p.blend(bx, y, g, a);
      p.blend(bx + bw - 1, y, g, a);
      if (y % 5 === 0) { p.glow(bx, y, 4, g, 0.1 * a); p.glow(bx + bw - 1, y, 4, g, 0.1 * a); }
    }
    for (let y = bt; y < bt + 6; y++) {
      p.blend(bx + 2, y, g, a);
      p.blend(bx + bw - 3, y, g, a);
    }
    for (let i = 0; i < bw; i++) p.blend(bx + i, bt + 6, g, a);
    for (let i = 2; i < bw - 2; i++) p.blend(bx + i, bt, g, a);
    p.glow(bx + 8, bt + 2, 10, g, 0.12 * a);
  }
  beacon(p, L, bx + 8, bt - 1, 0.6);

  // Renaissance Tower: twin spires and the X crown
  const nx = ox + 83;
  tower(p, L, nx, 15, 24, [142, 162, 188], 90, true);
  p.rect(nx + 3, 14, 1, 10, lit([210, 214, 220]));
  p.rect(nx + 11, 14, 1, 10, lit([210, 214, 220]));
  p.rect(nx + 2, 21, 3, 3, lit([150, 166, 188]));
  p.rect(nx + 10, 21, 3, 3, lit([150, 166, 188]));
  beacon(p, L, nx + 3, 13, 0.15);
  beacon(p, L, nx + 11, 13, 0.65);
  const xc: RGB = L.night > 0.2 ? WHITE : lit([196, 210, 228]);
  for (const y0 of [24, 46, 68]) {
    p.line(nx, y0, nx + 14, y0 + 10, xc, y0 === 24 ? 1 : 0.35);
    p.line(nx + 14, y0, nx, y0 + 10, xc, y0 === 24 ? 1 : 0.35);
  }

  // Comerica Bank Tower: gabled crown
  const cx = ox + 101;
  tower(p, L, cx, 15, 34, [172, 160, 138], 100);
  for (let j = 0; j < 7; j++) {
    const c = L.night > 0.3 ? mix(lit([172, 160, 138]), [255, 238, 196], L.night) : lit([190, 178, 154]);
    p.rect(cx + 7 - j, 28 + j, 2 * j + 1, 1, c);
    p.set(cx + 7 + j, 28 + j, scale(c, 0.8));
  }
  p.rect(cx + 6, 31, 3, 3, L.night > 0.3 ? WARM : lit([90, 86, 80])); // arched crown window
  if (L.night > 0.3) p.glow(cx + 7, 30, 9, [255, 220, 160], 0.15 * L.night);
  p.rect(cx + 5, 40, 5, 50, lit([150, 140, 122])); // recessed central bay

  // Magnolia Building + the red Pegasus
  const mx = ox + 122;
  tower(p, L, mx, 10, 58, [180, 140, 104], 110);
  p.rect(mx - 1, 58, 12, 1, lit([206, 170, 132])); // cornice
  for (let j = 0; j < 8; j++) {
    const half = 1 + Math.floor(j / 3);
    p.set(mx + 5 - half, 50 + j, lit([150, 150, 150]));
    p.set(mx + 4 + half, 50 + j, lit([150, 150, 150]));
    if (j % 2) p.rect(mx + 5 - half, 50 + j, half * 2, 1, lit([130, 130, 130]));
  }
  const pulse = 0.8 + 0.2 * Math.sin(t * 1.5);
  const red: RGB = L.night > 0.2 ? scale([255, 60, 56], pulse) : lit([212, 36, 36]);
  if (L.night > 0.2) p.glow(mx + 5, 45, 9, [255, 40, 40], 0.3 * L.night * pulse);
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
    for (let y = top; y < 93; y++) {
      const c = y > 90 ? [44, 64, 44] as RGB : foliage(S, x, y, y === top) ?? [66, 70, 56];
      p.set(x, y, lit(scale(c, y === top ? 0.95 : 0.72)));
    }
  }
  for (let i = 0; i < 9; i++) drawTree(p, L, S, ox + 5 + i * 14 + Math.floor(hash(i, 1, 360) * 6), 93, 3 + (i % 2), 360 + i);

  // Margaret Hunt Hill Bridge: a single white arch standing on the deck, its stay cables
  // crossing in a diamond lattice between the arch and the deck. Approach spans sit on piers.
  const deckY = 89, deck0 = ox + 116, bcx = ox + 158, half = 27, rise = 24;
  const archY = (x: number) => deckY - rise * (1 - ((x - bcx) / half) ** 2);
  const white: RGB = [238, 238, 232];
  const archC: RGB = L.night > 0.2 ? mix(lit(white), [245, 248, 255], L.night) : lit(white);
  if (L.night > 0.2) p.glow(bcx, deckY - rise / 2, 18, [150, 190, 255], 0.14 * L.night);
  const cableC: RGB = L.night > 0.2 ? mix(lit([210, 212, 216]), [200, 214, 255], L.night * 0.7) : lit([210, 212, 216]);
  for (let ax = bcx - half + 5; ax <= bcx + half - 5; ax += 3) {
    for (const s of [-1, 1]) {
      const dx = Math.max(bcx - half + 2, Math.min(bcx + half - 2, ax + s * 7));
      p.line(ax, archY(ax) + 2, dx, deckY - 1, cableC, 0.4);
    }
  }
  for (let x = bcx - half; x <= bcx + half; x++) {
    const u = Math.abs(x - bcx) / half;
    const y0 = Math.round(archY(x));
    // fill down to the neighbouring column so the steep ends stay solid
    const y1 = Math.max(y0 + (u > 0.75 ? 2 : 1), Math.round(archY(x + (x < bcx ? 1 : -1))) - 1);
    for (let y = y0; y <= Math.min(y1, deckY - 1); y++) p.set(x, y, y === y0 || x < bcx ? archC : scale(archC, 0.84));
  }
  p.rect(deck0, deckY, W - deck0, 1, lit([236, 236, 230])); // railing
  p.rect(deck0, deckY + 1, W - deck0, 1, lit([200, 200, 194])); // deck edge
  p.rect(deck0, deckY + 2, W - deck0, 1, lit([128, 128, 124])); // underside shadow
  p.rect(deck0 - 2, deckY, 3, 93 - deckY, lit([172, 168, 158])); // abutment
  for (let x = deck0 + 12; x < W; x += 14) p.rect(x, deckY + 3, 2, 93 - deckY - 3, lit([150, 150, 146])); // piers

  // Grass, highway with traffic, and the Trinity River
  const grass = (x: number, y: number): RGB =>
    S.snowing ? (hash(x, y, 320) < 0.3 ? [150, 160, 120] : [236, 240, 248])
      : scale(S.grass, (x + y) % 7 === 0 ? 1.15 : hash(x, y, 321) < 0.2 ? 0.9 : 1);
  for (let x = ox; x < W; x++) for (let y = 93; y < 95; y++) p.set(x, y, lit(grass(x, y)));
  for (let y = 95; y < 99; y++) for (let x = ox; x < W; x++) p.set(x, y, lit(tex([62, 62, 68], x, y, 0.1)));
  p.rect(ox, 95, HALF, 1, lit([92, 92, 96])); // kerb
  for (let x = ox; x < W; x += 6) p.rect(x, 97, 3, 1, lit([200, 190, 120]));
  for (let x = ox; x < W; x++) for (let y = 99; y < 101; y++) p.set(x, y, lit(grass(x, y)));

  // Street lamps
  for (let x = ox + 9; x < W; x += 26) {
    p.rect(x, 90, 1, 5, lit([70, 72, 80]));
    p.set(x + 1, 90, lit([70, 72, 80]));
    if (L.night > 0.15) {
      p.set(x + 1, 91, WARM);
      p.glow(x + 1, 91, 6, [255, 190, 110], 0.35 * L.night);
      p.glow(x + 1, 97, 6, [255, 190, 110], 0.16 * L.night);
    }
  }

  if (S.christmas) {
    for (let x = ox + 10; x + 26 < ox + 116; x += 26) fairyLights(p, L, x, 90, x + 26, 90, 2, x);
  }

  // The river carries a smeared reflection of the skyline
  const river = mix(L.horizon, [40, 78, 90], 0.5);
  for (let y = 101; y < 105; y++) {
    const wob = Math.round(Math.sin(y * 1.3 + t * 2) * 1.2);
    for (let x = ox; x < W; x++) {
      const src = p.get(Math.max(ox, Math.min(W - 1, x + wob)), 88 - (y - 101) * 9);
      let c = mix(river, src, 0.38);
      const bright = (src[0] + src[1] + src[2]) / 765;
      if (hash(x, y, Math.floor(t * 3)) < 0.02 + bright ** 3 * 0.08) c = mix(c, WHITE, 0.3);
      p.set(x, y, c);
    }
  }
  p.rect(ox, 101, HALF, 1, lit(scale(S.snowing ? [200, 208, 220] : S.grass, 0.6)));
  for (let y = 105; y < H; y++)
    for (let x = ox; x < W; x++) p.set(x, y, lit(scale(grass(x, y), 0.92)));
  if (S.bluebonnets)
    for (let x = ox; x < W; x++)
      for (const y of [93, 94, 99, 100, 105, 106, 107]) {
        const r = hash(x, y, 330);
        if (r < 0.22) p.set(x, y, lit(r < 0.16 ? [70, 90, 200] : r < 0.19 ? [240, 240, 250] : [230, 90, 60]));
      }

  // Traffic, with headlight beams and tail-light streaks after dark
  const paints = [[220, 60, 60], [240, 240, 240], [60, 100, 200], [30, 30, 36], [200, 180, 60], [70, 150, 110]] as RGB[];
  // Every car in a lane moves at the lane's speed from its own evenly spaced slot, so they never overlap.
  const CARS = 7, span2 = HALF + 14, gap = span2 / CARS;
  for (let lane = 0; lane < 2; lane++) {
    const dir = lane ? -1 : 1;
    const speed = dir * (lane ? 12 : 10);
    for (let i = 0; i < CARS; i++) {
      const slot = (i + (hash(i, lane, 91) - 0.5) * 0.4) * gap;
      const off = (((slot + t * speed) % span2) + span2) % span2;
      const x = Math.round(ox - 7 + off);
      const y = lane ? 97 : 95;
      const truck = hash(i, lane, 94) < 0.2, len = truck ? 7 : 5;
      const body = paints[Math.floor(hash(i, lane, 92) * paints.length)];
      const dim = L.night > 0.4 ? 0.35 : 1;
      p.rect(x, y + 1, len, 1, lit(scale(body, dim)));
      if (truck) p.rect(dir > 0 ? x : x + 2, y, 5, 1, lit(scale([230, 230, 226], dim)));
      else {
        p.rect(x + 1, y, 3, 1, lit(scale(body, 0.8 * dim)));
        p.set(x + 2, y, L.night > 0.4 ? [50, 56, 76] : lit([150, 190, 220]));
      }
      if (L.night > 0.2) {
        const front = dir > 0 ? x + len - 1 : x, rear = dir > 0 ? x : x + len - 1;
        p.set(front, y + 1, [255, 250, 200]);
        for (let k = 1; k <= 4; k++) p.add(front + dir * k, y + 1, [255, 240, 180], 0.45 * (1 - k / 5) * L.night);
        p.set(rear, y + 1, [255, 40, 40]);
        for (let k = 1; k <= 3; k++) p.add(rear - dir * k, y + 1, [255, 30, 30], 0.3 * (1 - k / 4) * L.night);
      }
    }
  }

  drawMist(p, ox, 97, 107, L, sky, S.mist * 0.6);

  // Prairie grass swaying in the foreground
  for (let i = 0; i < 60; i++) {
    const x = ox + hash(i, 1, 370) * HALF;
    const h = 2 + hash(i, 2, 370) * 4;
    const lean = (hash(i, 3, 370) - 0.5) * 3 + Math.sin(t * 1.3 + i * 0.5) * 1.2;
    const c = lit(S.snowing ? [150, 150, 120] : scale(S.grass, 0.6 + hash(i, 4, 370) * 0.3));
    p.line(x, H - 1, x + lean, H - 1 - h, c);
  }

  if (S.christmas) drawSanta(p, L);
  drawWeather(p, ox, 92, S, L);
  return L.top;
}

// ---------------------------------------------------------------- frame

const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const MINI_HEART = ['X.X', 'XXX', '.X.'];

/** Draws both cities and returns the sky colour at the top edge of each half. */
export function render(
  p: Pixels, cambridge: SkyState, dallas: SkyState, cSeason: Season, dSeason: Season, t: number,
): [RGB, RGB] {
  const tops: [RGB, RGB] = [drawCambridge(p, cambridge, cSeason, t), drawDallas(p, dallas, dSeason, t)];

  p.clipX0 = 0;
  p.clipX1 = W;
  p.rect(HALF - 1, 0, 2, H, [18, 12, 30]);

  // Little hearts drifting up the seam between the two cities
  for (let i = 0; i < 3; i++) {
    const ph = (t / 9 + i / 3) % 1;
    const x = HALF - 2 + Math.round(Math.sin(t * 0.9 + i * 2.1) * 3);
    p.sprite(x, Math.round(100 - ph * 78), MINI_HEART, { X: [255, 130, 165] }, Math.sin(ph * Math.PI) * 0.85);
  }

  const beat = Math.max(0, Math.sin(t * 3)) ** 2;
  p.glow(HALF, 5, 7, [255, 80, 120], 0.25 + 0.3 * beat);
  p.sprite(HALF - 4, 3, HEART, { X: [40, 10, 24] });
  p.sprite(HALF - 3, 2, HEART, { X: mix([240, 70, 110], [255, 150, 180], beat) });
  p.set(HALF - 2, 3, [255, 220, 230]);
  return tops;
}
