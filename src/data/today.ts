/**
 * Today (M4): the weather at each station from Open-Meteo's forecast model
 * (keyless, CORS-open): the current snow depth and top-centimetre soil
 * moisture, the rain over the last three days and the snowfall over the last
 * week. These are model values on a grid a few km wide, so stations in the
 * same ~1 km square share a reading, cached for an hour, and the squares not
 * cached are asked for together, up to 40 in one request.
 */
import { haversine } from '../core/geo';
import type { LatLon, TodayFacts } from '../core/types';
import { IDB, MEM, jget, pool } from './http';
import { openMeteoGet } from './pace';

const HOUR = 36e5;
const cell = (p: LatLon) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
/** the forecast request for one point or several (Open-Meteo answers several with a list) */
export const todayUrl = (p: LatLon | LatLon[]) => {
  const ps = Array.isArray(p) ? p : [p];
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${ps.map(q => q.lat.toFixed(2)).join(',')}` +
    `&longitude=${ps.map(q => q.lon.toFixed(2)).join(',')}` +
    '&current=snow_depth,soil_moisture_0_to_1cm&daily=rain_sum,snowfall_sum&past_days=7&forecast_days=1&timezone=auto'
  );
};
/** the most squares asked for in one request */
const MANY = 40;

const num = (v: unknown) => (v == null || !Number.isFinite(+v) ? null : +v);
const sum = (a: unknown, n: number) =>
  (Array.isArray(a) ? a.slice(-n) : []).reduce((s, v) => s + (num(v) ?? 0), 0);

/** Open-Meteo's answer as today's facts at a point, or null when it has no reading (pure) */
export function parseToday(j: unknown, at: LatLon): TodayFacts | null {
  const r = j as {
    latitude?: number;
    longitude?: number;
    elevation?: number;
    current?: Record<string, unknown>;
    daily?: Record<string, unknown>;
  };
  const snow = num(r?.current?.snow_depth);
  if (!r?.current || !r.daily || snow == null || num(r.latitude) == null || num(r.longitude) == null)
    return null;
  const grid = { lat: +r.latitude!, lon: +r.longitude! };
  return {
    time: String(r.current.time ?? ''),
    snow: Math.max(0, snow),
    soil: num(r.current.soil_moisture_0_to_1cm),
    /* daily runs from seven days back through today */
    rain3: sum(r.daily.rain_sum, 3),
    snow7: sum(r.daily.snowfall_sum, 8),
    snowfall: (Array.isArray(r.daily.time) ? r.daily.time : []).map((date: unknown, k: number) => ({
      date: String(date),
      cm: num((r.daily!.snowfall_sum as unknown[])?.[k]) ?? 0,
    })),
    grid: { ...grid, elev: num(r.elevation) ?? NaN, km: haversine(at, grid) / 1000 },
  };
}

/** today's facts for each point, null where Open-Meteo couldn't answer */
export async function todayFor(points: LatLon[]): Promise<(TodayFacts | null)[]> {
  const cells = new Map<string, number[]>();
  points.forEach((p, i) => cells.set(cell(p), [...(cells.get(cell(p)) || []), i]));
  const got = new Map<string, unknown>();
  /* what this session or this browser already has */
  await Promise.all(
    [...cells.keys()].map(async k => {
      const key = 'today:' + k,
        hit = MEM.has(key) ? await MEM.get(key).catch(() => null) : await IDB.get(key, HOUR);
      if (hit != null) got.set(k, hit);
    }),
  );
  /* the rest, many squares to a request */
  const miss = [...cells.keys()].filter(k => !got.has(k)),
    chunks: string[][] = [];
  for (let k = 0; k < miss.length; k += MANY) chunks.push(miss.slice(k, k + MANY));
  await pool(chunks, 2, async (ch: string[]) => {
    const at = ch.map(k => points[cells.get(k)![0]]);
    try {
      const j = await openMeteoGet(at.length, () => jget(todayUrl(at), { timeout: 15000 })),
        list = Array.isArray(j) ? j : [j];
      ch.forEach((k, n) => {
        const v = list[n];
        if (v == null) return;
        got.set(k, v);
        MEM.set('today:' + k, Promise.resolve(v));
        void IDB.put('today:' + k, v);
      });
    } catch {}
  });
  const out: (TodayFacts | null)[] = new Array(points.length).fill(null);
  for (const [k, idx] of cells) for (const i of idx) out[i] = parseToday(got.get(k) ?? null, points[i]);
  return out;
}
