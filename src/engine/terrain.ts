/**
 * Terrain from a rosette of elevations: a centre and a ring of eight around it,
 * fitted with a plane. Slope from the plane, roughness from what the plane
 * misses, relief from the centre against the ring. Pure.
 */
import { R2D, offset } from '../core/geo';
import type { LatLon } from '../core/types';

export interface Terrain {
  /** degrees */
  slope: number;
  /** m: RMS of the ring about the fitted plane */
  rough: number;
  /** m: the centre against the ring's mean (negative in a hollow or a channel) */
  rel: number;
  /** m: elevation at the centre */
  z: number;
  /** m: the ring's radius */
  r: number;
  /** which elevation service and cell, for the ledger */
  src: string;
  /** m: the elevation data's cell size */
  res: number;
  /** an all-zero rosette from the global DEM: open sea */
  ocean: boolean;
}

/** the centre and eight points r metres around it */
export function rosette(p: LatLon, r: number): LatLon[] {
  const out = [{ lat: p.lat, lon: p.lon }];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    out.push(offset(p, r * Math.sin(a), r * Math.cos(a)));
  }
  return out;
}

/** terrain from a rosette's elevations (centre first), or null if any is missing */
export function terrainFrom(
  z: (number | null | undefined)[] | null | undefined,
  r: number,
  src: string,
  res: number,
): Terrain | null {
  if (!z || z.length < 5 || z.some(v => v == null)) return null;
  const zs = z as number[],
    c = zs[0],
    ring = zs.slice(1),
    n = ring.length;
  const pts = ring.map((v, i) => {
    const a = (i * 2 * Math.PI) / n;
    return [r * Math.sin(a), r * Math.cos(a), v];
  });
  const mz = ring.reduce((a, b) => a + b, 0) / n;
  let Sxx = 0,
    Syy = 0,
    Sxy = 0,
    Sxz = 0,
    Syz = 0;
  for (const [x, y, zz] of pts) {
    Sxx += x * x;
    Syy += y * y;
    Sxy += x * y;
    Sxz += x * (zz - mz);
    Syz += y * (zz - mz);
  }
  const det = Sxx * Syy - Sxy * Sxy;
  let a = 0,
    b = 0;
  if (Math.abs(det) > 1e-9) {
    a = (Sxz * Syy - Syz * Sxy) / det;
    b = (Syz * Sxx - Sxz * Sxy) / det;
  }
  let res2 = 0;
  for (const [x, y, zz] of pts) res2 += (zz - (mz + a * x + b * y)) ** 2;
  return {
    slope: Math.atan(Math.hypot(a, b)) * R2D,
    rough: Math.sqrt(res2 / n),
    rel: c - mz,
    z: c,
    r,
    src,
    res,
    ocean: false,
  };
}
