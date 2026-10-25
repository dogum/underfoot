/**
 * Area mode (M5): the tiles that cover an outline, each sounded as a station
 * (app/sound) and then read as a whole field map with its rasters cell by
 * cell (sounding/field), a few at a time, summed into acres as they
 * land (engine/area).
 */
import { readField } from '../sounding/field';
import { areaPlan, areaStations } from '../sounding/area';
import { tick } from './sound';
import { STATE, fuseOpt } from './state';
import { pool } from '../data/http';
import { MAX_TILES, sumArea } from '../engine/area';
import type { AreaSum } from '../engine/area';
import type { FieldMap } from '../engine/field';

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

export { areaPlan, areaStations };

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
      const F = await readField(r, fuseOpt(), () => id === STATE.runId);
      if (!F) return;
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
