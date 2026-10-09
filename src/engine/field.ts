/**
 * The field map: the engine evaluated on a 2 m grid around a station, and
 * positional(), the answer averaged under a GPS error disc. Pure.
 *
 * Once the tiles, footprints and imagery for a station are local, the engine
 * is a function of position, so it's evaluated on a 2 m grid across 120 m:
 * the engine's own picture of the neighbourhood, and what makes GPS
 * uncertainty computable. Polygons, lines, footprints and imagery vary cell by
 * cell. So do the rasters (NLCD land cover and canopy, World cover, the newest
 * pass) once they've been read around the station (app/cells); until then a
 * cell takes the station's reading. Terrain, today's weather and the
 * gazetteer always hold the station's value: they don't vary within 120 m, or
 * can't be asked cell by cell.
 */
import { K } from '../core/classes';
import { merc } from '../core/geo';
import type { Projector } from '../core/geo';
import { zeros } from '../core/math';
import type {
  ClassKey,
  FuseOptions,
  GeoQuery,
  Parts,
  SourceId,
  SourcePart,
  StationFacts,
} from '../core/types';
import {
  srcCanopy,
  srcContain,
  srcCover,
  srcGaz,
  srcImage,
  srcProx,
  srcStruct,
  srcTerrain,
} from './evidence';
import { FLOORED, applyFloor, fuseParts, plausibleTreads } from './fuse';
import { geoAt } from './geometry';
import { imgFeatures } from './imagery-model';
import { srcPass } from './sentinel';
import { srcToday } from './today';
import { srcWorld } from './worldcover';

export const FIELD_HALF = 60,
  FIELD_CELL = 2,
  FIELD_N = (FIELD_HALF * 2) / FIELD_CELL;

export interface FieldMap {
  N: number;
  /** each cell's geometry query, row by row from the north-west */
  qs: GeoQuery[];
  /** each cell's probabilities, K.length per cell */
  probs: Float32Array;
  /** each cell's map-based parts, computed once a run */
  geo?: { contain: SourcePart; prox: SourcePart; struct: SourcePart; plaus: Map<ClassKey, number> }[];
  /** imagery parts on the coarser lattice, filled in as they're scored */
  img?: (SourcePart | null)[];
}
/** a raster of orthoimagery around the station (data/imagery imageryRaster) */
export interface FieldRaster {
  z: number;
  x0: number;
  y0: number;
  W: number;
  data: { data: Uint8ClampedArray };
}
export interface FieldImagery {
  step: number;
  M: number;
  pts: { i: number; j: number; px: number; py: number }[];
  feats: (unknown | null)[];
  next: number;
}
/** what the rasters say under each cell, once they've been read around the station (app/cells) */
export interface FieldCells {
  /** for each cell, which of `facts` it takes */
  at: Uint16Array;
  /** the distinct readings; each replaces the station's facts of the same names for its cells */
  facts: StationFacts[];
}

/** a cell's centre, in metres east and north of the station */
export const cellXY = (i: number, j: number): [number, number] => [
  -FIELD_HALF + (i + 0.5) * FIELD_CELL,
  FIELD_HALF - (j + 0.5) * FIELD_CELL,
];

/** the projected map around the station (engine/geometry buildGeo) */
export type GeoIndex = { P: Projector } & Record<string, unknown>;

export function fieldGeometry(G: GeoIndex, _sh?: StationFacts, _opt?: FuseOptions): FieldMap {
  const N = FIELD_N,
    probs = new Float32Array(N * N * K.length),
    qs = new Array<GeoQuery>(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const [x, y] = cellXY(i, j);
      qs[j * N + i] = geoAt(G, x, y, false);
    }
  return { N, qs, probs };
}
/* imagery log-likelihoods on a coarser 4 m lattice, filled in progressively */
export function fieldImageryGrid(R: FieldRaster, G: GeoIndex): FieldImagery {
  const step = 4,
    M = Math.round((FIELD_HALF * 2) / step),
    pts: FieldImagery['pts'] = [];
  for (let j = 0; j < M; j++)
    for (let i = 0; i < M; i++) {
      const x = -FIELD_HALF + (i + 0.5) * step,
        y = FIELD_HALF - (j + 0.5) * step;
      const [lat, lon] = G.P.inv(x, y);
      const px = Math.round(merc.x(lon, R.z) * 256 - R.x0),
        py = Math.round(merc.y(lat, R.z) * 256 - R.y0);
      pts.push({ i, j, px, py });
    }
  return { step, M, pts, feats: new Array(M * M).fill(null), next: 0 };
}
export function fieldImageryStep(FI: FieldImagery, R: FieldRaster, budgetMs = 12): boolean {
  const t0 = performance.now();
  while (FI.next < FI.pts.length && performance.now() - t0 < budgetMs) {
    const p = FI.pts[FI.next++];
    if (p.px >= 24 && p.py >= 24 && p.px < R.W - 24 && p.py < R.W - 24)
      FI.feats[p.j * FI.M + p.i] = imgFeatures(R.data.data, R.W, p.px, p.py);
  }
  return FI.next >= FI.pts.length;
}

