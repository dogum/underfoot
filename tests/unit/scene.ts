/* Synthetic map scenes for the unit tests, written in local metres around a
 * point in Yosemite Valley and turned into tile features like data/mvt's. */
import { offset } from '../../src/core/geo';
import type { LatLon, TileFeature } from '../../src/core/types';

export const O = { lat: 37.74, lon: -119.59 };
export const at = (x: number, y: number): LatLon => offset(O, x, y);

const feature = (L: string, t: number, p: Record<string, any>, pts: number[][]): TileFeature => {
  const a: number[] = [];
  for (const [x, y] of pts) {
    const q = at(x, y);
    a.push(q.lon, q.lat);
  }
  const lon = a.filter((_, i) => i % 2 === 0),
    lat = a.filter((_, i) => i % 2 === 1);
  return {
    L,
    t,
    p,
    r: [Float64Array.from(a)],
    bb: [Math.min(...lon), Math.min(...lat), Math.max(...lon), Math.max(...lat)],
  };
};
/** a mapped line: a road, path, rail line or waterway */
export const line = (L: string, p: Record<string, any>, pts: number[][]) => feature(L, 2, p, pts);
/** a mapped rectangle: a lake, a wood, a building */
export const box = (L: string, p: Record<string, any>, x0: number, y0: number, x1: number, y1: number) =>
  feature(L, 3, p, [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ]);
