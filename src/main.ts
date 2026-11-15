import './style.css';
import { left, right, type Place } from './config';
import { Pixels, hash } from './pixels';
import { H, W, render } from './scene';
import { skyState } from './sky';
import { seasonFor } from './season';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const banner = document.getElementById('banner')!;
canvas.width = W;

// The art is a 384x108 strip. If the embed is taller than that, grow extra sky above it
// (up to MAX_EXTRA rows) so the banner fills the frame instead of leaving black bars.
const MAX_EXTRA = 80;
let extra = -1;
function fit() {
  const want = Math.round((W * innerHeight) / Math.max(1, innerWidth)) - H;
  const next = Math.max(0, Math.min(MAX_EXTRA, want));
  if (next === extra) return;
  extra = next;
  const total = H + extra;
  canvas.height = total;
  banner.style.aspectRatio = `${W} / ${total}`;
  banner.style.width = `min(100vw, calc(100vh * ${W} / ${total}))`;
  document.getElementById('apart')!.style.top = `${((extra + 11.3) / total) * 100}%`;
}
fit();
addEventListener('resize', fit);
const ctx = canvas.getContext('2d')!;
const pixels = new Pixels(W, H);
const image = new ImageData(pixels.data, W, H);

// ?at=2026-11-15T21:30:00Z freezes the clock (handy for previewing night/day).
// ?season=winter|spring|summer|autumn forces a season. ?fireworks=1 previews the fireworks.
const query = new URLSearchParams(location.search);
const frozen = query.get('at');
const seasonOverride = query.get('season');
const now = () => (frozen ? new Date(frozen) : new Date());

function parts(date: Date, place: Place) {
  const get = (opts: Intl.DateTimeFormatOptions) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: place.timeZone, ...opts })
        .formatToParts(date)
        .map((p) => [p.type, p.value]),
    );
  const t = get({ hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: place.hour12 ? 'h12' : 'h23' });
  const d = get({ weekday: 'short', day: 'numeric', month: 'short' });
  return {
    hour24: Number(get({ hour: 'numeric', hourCycle: 'h23' }).hour),
    hm: `${place.hour12 ? Number(t.hour) : t.hour}:${t.minute}`,
    sec: `:${t.second}${place.hour12 ? ' ' + (t.dayPeriod ?? '').toUpperCase() : ''}`,
    date: `${d.weekday} ${d.day} ${d.month}`.toUpperCase(),
  };
}

function offsetMinutes(date: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric',
    }).formatToParts(date).map((x) => [x.type, Number(x.value)]),
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function mood(hour: number): string {
  if (hour < 6) return 'probably asleep';
  if (hour < 12) return 'good morning';
  if (hour < 18) return 'good afternoon';
  if (hour < 22) return 'good evening';
  return 'bedtime soon';
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const cache = new Map<HTMLElement, string>();
function setHtml(el: HTMLElement, html: string) {
  if (cache.get(el) !== html) {
    cache.set(el, html);
    el.innerHTML = html;
  }
}

function updateClock(el: HTMLElement, place: Place, date: Date, season: string) {
  const p = parts(date, place);
  setHtml(
    el,
    `<div class="label">${escape(place.city)} · ${escape(place.person)}</div>` +
      `<div class="time">${p.hm}<small>${p.sec}</small></div>` +
      `<div class="date">${p.date} · ${season.toUpperCase()}</div>` +
      `<div class="mood">${mood(p.hour24)}</div>`,
  );
}

const leftEl = document.getElementById('clock-left')!;
const rightEl = document.getElementById('clock-right')!;
const apartEl = document.getElementById('apart')!;
const start = performance.now();
let last = 0;

function frame(ms: number) {
  requestAnimationFrame(frame);
  if (ms - last < 66) return; // ~15 fps is plenty for pixel art
  last = ms;
  const date = now();
  const t = (ms - start) / 1000 + (date.getTime() / 1000) % 10000;
  const cs = seasonFor(date, 'cambridge', left.timeZone, seasonOverride);
  const ds = seasonFor(date, 'dallas', right.timeZone, seasonOverride);
  if (query.has('fireworks')) cs.fireworks = ds.fireworks = true;
  render(pixels, skyState(date, left.lat, left.lon), skyState(date, right.lat, right.lon), cs, ds, t);
  ctx.putImageData(image, 0, extra);
  if (extra > 0) {
    // Continue each city's sky upwards, with a few stars after dark.
    [[0, 2, left], [W / 2, W - 3, right]].forEach(([x0, sample, place], side) => {
      const i = (sample as number) * 4;
      ctx.fillStyle = `rgb(${pixels.data[i]},${pixels.data[i + 1]},${pixels.data[i + 2]})`;
      ctx.fillRect(x0 as number, 0, W / 2, extra);
      const pl = place as Place;
      const night = Math.max(0, Math.min(1, (-skyState(date, pl.lat, pl.lon).elevation - 2) / 8));
      for (let k = 0; night > 0 && k < extra; k++) {
        const tw = 0.55 + 0.45 * Math.sin(t * (1 + hash(k, 3)) * 2 + k);
        ctx.fillStyle = `rgba(255,250,230,${night * tw * 0.8})`;
        ctx.fillRect((x0 as number) + Math.floor(hash(k, side, 500) * (W / 2)), Math.floor(hash(k, side, 501) * extra), 1, 1);
      }
    });
    ctx.fillStyle = 'rgb(18,12,30)';
    ctx.fillRect(W / 2 - 1, 0, 2, extra);
  }

  updateClock(leftEl, left, date, cs.name);
  updateClock(rightEl, right, date, ds.name);
  const diff = Math.abs(offsetMinutes(date, left.timeZone) - offsetMinutes(date, right.timeZone)) / 60;
  setHtml(apartEl, `${diff}h apart`);
}
requestAnimationFrame(frame);
