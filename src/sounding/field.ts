/**
 * A station's whole field map, read at once: its 2 m cells' geometry, the
 * imagery read on a 4 m lattice, each cell's rasters (sounding/cells), fused.
 * Area mode reads one per tile; the headless reader one for a GPS disc. The
 * app's field for the station in focus is read progressively instead
 * (app/field), so the page stays responsive while it fills in.
 */
import { merc } from '../core/geo';
import { imageryRaster } from '../data/imagery';
import { FIELD_HALF, fieldFuse, fieldGeometry, fieldImageryGrid, fieldImageryStep } from '../engine/field';
import type { FieldMap, FieldRaster } from '../engine/field';
import { readCells } from './cells';
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
  const cells = await readCells(r).catch(() => null);
  if (!live()) return null;
  fieldFuse(F, FI, r.sh, opt, cells);
  return F;
}
