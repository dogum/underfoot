/**
 * The rasters around a station, cell by cell, for its field map
 * (engine/field): NLCD's four rasters through MRLC's coverage service where
 * NLCD answers, World cover on a 10 m grid where it doesn't, and the newest
 * pass's scene classes from the tile the station already read. Each 2 m cell
 * takes the readings under it, and cells with the same readings share them,
 * so the FIELD layer and area mode see a road 40 m from the station as the
 * road it is, not as the station's forest.
 */
import { FIELD_HALF, FIELD_N, cellXY } from '../engine/field';
import type { FieldCells, GeoIndex } from '../engine/field';
import { SCL } from '../engine/sentinel';
import { nlcdAt, nlcdGrids } from '../data/nlcdgrid';
import { passPixelsAt } from '../data/sentinel';
import { worldCoverFor } from '../data/worldcover';
import type { LatLon, PassFacts, StationFacts, StationResult, WorldFacts } from '../core/types';

/** m: World cover and the pass are read on a grid this fine (their pixels are 10 m and 20 m) */
const STEP = 10,
  M = (FIELD_HALF * 2) / STEP;

/** whether the station's own readings are in, so the cells know which rasters to read */
export const cellsReady = (sh: StationFacts) =>
  sh.nlcd !== undefined &&
  sh.pass !== undefined &&
  (sh.world !== undefined || (sh.conus && sh.nlcd?.code != null));

export async function readCells(r: StationResult): Promise<FieldCells | null> {
  const sh = r.sh,
    G = r.geo as GeoIndex,
    N = FIELD_N,
    pass = sh.pass as PassFacts | null | undefined,
    world = sh.world as WorldFacts | null | undefined;
  const useNlcd = !!(sh.conus && sh.nlcd && sh.nlcd.code != null),
    useWorld = !useNlcd && !!world,
    usePass = !!(pass && pass.scl != null && SCL[pass.scl] && pass.scene);
  if (!useNlcd && !useWorld && !usePass) return null;
  /* the 10 m sample grid, centred in the field's cells */
  const grid: LatLon[] = [];
  for (let b = 0; b < M; b++)
    for (let a = 0; a < M; a++) {
      const [lat, lon] = G.P.inv(-FIELD_HALF + (a + 0.5) * STEP, FIELD_HALF - (b + 0.5) * STEP);
      grid.push({ lat, lon });
    }
  const [grids, wc, scl] = await Promise.all([
    useNlcd ? nlcdGrids(r.station.lat, r.station.lon, FIELD_HALF + 15) : null,
    useWorld ? worldCoverFor(grid) : null,
    usePass ? passPixelsAt(pass!, grid) : null,
  ]);
  const at = new Uint16Array(N * N),
    facts: StationFacts[] = [],
    seen = new Map<string, number>();
  let k = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++, k++) {
      const [x, y] = cellXY(i, j),
        s = Math.floor((FIELD_HALF - y) / STEP) * M + Math.floor((x + FIELD_HALF) / STEP),
        f: StationFacts = {};
      if (grids) {
        const [lat, lon] = G.P.inv(x, y),
          n = nlcdAt(grids, lat, lon);
        if (n.code != null) f.nlcd = n;
      }
      if (wc?.[s]) f.world = wc[s];
      /* a clouded pixel keeps the station's clear one */
      const v = scl?.[s];
      if (v != null && SCL[v]) f.pass = { ...pass, scl: v };
      const key = JSON.stringify([
        f.nlcd && [f.nlcd.code, f.nlcd.canopy, f.nlcd.imperv, f.nlcd.desc],
        f.world?.code,
        f.pass?.scl,
      ]);
      let n = seen.get(key);
      if (n == null) {
        n = facts.push(f) - 1;
        seen.set(key, n);
      }
      at[k] = n;
    }
  return { at, facts };
}
