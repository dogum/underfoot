/**
 * Area mode (M5): the tiles that cover an outline, each sounded as a station
 * (app/sound) and then read as a whole field map with its rasters cell by
 * cell (sounding/field), a few at a time, summed into acres as they
 * land (engine/area).
 */
import { readTiles } from '../sounding/field';
import { areaPlan, areaStations, newArea } from '../sounding/area';
import type { AreaTiles } from '../sounding/area';
import { tick } from './sound';
import { STATE } from './state';

export interface AreaState extends AreaTiles {
  runId: number;
  /** when the reading began, and when every tile was in (ms) */
  t0: number;
  t1: number | null;
}

export { areaPlan, areaStations };

/** begin a run's area: the outline and its tiles, nothing read yet */
export function startArea(id: number) {
  const A = newArea(STATE.verts);
  STATE.area = A ? { ...A, runId: id, t0: Date.now(), t1: null } : null;
}

/** read every tile's field map once the stations' own sources are in */
export async function readArea(id: number) {
  const A = STATE.area;
  if (!A || A.runId !== id) return;
  const live = () => id === STATE.runId;
  await readTiles(STATE, A, live, tick);
  if (!live()) return;
  A.t1 = Date.now();
  tick();
}
