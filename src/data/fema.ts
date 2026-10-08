// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * FEMA USA Structures: authoritative US building footprints.
 */
import { offset } from '../core/geo';
import { DAY, cachedFetch, jget, pool } from './http';

/* ------------------------------------------------- FEMA USA Structures */
/* Authoritative US building footprints (structures over ~450 sq ft), with
   occupancy class and height. Fetched in fixed 0.004° cells so every cell is
   cached on its own and reused by any later sounding nearby. */
export const STRUCT_CELL = 0.004;
export async function structCell(cx, cy) {
  const w = cx * STRUCT_CELL,
    s = cy * STRUCT_CELL,
    e = w + STRUCT_CELL,
    n = s + STRUCT_CELL;
  return cachedFetch(`st:${cx}:${cy}`, 30 * DAY, async () => {
    const u =
      'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query' +
      `?geometry=${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}&geometryType=esriGeometryEnvelope&inSR=4326` +
      '&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,OCC_CLS,PRIM_OCC,HEIGHT,SQFEET' +
      '&returnGeometry=true&outSR=4326&geometryPrecision=7&resultRecordCount=2000&f=json';
    const j = await jget(u, { timeout: 20000 });
    if (j.error) throw new Error(j.error.message || 'structures error');
    return (j.features || []).map(f => ({
      id: f.attributes.OBJECTID,
      a: f.attributes,
      r: ((f.geometry && f.geometry.rings) || []).map(r => r.flat()),
    }));
  });
}
export async function structuresFor(points, pad) {
  const cells = new Map();
  for (const p of points)
    for (const [dx, dy] of [
      [-pad, -pad],
      [pad, -pad],
      [-pad, pad],
      [pad, pad],
    ]) {
      const q = offset(p, dx, dy);
      const cx = Math.floor(q.lon / STRUCT_CELL),
        cy = Math.floor(q.lat / STRUCT_CELL);
      cells.set(cx + ':' + cy, [cx, cy]);
    }
  const got = await pool([...cells.values()], 4, ([cx, cy]) => structCell(cx, cy));
  if (got.some(g => g == null)) throw new Error('some footprint cells failed');
  const seen = new Set(),
    out = [];
  for (const list of got)
    for (const f of list)
      if (!seen.has(f.id)) {
        seen.add(f.id);
        out.push(f);
      }
  return out;
}
