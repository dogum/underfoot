/**
 * Today (M4): the weather at each station from Open-Meteo's forecast model
 * (keyless, CORS-open): the current snow depth and top-centimetre soil
 * moisture, the rain over the last three days and the snowfall over the last
 * week. These are model values on a grid a few km wide, so stations in the
 * same ~1 km square share one request, cached for an hour.
 */
import { haversine } from '../core/geo';
import type { LatLon, TodayFacts } from '../core/types';
import { cachedFetch, jget, pool } from './http';

const HOUR = 36e5;
const cell = (p: LatLon) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
export const todayUrl = (p: LatLon) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}` +
  '&current=snow_depth,soil_moisture_0_to_1cm&daily=rain_sum,snowfall_sum&past_days=7&forecast_days=1&timezone=auto';

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
    grid: { ...grid, elev: num(r.elevation) ?? NaN, km: haversine(at, grid) / 1000 },
  };
}

/** today's facts for each point, null where Open-Meteo couldn't answer */
export async function todayFor(points: LatLon[]): Promise<(TodayFacts | null)[]> {
  const cells = new Map<string, number[]>();
  points.forEach((p, i) => cells.set(cell(p), [...(cells.get(cell(p)) || []), i]));
  const out: (TodayFacts | null)[] = new Array(points.length).fill(null);
  await pool([...cells.values()], 3, async (idx: number[]) => {
    const p = points[idx[0]];
    let j: unknown = null;
    try {
      j = await cachedFetch('today:' + cell(p), HOUR, () => jget(todayUrl(p), { timeout: 12000 }));
    } catch {}
    for (const i of idx) out[i] = parseToday(j, points[i]);
  });
  return out;
}
