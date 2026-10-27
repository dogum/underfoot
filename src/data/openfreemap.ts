import { merc, offset } from '../core/geo';
import { IDB, MEM, jget, remember } from './http';
import { decodeMVT } from './mvt';
import type { DecodedTile } from './mvt';
import type { LatLon } from '../core/types';

/* ---------------------------------------------------------------------------
 * OpenStreetMap via OpenFreeMap vector tiles.
 *
 * v1/v2 asked the Overpass API for every sounding. Two problems showed up:
 * public Overpass instances spend much of the day returning 504s, and the main
 * one now answers 406 to any page with Origin: null — which is exactly what a
 * file opened from disk sends. The same OSM data comes as versioned z14 vector
 * tiles from a CDN in well under a second, cached forever by URL.
 * ------------------------------------------------------------------------ */
export const OFM_Z = 14;
export const OFM_LAYERS = new Set([
  'building',
  'landcover',
  'landuse',
  'park',
  'water',
  'waterway',
  'transportation',
  'transportation_name',
  'aeroway',
]);
/* the template once known, and the request for it while one is out: asked once,
   not once per tile (Node has no localStorage, and tiles are asked four at a time) */
let known: { url: string; t: number } | null = null,
  asking: Promise<string> | null = null;
const fresh = (c: { t: number } | null) => !!c && Date.now() - c.t < 12 * 36e5;
/** the current tile URL template, as OpenFreeMap's TileJSON names it (kept for 12 hours) */
export async function ofmTemplate(): Promise<string> {
  if (known && fresh(known)) return known.url;
  let c = known;
  try {
    c = JSON.parse(localStorage.getItem('uf.ofm') || 'null') || c;
  } catch (e) {}
  if (c && fresh(c)) return (known = c).url;
  return (asking ??= (async () => {
    try {
      const j = await jget('https://tiles.openfreemap.org/planet', { timeout: 12000 });
      known = { url: j.tiles[0], t: Date.now() };
      try {
        localStorage.setItem('uf.ofm', JSON.stringify(known));
      } catch (e) {}
      return known.url;
    } catch (e) {
      if (c) return c.url;
      throw new Error('OpenFreeMap unreachable — ' + (e as Error).message);
    } finally {
      asking = null;
    }
  })());
}
export async function ofmTile(x: number, y: number): Promise<DecodedTile> {
  const tmpl = await ofmTemplate();
  const url = tmpl.replace('{z}', String(OFM_Z)).replace('{x}', String(x)).replace('{y}', String(y));
  const key = 'dec:' + url;
  if (MEM.has(key)) return MEM.get(key);
  const p = (async () => {
    let buf: ArrayBuffer | null = await IDB.get('ofm:' + url);
    if (!buf) {
      buf = await jget(url, { as: 'buf', timeout: 20000 });
      IDB.put('ofm:' + url, buf);
    }
    return decodeMVT(buf, OFM_Z, x, y);
  })();
  return remember(key, p);
}
/* every z14 tile touched by these points ± pad metres */
export function tilesFor(points: LatLon[], pad: number): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (const p of points) {
    for (const [dx, dy] of [
      [-pad, -pad],
      [pad, -pad],
      [-pad, pad],
      [pad, pad],
      [0, 0],
    ]) {
      const q = offset(p, dx, dy);
      const x = Math.floor(merc.x(q.lon, OFM_Z)),
        y = Math.floor(merc.y(q.lat, OFM_Z));
      out.set(x + '/' + y, [x, y]);
    }
  }
  return [...out.values()];
}
