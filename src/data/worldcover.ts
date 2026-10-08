/**
 * World cover (M5): the class of Impact Observatory's 10 m land cover under
 * each station, from Esri's keyless, CORS-open image service. One request
 * samples every station at once (getSamples on a multipoint, posted as a
 * form so it's a simple request and a long line fits). The newest year's map
 * is read, and a line's answer is cached for 30 days: the map changes yearly.
 */
import type { LatLon, WorldFacts } from '../core/types';
import { DAY, cachedFetch, jget } from './http';

export const WORLD_URL =
  'https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/getSamples';

/** ~10 m: a pixel's worth, for the cache key */
const q = (v: number) => v.toFixed(4);

/** the service's samples as facts per point, in order; null where it gave none (pure) */
export function parseSamples(j: unknown, n: number): (WorldFacts | null)[] {
  const out: (WorldFacts | null)[] = new Array(n).fill(null);
  const s = (j as { samples?: unknown[] })?.samples;
  if (!Array.isArray(s)) return out;
  for (const x of s as { locationId?: number; value?: string; attributes?: { Year?: number } }[]) {
    const i = Number(x?.locationId),
      code = Number(x?.value);
    if (Number.isInteger(i) && i >= 0 && i < n && Number.isFinite(code))
      out[i] = { code, year: Number(x.attributes?.Year) || 0 };
  }
  return out;
}

/** the global land cover class under each point; null where the service couldn't answer */
export async function worldCoverFor(points: LatLon[]): Promise<(WorldFacts | null)[]> {
  if (!points.length) return [];
  const pts = points.map(p => [+q(p.lon), +q(p.lat)]);
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: pts, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'true',
    outFields: 'Year',
    f: 'json',
  });
  try {
    const j = await cachedFetch('world:' + pts.join(';'), 30 * DAY, async () => {
      const r = await jget(WORLD_URL, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
      /* the service reports errors in a 200 reply: don't keep those for a month */
      if (!Array.isArray(r?.samples)) throw new Error(r?.error?.message || 'no samples');
      return r;
    });
    return parseSamples(j, points.length);
  } catch {
    return new Array(points.length).fill(null);
  }
}
