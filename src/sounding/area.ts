/**
 * An area's plan: the outline in local metres and the 120 m tiles over it,
 * each read as a station (engine/area). Pure.
 */
import { projector } from '../core/geo';
import { MAX_TILES, tileCentres } from '../engine/area';
import type { AreaSum } from '../engine/area';
import type { FieldMap } from '../engine/field';
import type { LatLon, Station } from '../core/types';

type XY = [number, number];

/** the outline in local metres and the tiles over it (null centres: more than MAX_TILES); null until it has three vertices */
export function areaPlan(v: LatLon[]) {
  if (v.length < 3) return null;
  const P = projector(v[0].lat, v[0].lon),
    ring = v.map(p => P.fwd(p.lat, p.lon)) as XY[];
  return { P, ring, centres: tileCentres(ring, MAX_TILES) };
}
/** the stations for an area: one per tile, at its centre; none for an outline too big to read */
export function areaStations(v: LatLon[]): Station[] {
  const plan = areaPlan(v);
  if (!plan?.centres) return [];
  const P = plan.P;
  return plan.centres.map(([x, y], i) => {
    const [lat, lon] = P.inv(x, y);
    return { lat, lon, d: i };
  });
}

/** an area being read: its outline and tiles, each tile's field map once it lands, and the sum so far */
export interface AreaTiles {
  ring: XY[];
  centres: XY[];
  tiles: (FieldMap | null)[];
  sum: AreaSum | null;
}
/** an area with nothing read yet; null for an outline too small or too big to read */
export function newArea(v: LatLon[]): AreaTiles | null {
  const plan = areaPlan(v);
  if (!plan?.centres) return null;
  return { ring: plan.ring, centres: plan.centres, tiles: plan.centres.map(() => null), sum: null };
}
