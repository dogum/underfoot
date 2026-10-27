/**
 * A station's whole field map, read at once: its 2 m cells' geometry, the
 * imagery read on a 4 m lattice, each cell's rasters (sounding/cells), fused.
 * An area reads one per tile; the headless reader one for a GPS disc. The
 * app's field for the station in focus is read progressively instead
 * (app/field), so the page stays responsive while it fills in.
 */
import { merc } from '../core/geo';
import { pool } from '../data/http';
import { imageryRaster } from '../data/imagery';
import { sumArea } from '../engine/area';
import { FIELD_HALF, fieldFuse, fieldGeometry, fieldImageryGrid, fieldImageryStep } from '../engine/field';
import type { FieldMap, FieldRaster } from '../engine/field';
import type { AreaTiles } from './area';
import { readCells } from './cells';
import { fuseOpt } from './run';
import type { Run } from './run';
import type { FuseOptions, StationResult } from '../core/types';

/** the field map around a station once its own sources are in; null without geometry, or if `live` turns false */
export async function readField(
  r: StationResult,
  opt: FuseOptions,
  live: () => boolean = () => true,
): Promise<FieldMap | null> {
  if (!r.geo) return null;
  const G = r.geo,
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
  if (!live()) return null;
  const cells = await readCells(r).catch(() => null);
  if (!live()) return null;
  fieldFuse(F, FI, r.sh, opt, cells);
  return F;
}

/** an area's tiles, each the field map around its station once the stations' own sources are in, three at a time, summed as they land */
export async function readTiles(run: Run, A: AreaTiles, live: () => boolean, landed: () => void = () => {}) {
  await pool(
    A.centres.map((_, t) => t),
    3,
    async (t: number) => {
      const r = run.results[t];
      if (!live() || !r || !r.geo) return;
      const F = await readField(r, fuseOpt(run), live);
      if (!F) return;
      A.tiles[t] = F;
      A.sum = sumArea(A.ring, A.centres, A.tiles);
      landed();
    },
    live,
  );
  if (live()) A.sum = sumArea(A.ring, A.centres, A.tiles);
}