/** the sources that come from rasters and models rather than the map, read for one set of facts */
const coarse = (sh: StationFacts): Parts =>
  ({
    cover: srcCover(sh),
    canopy: srcCanopy(sh),
    terrain: srcTerrain(sh),
    gaz: srcGaz(sh),
    today: srcToday(sh),
    pass: srcPass(sh),
    world: srcWorld(sh),
  }) as Parts;

export function fieldFuse(
  F: FieldMap,
  FI: FieldImagery | null,
  sh: StationFacts,
  opt: FuseOptions,
  cells?: FieldCells | null,
): FieldMap {
  /* geometry never changes within a run, and each imagery cell is scored once;
     only the coarse sources and the weights vary between calls, so re-fusing
     after a slider move is just arithmetic */
  const N = F.N,
    shL = { ...sh, lite: true },
    optL = { ...opt, lite: true as const };
  if (!F.geo)
    F.geo = F.qs.map(q => ({
      contain: srcContain(shL, q) as SourcePart,
      prox: srcProx(shL, q) as SourcePart,
      struct: srcStruct(shL, q) as SourcePart,
      plaus: plausibleTreads(q),
    }));
  if (FI) {
    const img = (F.img = F.img || new Array(FI.M * FI.M).fill(null));
    for (let c = 0; c < FI.feats.length; c++)
      if (FI.feats[c] && !img[c]) img[c] = srcImage(shL, FI.feats[c]) as SourcePart;
  }
  /* the station's readings, and each distinct reading of the rasters around it */
  const station = coarse(shL),
    byFact = cells ? cells.facts.map(f => coarse({ ...shL, ...f })) : null;
  const NA: SourcePart = { ll: zeros(), status: 'na' };
  let k = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++, k++) {
      const g = F.geo[k];
      let im = NA;
      if (FI && F.img) {
        const ii = Math.min(FI.M - 1, Math.floor((i * FIELD_CELL) / FI.step)),
          jj = Math.min(FI.M - 1, Math.floor((j * FIELD_CELL) / FI.step));
        im = F.img[jj * FI.M + ii] || NA;
      }
      const parts: Parts = {
        contain: g.contain,
        prox: g.prox,
        struct: g.struct,
        image: im,
        ...(byFact && cells ? byFact[cells.at[k]] : station),
      };
      if (g.plaus.size)
        for (const id of FLOORED as SourceId[]) {
          const r = parts[id];
          if (r && r.status === 'ok') parts[id] = { ...r, ll: applyFloor(r.ll, g.plaus) };
        }
      const f = fuseParts(parts, optL);
      for (let c = 0; c < K.length; c++) F.probs[k * K.length + c] = f.p[c];
    }
  return F;
}
export function fieldCellAt(F: FieldMap, x: number, y: number): number[] | null {
  const i = Math.floor((x + FIELD_HALF) / FIELD_CELL),
    j = Math.floor((FIELD_HALF - y) / FIELD_CELL);
  if (i < 0 || j < 0 || i >= F.N || j >= F.N) return null;
  const k = j * F.N + i;
  return Array.from(F.probs.subarray(k * K.length, (k + 1) * K.length));
}
/* P(class) when the coordinate itself is only good to ±sigma metres */
export function positional(F: FieldMap | null | undefined, sigma: number): number[] | null {
  if (!F || !sigma) return null;
  const acc = new Float64Array(K.length);
  let wsum = 0;
  for (let j = 0; j < F.N; j++)
    for (let i = 0; i < F.N; i++) {
      const [x, y] = cellXY(i, j),
        r2 = x * x + y * y;
      if (r2 > 9 * sigma * sigma) continue;
      const w = Math.exp(-r2 / (2 * sigma * sigma));
      wsum += w;
      const k = j * F.N + i;
      for (let c = 0; c < K.length; c++) acc[c] += w * F.probs[k * K.length + c];
    }
  return wsum > 0 ? Array.from(acc, v => v / wsum) : null;
}
