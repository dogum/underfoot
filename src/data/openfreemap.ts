// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
import { merc, offset } from '../core/geo';
import { IDB, MEM, jget } from './http';
import { decodeMVT } from './mvt';

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
export async function ofmTemplate() {
  let c = null;
  try {
    c = JSON.parse(localStorage.getItem('uf.ofm') || 'null');
  } catch (e) {}
  if (c && Date.now() - c.t < 12 * 36e5) return c.url;
  try {
    const j = await jget('https://tiles.openfreemap.org/planet', { timeout: 12000 });
    const url = j.tiles[0];
    try {
      localStorage.setItem('uf.ofm', JSON.stringify({ url, t: Date.now() }));
    } catch (e) {}
    return url;
  } catch (e) {
    if (c) return c.url;
    throw new Error('OpenFreeMap unreachable — ' + e.message);
  }
}
export async function ofmTile(x, y) {
  const tmpl = await ofmTemplate();
  const url = tmpl.replace('{z}', OFM_Z).replace('{x}', x).replace('{y}', y);
  const key = 'dec:' + url;
  if (MEM.has(key)) return MEM.get(key);
  const p = (async () => {
    let buf = await IDB.get('ofm:' + url);
    if (!buf) {
      buf = await jget(url, { as: 'buf', timeout: 20000 });
      IDB.put('ofm:' + url, buf);
    }
    return decodeMVT(buf, OFM_Z, x, y);
  })();
  MEM.set(key, p);
  p.catch(() => MEM.delete(key));
  return p;
}
/* every z14 tile touched by these points ± pad metres */
export function tilesFor(points, pad) {
  const out = new Map();
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
