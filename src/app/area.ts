/**
 * Area mode (M5): the tiles that cover an outline, each sounded as a station
 * (app/sound) and then read as a whole field map with its rasters cell by
 * cell (engine/field, app/cells), a few at a time, summed into acres as they
 * land (engine/area).
 */
import { readCells } from './cells';
import { tick } from './sound';
import { STATE, fuseOpt } from './state';
import { merc, projector } from '../core/geo';
import type { LatLon, Station } from '../core/types';
import { imageryRaster } from '../data/imagery';
import { pool } from '../data/http';
import { MAX_TILES, sumArea, tileCentres } from '../engine/area';
import type { AreaSum } from '../engine/area';
import { FIELD_HALF, fieldFuse, fieldGeometry, fieldImageryGrid, fieldImageryStep } from '../engine/field';
import type { FieldMap, FieldRaster, GeoIndex } from '../engine/field';

type XY = [number, number];
export interface AreaState {
  runId: number;
  /** the outline and the tiles' centres, in metres around its first vertex */
  ring: XY[];
  centres: XY[];
  tiles: (FieldMap | null)[];
  sum: AreaSum | null;
  /** when the reading began, and when every tile was in (ms) */
  t0: number;
  t1: number | null;
}

/** the outline in local metres and the tiles over it; null until it has three vertices */
export function areaPlan(v: LatLon[]) {
  if (v.length < 3) return null;
  const P = projector(v[0].lat, v[0].lon),
    ring = v.map(p => P.fwd(p.lat, p.lon)) as XY[];
  return { P, ring, centres: tileCentres(ring) };
}
/** the stations for an area: one per tile, at its centre; none for an outline too big to read */
export function areaStations(v: LatLon[]): Station[] {
  const plan = areaPlan(v);
  if (!plan || plan.centres.length > MAX_TILES) return [];
  return plan.centres.map(([x, y], i) => {
    const [lat, lon] = plan.P.inv(x, y);
    return { lat, lon, d: i };
  });
}

/** begin a run's area: the outline and its tiles, nothing read yet */
export function startArea(id: number) {
  const plan = areaPlan(STATE.verts);
  STATE.area =
    plan && plan.centres.length <= MAX_TILES
      ? {
          runId: id,
          ring: plan.ring,
          centres: plan.centres,
          tiles: plan.centres.map(() => null),
          sum: null,
          t0: Date.now(),
          t1: null,
        }
      : null;
}

/** read every tile's field map once the stations' own sources are in, three at a time */
export async function readArea(id: number) {
  const A = STATE.area;
  if (!A || A.runId !== id) return;
  await pool(
    A.centres.map((_, t) => t),
    3,
    async (t: number) => {
      const r = STATE.results[t];
      if (id !== STATE.runId || !r || !r.geo) return;
      const G = r.geo as GeoIndex,
        F = fieldGeometry(G);
      let FI = null;
      try {
        const half = Math.ceil((FIELD_HALF + 14) / merc.mpp(r.station.lat, 18)) + 24,
          R = (await imageryRaster(r.station.lat, r.station.lon, half, [18])) as FieldRaster | null;
        if (R) {
          FI = fieldImageryGrid(R, G);
          while (!fieldImageryStep(FI, R, 50)) await new Promise(z => setTimeout(z, 0));
        }
      } catch {}
      const cells = await readCells(r).catch(() => null);
      if (id !== STATE.runId) return;
      fieldFuse(F, FI, r.sh, fuseOpt(), cells);
      A.tiles[t] = F;
      A.sum = sumArea(A.ring, A.centres, A.tiles);
      tick();
    },
  );
  if (id !== STATE.runId) return;
  A.sum = sumArea(A.ring, A.centres, A.tiles);
  A.t1 = Date.now();
  tick();
}
