/**
 * Area mode (M5): an outline drawn on the map, covered with 120 m field maps
 * (engine/field), and summed into acres per class. Pure.
 *
 * Each tile is a field map of 2 m cells centred on a station. A cell counts
 * when its centre is inside the outline. The cells give each class's share;
 * the outline's own area gives the total, so the classes always sum to it.
 */
import { K } from '../core/classes';
import { FIELD_HALF, FIELD_N, cellXY } from './field';
import type { FieldMap } from './field';

/** m: a tile is one field map across */
export const TILE = FIELD_HALF * 2;
/** the most tiles one outline may take: about 92 ha, or 228 acres */
export const MAX_TILES = 64;
export const ACRE = 4046.8564224;

type XY = [number, number];

/** the outline's area, m² (shoelace, in local metres) */
export function ringArea(r: XY[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i],
      [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
/** whether a point is inside the outline (even-odd) */
export function inRing(x: number, y: number, r: XY[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i],
      [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const cross = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentsMeet(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
/** whether a tile's square and the outline share any ground */
function tileMeets(cx: number, cy: number, r: XY[]): boolean {
  const h = TILE / 2,
    sq: XY[] = [
      [cx - h, cy - h],
      [cx + h, cy - h],
      [cx + h, cy + h],
      [cx - h, cy + h],
    ];
  if (sq.some(([x, y]) => inRing(x, y, r))) return true;
  if (r.some(([x, y]) => x >= cx - h && x <= cx + h && y >= cy - h && y <= cy + h)) return true;
  for (let i = 0; i < r.length; i++)
    for (let k = 0; k < 4; k++)
      if (segmentsMeet(r[i], r[(i + 1) % r.length], sq[k], sq[(k + 1) % 4])) return true;
  return false;
}
/** the centres of the tiles that cover the outline, on a grid from its south-west corner */
export function tileCentres(r: XY[]): XY[] {
  const xs = r.map(p => p[0]),
    ys = r.map(p => p[1]),
    x0 = Math.min(...xs),
    y0 = Math.min(...ys),
    nx = Math.max(1, Math.ceil((Math.max(...xs) - x0) / TILE)),
    ny = Math.max(1, Math.ceil((Math.max(...ys) - y0) / TILE));
  const out: XY[] = [];
  for (let b = 0; b < ny; b++)
    for (let a = 0; a < nx; a++) {
      const c: XY = [x0 + TILE / 2 + a * TILE, y0 + TILE / 2 + b * TILE];
      if (tileMeets(c[0], c[1], r)) out.push(c);
    }
  return out;
}

export interface AreaSum {
  /** the outline's area, m² */
  m2: number;
  /** cells of 2 m inside it that have been read, and how many there will be */
  cells: number;
  expectedCells: number;
  /** m² of each class, by its probability in each cell, scaled to the outline's area */
  byClass: number[];
  /** m² of each class by the cells' calls (the mosaic), scaled the same way */
  mosaic: number[];
}
/** acres per class from the tiles read so far; `tiles[i]` is centred at `centres[i]`, null until read */
export function sumArea(r: XY[], centres: XY[], tiles: (FieldMap | null)[]): AreaSum {
  const m2 = ringArea(r),
    byClass = new Array(K.length).fill(0),
    mosaic = new Array(K.length).fill(0);
  let cells = 0,
    expectedCells = 0;
  centres.forEach(([cx, cy], t) => {
    const F = tiles[t];
    for (let j = 0; j < FIELD_N; j++)
      for (let i = 0; i < FIELD_N; i++) {
        const [x, y] = cellXY(i, j);
        if (!inRing(cx + x, cy + y, r)) continue;
        expectedCells++;
        if (!F) continue;
        cells++;
        const k = (j * FIELD_N + i) * K.length;
        let best = 0;
        for (let c = 0; c < K.length; c++) {
          byClass[c] += F.probs[k + c];
          if (F.probs[k + c] > F.probs[k + best]) best = c;
        }
        mosaic[best]++;
      }
  });
  /* shares from the cells read, total from the outline */
  const tot = byClass.reduce((s, v) => s + v, 0),
    totM = mosaic.reduce((s, v) => s + v, 0);
  return {
    m2,
    cells,
    expectedCells,
    byClass: byClass.map(v => (tot ? (v / tot) * m2 : 0)),
    mosaic: mosaic.map(v => (totM ? (v / totM) * m2 : 0)),
  };
}
