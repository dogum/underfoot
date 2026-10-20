/**
 * Terrain from a rosette of elevations: a centre and a ring of eight around it,
 * fitted with a plane. Slope from the plane, roughness from what the plane
 * misses, relief from the centre against the ring. Then terrain as evidence:
 * what each class's ground is usually like. Pure.
 */
import { CIX } from '../core/classes';
import { R2D, offset } from '../core/geo';
import { add, centre, clamp, fmt, tll, zeros } from '../core/math';
import type { ClassKey, LatLon, SourcePart, StationFacts, Terrain } from '../core/types';

export type { Terrain };

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

/* the slope (degrees) at which each class's ground becomes unusual */
const SLOPE_SCALE: Partial<Record<ClassKey, number>> = {
  snow: 26,
  building: 13,
  paved: 14,
  crop: 11,
  grass: 17,
  rail: 7,
  forest: 40,
  scrub: 44,
  bare: 48,
  path: 38,
};
export function srcTerrain(sh: StationFacts): SourcePart {
  const t = sh.terr;
  if (t === undefined) return { ll: zeros(), status: 'wait' };
  if (!t) return { ll: zeros(), status: 'na', note: 'no elevation service answered' };
  /* the narrow kernel fits 3DEP's 1 m, 3 m and 10 m DEMs alike: at the same
     10 m rosettes on the Yosemite Valley floor, the 10 m DEM's slope is within
     0.4° of the 1 m lidar's and its water term matches (+0.30 vs +0.29 nats),
     where the wide kernel would add 0.6. The wide one is for 30 m cells and
     coarser, where the whole rosette sits inside a cell or two */
  const ll = zeros(),
    { slope, rough, rel } = t,
    fine = t.res <= 15;
  if (t.ocean) {
    add(ll, { water: 3.0, wetland: 0.4 });
    return {
      ll: centre(ll),
      status: 'ok',
      note: 'elevation reads exactly 0 m across the whole rosette — open sea\n' + t.src,
    };
  }
  const sS = fine ? 1.0 : 2.2,
    sR = fine ? 0.1 : 1.1,
    kRel = fine ? 0.8 : 0.55;
  /* water: flat, smooth ground in a local low is evidence FOR it; steepness
     argues only weakly against, because streams run in ravines */
  const flat = Math.exp(-0.5 * (slope / sS) ** 2 - 0.5 * (rough / sR) ** 2);
  ll[CIX.water] += 1.2 * flat - Math.min(1.0, slope / 30) + clamp(-rel * kRel, -1.0, 1.3);
  ll[CIX.wetland] += 0.8 * flat - Math.min(0.8, slope / 25) + clamp(-rel * kRel * 0.6, -0.8, 0.9);
  for (const [k, s] of Object.entries(SLOPE_SCALE) as [ClassKey, number][]) ll[CIX[k]] += tll(slope / s);
  const note = `slope ${fmt(slope, 1)}°  ·  roughness ±${fmt(rough, 2)} m  ·  centre ${rel >= 0 ? '+' : ''}${fmt(rel, 2)} m vs ring\n${t.src}`;
  return { ll: centre(ll), status: 'ok', note };
}
