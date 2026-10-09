/**
 * The newest Sentinel-2 pass (M4). Element 84's Earth Search (a STAC API)
 * finds the recent scenes over the stations, and each station's 20 m pixel is
 * read from the scene classification (SCL, a cloud-optimised GeoTIFF, by range
 * requests: data/cog). A pass with cloud, shadow or no data over a station is
 * passed over for the next older one, up to four passes and sixty days back;
 * a station clouded on all of them gets no class. Keyless and CORS-open.
 * Contains modified Copernicus Sentinel data.
 */
import { toUTM, zoneOf } from '../core/utm';
import type { LatLon, PassFacts } from '../core/types';
import { pixels } from './cog';
import { cachedFetch, jget } from './http';

const STAC = 'https://earth-search.aws.element84.com/v1/search';
export const PASS = {
  /** days back to look for a clear pass */
  maxDays: 60,
  /** scenes cloudier than this over their whole tile aren't tried */
  maxCloud: 80,
  /** passes tried at each station before giving up */
  tries: 4,
};
/** the scene classes that see the ground: vegetation, not vegetated, water, snow */
export const CLEAR = new Set([4, 5, 6, 11]);
const DAY = 864e5,
  HOURS6 = 6 * 36e5;

export interface Scene {
  id: string;
  /** ISO time of the pass */
  time: string;
  cloud: number;
  href: string;
  epsg: number;
  /** pixel size and origin: [size, 0, x0, 0, −size, y0] */
  transform: number[];
  /** footprint bounds: west, south, east, north */
  bbox: number[];
}

/** a STAC search's scenes that carry a readable scene classification, newest first (pure) */
export function parseScenes(j: unknown): Scene[] {
  const fs = ((j as { features?: unknown[] })?.features || []) as {
    id: string;
    bbox: number[];
    properties: Record<string, unknown>;
    assets: Record<string, { href: string; 'proj:transform'?: number[] }>;
  }[];
  return fs
    .map(f => ({
      id: f.id,
      time: String(f.properties?.datetime ?? ''),
      cloud: Number(f.properties?.['eo:cloud_cover'] ?? 100),
      href: f.assets?.scl?.href,
      epsg: Number(f.properties?.['proj:epsg']),
      transform: f.assets?.scl?.['proj:transform'] || [],
      bbox: f.bbox || [],
    }))
    .filter(s => s.href && zoneOf(s.epsg) && s.transform.length >= 6 && s.bbox.length === 4 && s.time)
    .sort((a, b) => (a.time < b.time ? 1 : -1));
}

/** the scene's pixel under a point, or null when it isn't in the footprint */
export function pixelOf(s: Scene, p: LatLon): { col: number; row: number } | null {
  const [w, so, e, n] = s.bbox,
    z = zoneOf(s.epsg);
  if (!z || p.lon < w || p.lon > e || p.lat < so || p.lat > n) return null;
  const { x, y } = toUTM(p.lat, p.lon, z.zone, z.south),
    t = s.transform;
  return { col: Math.floor((x - t[2]) / t[0]), row: Math.floor((y - t[5]) / t[4]) };
}

async function scenesFor(points: LatLon[], now: number): Promise<Scene[]> {
  const lats = points.map(p => p.lat),
    lons = points.map(p => p.lon),
    /* padded and rounded outward: a single point's box has no area, and the search refuses it */
    lo = (v: number) => Math.floor((v - 5e-4) * 1000) / 1000,
    hi = (v: number) => Math.ceil((v + 5e-4) * 1000) / 1000,
    bbox = [lo(Math.min(...lons)), lo(Math.min(...lats)), hi(Math.max(...lons)), hi(Math.max(...lats))],
    since = new Date(now - PASS.maxDays * DAY).toISOString().slice(0, 10);
  const j = await cachedFetch(`stac:${bbox.join(',')}:${since}`, HOURS6, () =>
    jget(STAC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox,
        datetime: `${since}T00:00:00Z/..`,
        query: { 'eo:cloud_cover': { lt: PASS.maxCloud } },
        sortby: [{ field: 'properties.datetime', direction: 'desc' }],
        limit: 40,
      }),
      timeout: 12000,
    }),
  );
  return parseScenes(j);
}

/** each station's newest clear pass; null where no scene covers it or the search failed */
export async function passFor(points: LatLon[], now = Date.now()): Promise<(PassFacts | null)[]> {
  let scenes: Scene[] = [];
  try {
    scenes = await scenesFor(points, now);
  } catch {
    return points.map(() => null);
  }
  const out: (PassFacts | null)[] = points.map(() => null),
    skipped: string[][] = points.map(() => []),
    /* the scenes over each station, one per day: where two tiles overlap, a pass is one observation */
    tries = points.map(p => {
      const days = new Set<string>();
      return scenes
        .filter(s => pixelOf(s, p) && !days.has(s.time.slice(0, 10)) && days.add(s.time.slice(0, 10)))
        .slice(0, PASS.tries);
    }),
    date = (s: Scene) => s.time.slice(0, 10),
    facts = (s: Scene, scl: number | null, i: number): PassFacts => ({
      id: s.id,
      date: date(s),
      days: (now - Date.parse(s.time)) / DAY,
      scl,
      skipped: skipped[i],
      scene: { href: s.href, epsg: s.epsg, transform: s.transform, bbox: s.bbox },
    });
  /* round k reads each unresolved station's k-th scene; stations sharing a scene share its tiles */
  for (let k = 0; k < PASS.tries; k++) {
    const by = new Map<Scene, number[]>();
    points.forEach((_, i) => {
      const s = tries[i][k];
      if (s && !out[i]) by.set(s, [...(by.get(s) || []), i]);
    });
    if (!by.size) break;
    await Promise.all(
      [...by].map(async ([s, idx]) => {
        let v: (number | null)[] = [];
        try {
          v = await pixels(
            s.href,
            idx.map(i => pixelOf(s, points[i])!),
          );
        } catch {}
        idx.forEach((i, j) => {
          if (v[j] != null && CLEAR.has(v[j]!)) out[i] = facts(s, v[j], i);
          else skipped[i].push(date(s));
        });
      }),
    );
  }
  /* clouded on every pass tried: say so, dated to the newest */
  points.forEach((_, i) => {
    if (!out[i] && tries[i].length) out[i] = facts(tries[i][0], null, i);
  });
  return out;
}

/** the scene class at other points, from the pass a station was read from (its tiles are already here) */
export async function passPixelsAt(p: PassFacts, pts: LatLon[]): Promise<(number | null)[]> {
  if (!p.scene) return pts.map(() => null);
  const s = { ...p.scene, id: p.id, time: p.date, cloud: 0 } as Scene,
    at = pts.map(q => pixelOf(s, q));
  const idx = at.flatMap((a, i) => (a ? [i] : []));
  const out: (number | null)[] = pts.map(() => null);
  if (!idx.length) return out;
  try {
    const v = await pixels(
      s.href,
      idx.map(i => at[i]!),
    );
    idx.forEach((i, k) => (out[i] = v[k]));
  } catch {}
  return out;
}
