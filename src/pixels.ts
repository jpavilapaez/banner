export type RGB = readonly [number, number, number];

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
export const mul = (c: RGB, m: RGB): RGB => [c[0] * m[0], c[1] * m[1], c[2] * m[2]];
export const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Deterministic hash → [0, 1). Same inputs always give the same "random" pixel. */
export function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hsv(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

/** Interpolate through [key, value] stops sorted by key. */
export function ramp(stops: readonly (readonly [number, RGB])[], x: number): RGB {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [k1, c1] = stops[i];
    if (x <= k1) {
      const [k0, c0] = stops[i - 1];
      return mix(c0, c1, (x - k0) / (k1 - k0));
    }
  }
  return stops[stops.length - 1][1];
}

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** A tiny software framebuffer: every drawing call works in whole logical pixels. */
export class Pixels {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /** Horizontal clip window, so each city only paints its own half. */
  clipX0 = 0;
  clipX1: number;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
    this.clipX1 = w;
  }

  set(x: number, y: number, c: RGB): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < this.clipX0 || x >= this.clipX1 || y < 0 || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }

  get(x: number, y: number): RGB {
    x = Math.max(0, Math.min(this.w - 1, Math.round(x)));
    y = Math.max(0, Math.min(this.h - 1, Math.round(y)));
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  blend(x: number, y: number, c: RGB, a: number): void {
    if (a <= 0) return;
    this.set(x, y, a >= 1 ? c : mix(this.get(x, y), c, a));
  }

  /** Additive blend, for light sources. */
  add(x: number, y: number, c: RGB, a: number): void {
    if (a <= 0) return;
    const g = this.get(x, y);
    this.set(x, y, [g[0] + c[0] * a, g[1] + c[1] * a, g[2] + c[2] * a]);
  }

  /** Soft additive halo with quadratic falloff. */
  glow(cx: number, cy: number, r: number, c: RGB, a: number): void {
    if (a <= 0.01) return;
    cx = Math.round(cx); cy = Math.round(cy);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const f = 1 - Math.sqrt(dx * dx + dy * dy) / r;
        if (f > 0) this.add(cx + dx, cy + dy, c, a * f * f);
      }
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    for (let dy = -Math.ceil(r); dy <= r; dy++)
      for (let dx = -Math.ceil(r); dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r + r * 0.6) this.blend(cx + dx, cy + dy, c, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.blend(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Draw a sprite from strings; any non-space/non-dot char maps through the palette. */
  sprite(x: number, y: number, rows: readonly string[], pal: Record<string, RGB>, a = 1): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i]];
        if (c) this.blend(x + i, y + j, c, a);
      }
    });
  }
}
