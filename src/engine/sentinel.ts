/**
 * The newest pass (M4): the Sentinel-2 scene class at the station's 20 m
 * pixel (data/sentinel), as evidence. Pure.
 *
 * Vegetation, not vegetated (bare or built), water and snow each lean their
 * way; a pixel under cloud, shadow or haze has nothing to say. The pass is
 * dated: full weight up to 10 days old, fading to nothing at 60, so an old
 * pass can't overrule today's map. It's an area source: a 20 m pixel can't
 * refute a road or a path (the sub-pixel floor, engine/fuse). Being an
 * observation, it also outweighs today's weather model on snow (engine/today).
 */
import { add, centre, fmt, zeros } from '../core/math';
import type { ClassKey, PassFacts, SourcePart, StationFacts } from '../core/types';

export const PASS_AGE = {
  /** days at full weight */
  full: 10,
  /** days by which the weight has faded to nothing */
  none: 60,
};

/** each clear scene class: its name, and how far it leans each class (nats, before centring) */
export const SCL: Record<number, { name: string; lean: Partial<Record<ClassKey, number>> }> = {
  4: {
    name: 'vegetation',
    lean: {
      forest: 1.2,
      grass: 1.2,
      scrub: 1,
      crop: 1,
      wetland: 0.8,
      bare: -1.5,
      paved: -1.5,
      building: -1.2,
      water: -1.5,
      snow: -2,
    },
  },
  5: {
    name: 'not vegetated',
    lean: {
      bare: 1.2,
      paved: 1,
      building: 0.8,
      path: 0.3,
      rail: 0.3,
      forest: -1.5,
      grass: -1,
      scrub: -0.8,
      crop: -0.8,
      wetland: -0.8,
      water: -1,
      snow: -1.5,
    },
  },
  6: {
    name: 'water',
    lean: {
      water: 2,
      wetland: 0.8,
      forest: -1.5,
      grass: -1.2,
      bare: -1,
      paved: -1.2,
      building: -1.5,
      snow: -1,
    },
  },
  11: {
    name: 'snow or ice',
    lean: { snow: 2.5, bare: -0.5, forest: -1.5, grass: -1.5, water: -1, paved: -1, building: -1 },
  },
};
/** what the other classes mean, for the ledger */
export const SCL_OTHER: Record<number, string> = {
  0: 'no data',
  1: 'saturated',
  2: 'dark or shadowed',
  3: 'cloud shadow',
  7: 'unclassified',
  8: 'cloud',
  9: 'thick cloud',
  10: 'thin cirrus',
};
export const sclName = (v: number) => SCL[v]?.name ?? SCL_OTHER[v] ?? `class ${v}`;

/** the weight a pass keeps at its age: 1 to 10 days, fading to 0 at 60 */
export const passWeight = (days: number) =>
  Math.max(0, Math.min(1, 1 - (days - PASS_AGE.full) / (PASS_AGE.none - PASS_AGE.full)));

const ago = (d: number) => (d < 1.5 ? '1 day' : `${Math.round(d)} days`);

export function srcPass(sh: StationFacts): SourcePart {
  const p = sh.pass as PassFacts | null | undefined;
  if (p === undefined) return { ll: zeros(), status: 'wait', note: 'finding the newest Sentinel-2 pass' };
  if (!p) return { ll: zeros(), status: 'na', note: 'no Sentinel-2 scene covers this point' };
  const skipped = p.skipped.length ? ` · passed over ${p.skipped.join(', ')} for cloud at the point` : '';
  if (p.scl == null || !SCL[p.scl])
    return {
      ll: zeros(),
      status: 'quiet',
      note: `no clear view of the point on the last ${p.skipped.length} passes (${p.skipped.join(', ')}): cloud, shadow or a dark pixel`,
    };
  const w = passWeight(p.days);
  if (w <= 0.001)
    return { ll: zeros(), status: 'quiet', note: `the newest clear pass, ${p.date}, is too old to count` };
  const ll = zeros();
  add(ll, SCL[p.scl].lean);
  return {
    ll: centre(ll),
    status: 'ok',
    wmul: w,
    note: `${p.date}, ${ago(p.days)} old · scene class "${sclName(p.scl)}" at the 20 m pixel${w < 1 ? ` · counts ${Math.round(w * 100)}% for its age` : ''}${skipped}`,
  };
}

/** a clear pass at most PASS_AGE.full days old that saw no snow: the date, or null */
export function clearOfSnow(sh: StationFacts): string | null {
  const p = sh.pass as PassFacts | null | undefined;
  return p && p.scl != null && SCL[p.scl] && p.scl !== 11 && p.days <= PASS_AGE.full ? p.date : null;
}
