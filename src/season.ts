import { RGB, clamp, hash, ramp } from './pixels';

export type City = 'cambridge' | 'dallas';

export interface Season {
  name: 'winter' | 'spring' | 'summer' | 'autumn';
  /** Foliage colour of ordinary deciduous trees, and how much of the canopy is left (0 = bare). */
  leaf: RGB;
  leafDensity: number;
  /** Willows keep their leaves longer and go golden; in winter the bare wands stay golden too. */
  willow: RGB;
  willowLeafy: number;
  grass: RGB;
  snowing: boolean;
  fallingLeaves: boolean;
  crocuses: boolean;
  bluebonnets: boolean;
  fireflies: boolean;
  /** Bonfire Night in Cambridge, the Fourth of July in Dallas, New Year in both. */
  fireworks: boolean;
  /** Misty mornings are thicker in the cold half of the year. */
  mist: number;
}

const BARE: RGB = [104, 88, 72];
const LEAF: [number, RGB][] = [
  [0, BARE], [70, BARE], [100, [150, 200, 92]], [140, [96, 150, 60]], [235, [80, 128, 52]],
  [278, [176, 166, 62]], [300, [214, 128, 48]], [325, [168, 88, 44]], [345, BARE], [366, BARE],
];
const DENSITY: [number, RGB][] = [
  [0, [0, 0, 0]], [75, [0, 0, 0]], [105, [0.8, 0, 0]], [130, [1, 0, 0]], [295, [1, 0, 0]],
  [320, [0.7, 0, 0]], [338, [0.25, 0, 0]], [350, [0, 0, 0]], [366, [0, 0, 0]],
];
const WILLOW: [number, RGB][] = [
  [0, [178, 150, 72]], [60, [186, 170, 78]], [85, [196, 216, 98]], [140, [116, 168, 64]],
  [235, [96, 150, 58]], [290, [150, 172, 64]], [315, [212, 190, 78]], [345, [178, 150, 72]], [366, [178, 150, 72]],
];
const WILLOW_LEAFY: [number, RGB][] = [
  [0, [0, 0, 0]], [65, [0, 0, 0]], [90, [0.9, 0, 0]], [325, [0.9, 0, 0]], [345, [0, 0, 0]], [366, [0, 0, 0]],
];
const GRASS: Record<City, [number, RGB][]> = {
  cambridge: [
    [0, [112, 134, 82]], [60, [104, 144, 74]], [120, [92, 160, 68]], [200, [96, 150, 64]],
    [300, [96, 142, 64]], [366, [112, 134, 82]],
  ],
  dallas: [
    [0, [156, 146, 96]], [60, [140, 146, 88]], [100, [92, 156, 66]], [170, [106, 144, 66]],
    [220, [142, 146, 82]], [300, [118, 140, 72]], [340, [150, 144, 94]], [366, [156, 146, 96]],
  ],
};

const OVERRIDE_DOY: Record<string, number> = { winter: 20, spring: 105, summer: 195, autumn: 300 };

function localDayOfYear(date: Date, timeZone: string): { doy: number; year: number; month: number; day: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(date)
      .map((x) => [x.type, Number(x.value)]),
  );
  const doy = (Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / 86400000 + 1;
  return { doy, year: p.year, month: p.month, day: p.day };
}

export function seasonFor(date: Date, city: City, timeZone: string, override?: string | null): Season {
  let { doy, year, month, day } = localDayOfYear(date, timeZone);
  const on = (m: number, d: number) => !override && month === m && day === d;
  if (override && override in OVERRIDE_DOY) doy = OVERRIDE_DOY[override];
  const name =
    doy < 80 || doy >= 355 ? 'winter' : doy < 172 ? 'spring' : doy < 266 ? 'summer' : 'autumn';
  const winterish = doy < 60 || doy >= 340;
  // Snow days are picked by date, so everyone looking at the banner sees the same weather.
  const snowOdds = city === 'cambridge' ? 0.3 : 0.05;
  const forceSnow = override === 'winter' && city === 'cambridge';
  return {
    name,
    leaf: ramp(LEAF, doy),
    leafDensity: clamp(ramp(DENSITY, doy)[0]),
    willow: ramp(WILLOW, doy),
    willowLeafy: clamp(ramp(WILLOW_LEAFY, doy)[0]),
    grass: ramp(GRASS[city], doy),
    snowing: winterish && (forceSnow || hash(year, Math.floor(doy), city === 'cambridge' ? 1 : 2) < snowOdds),
    fallingLeaves: doy >= 278 && doy < 340,
    crocuses: city === 'cambridge' && doy >= 45 && doy < 105,
    bluebonnets: city === 'dallas' && doy >= 75 && doy < 130,
    fireflies: city === 'dallas' && doy >= 140 && doy < 240,
    fireworks: on(12, 31) || on(1, 1) || (city === 'cambridge' ? on(11, 5) : on(7, 4)),
    mist: doy < 90 || doy > 270 ? 1 : 0.55,
  };
}
