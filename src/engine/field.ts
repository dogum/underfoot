// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The field map: the engine evaluated on a 2 m grid around a station, and
 * positional(), the answer averaged under a GPS error disc. Pure.
 */
import { K } from '../core/classes';
import { merc } from '../core/geo';
import { zeros } from '../core/math';
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
import { applyFloor, fuseParts, plausibleTreads } from './fuse';
import { geoAt } from './geometry';
import { imgFeatures } from './imagery-model';

/* ---- the field map ---------------------------------------------------------
 * Once the tiles, footprints and imagery for a station are local, the engine
 * is just a function of position — so evaluate it on a 2 m grid around the
 * station. Coarse sources (rasters, terrain, gazetteer) hold their station
 * values; polygons, lines, footprints and imagery vary cell by cell. The
 * result is the engine's own picture of the neighbourhood, and the thing that
 * makes GPS uncertainty computable. */
export const FIELD_HALF = 60,
  FIELD_CELL = 2,
  FIELD_N = (FIELD_HALF * 2) / FIELD_CELL;
export function fieldGeometry(G, sh, opt) {
  const N = FIELD_N,
    probs = new Float32Array(N * N * K.length),
    qs = new Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = -FIELD_HALF + (i + 0.5) * FIELD_CELL,
        y = FIELD_HALF - (j + 0.5) * FIELD_CELL;
      qs[j * N + i] = geoAt(G, x, y, false);
    }
  return { N, qs, probs, imgLL: null, done: false };
}
/* imagery log-likelihoods on a coarser 4 m lattice, filled in progressively */
export function fieldImageryGrid(R, G) {
  // R: raster around the station (imageryRaster with a large halfPx)
  const step = 4,
    M = Math.round((FIELD_HALF * 2) / step),
    pts = [];
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
export function fieldImageryStep(FI, R, budgetMs = 12) {
  const t0 = performance.now();
  while (FI.next < FI.pts.length && performance.now() - t0 < budgetMs) {
    const p = FI.pts[FI.next++];
    if (p.px >= 24 && p.py >= 24 && p.px < R.W - 24 && p.py < R.W - 24)
      FI.feats[p.j * FI.M + p.i] = imgFeatures(R.data.data, R.W, p.px, p.py);
  }
  return FI.next >= FI.pts.length;
}
export function fieldFuse(F, FI, sh, opt) {
  /* geometry never changes within a run, and each imagery cell is scored once;
     only the coarse station-level sources and the weights vary between calls,
     so re-fusing after a slider move is just arithmetic */
  const N = F.N,
    shL = { ...sh, lite: true },
    optL = { ...opt, lite: true };
  if (!F.geo)
    F.geo = F.qs.map(q => ({
      contain: srcContain(shL, q),
      prox: srcProx(shL, q),
      struct: srcStruct(shL, q),
      plaus: plausibleTreads(q),
    }));
  if (FI) {
    F.img = F.img || new Array(FI.M * FI.M).fill(null);
    for (let c = 0; c < FI.feats.length; c++)
      if (FI.feats[c] && !F.img[c]) F.img[c] = srcImage(shL, FI.feats[c]);
  }
  const cst = { cover: srcCover(shL), canopy: srcCanopy(shL), terrain: srcTerrain(shL), gaz: srcGaz(shL) };
  const NA = { ll: zeros(), status: 'na' };
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
      const parts = { contain: g.contain, prox: g.prox, struct: g.struct, image: im, ...cst };
      if (g.plaus.size) {
        const pl = {};
        for (const id of ['contain', 'image', 'cover', 'canopy']) {
          const r = parts[id];
          pl[id] = r.status === 'ok' ? { ...r, ll: applyFloor(r.ll, g.plaus) } : r;
        }
        Object.assign(parts, pl);
      }
      const f = fuseParts(parts, optL);
      for (let c = 0; c < K.length; c++) F.probs[k * K.length + c] = f.p[c];
    }
  return F;
}
export function fieldCellAt(F, x, y) {
  const i = Math.floor((x + FIELD_HALF) / FIELD_CELL),
    j = Math.floor((FIELD_HALF - y) / FIELD_CELL);
  if (i < 0 || j < 0 || i >= F.N || j >= F.N) return null;
  const k = j * F.N + i;
  return Array.from(F.probs.subarray(k * K.length, (k + 1) * K.length));
}
/* P(class) when the coordinate itself is only good to ±sigma metres */
export function positional(F, sigma) {
  if (!F || !sigma) return null;
  const acc = new Float64Array(K.length);
  let wsum = 0;
  for (let j = 0; j < F.N; j++)
    for (let i = 0; i < F.N; i++) {
      const x = -FIELD_HALF + (i + 0.5) * FIELD_CELL,
        y = FIELD_HALF - (j + 0.5) * FIELD_CELL,
        r2 = x * x + y * y;
      if (r2 > 9 * sigma * sigma) continue;
      const w = Math.exp(-r2 / (2 * sigma * sigma));
      wsum += w;
      const k = j * F.N + i;
      for (let c = 0; c < K.length; c++) acc[c] += w * F.probs[k * K.length + c];
    }
  return wsum > 0 ? Array.from(acc, v => v / wsum) : null;
}
