const RAD = Math.PI / 180;

export interface SkyState {
  /** Sun elevation in degrees (negative = below horizon). */
  elevation: number;
  /** Sun hour angle in degrees, -180..180 (0 = solar noon, negative = morning). */
  hourAngle: number;
  /** Moon phase 0..1 (0 = new, 0.5 = full). */
  moonPhase: number;
  /** Today's solar-noon elevation and sunset hour angle, to fit the sun's arc in the sky. */
  noonElevation: number;
  sunsetHourAngle: number;
}

/** Low-precision solar position (good to ~1°), enough for a sky colour. */
export function skyState(date: Date, lat: number, lon: number): SkyState {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  let H = (gmst * 15 + lon) * RAD - ra;
  H = Math.atan2(Math.sin(H), Math.cos(H));
  const el = Math.asin(
    Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(H),
  );
  const moonPhase = (((d - 5.26) / 29.530588) % 1 + 1) % 1;
  const noonElevation = 90 - Math.abs(lat - dec / RAD);
  const cosSet = clampUnit(-Math.tan(lat * RAD) * Math.tan(dec));
  return { elevation: el / RAD, hourAngle: H / RAD, moonPhase, noonElevation, sunsetHourAngle: Math.acos(cosSet) / RAD };
}

function clampUnit(v: number) {
  return Math.max(-1, Math.min(1, v));
}
