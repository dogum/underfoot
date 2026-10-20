/**
 * NLCD 2021 as evidence (data/nlcd): the land-cover class read as a mixture,
 * and the tree canopy, impervious share and impervious descriptor read as
 * signatures. The US lower 48 only. Pure.
 */
import { CIX, K } from '../core/classes';
import { add, centre, tll, zeros } from '../core/math';
import type { ClassKey, SourcePart, StationFacts } from '../core/types';

/** each NLCD class as the mixture of Underfoot's classes it usually is on the ground */
export const NLCD_MIX: Record<number, Record<string, number>> = {
  11: { water: 0.84, wetland: 0.08, bare: 0.04, snow: 0.02 },
  12: { snow: 0.86, water: 0.07, bare: 0.05 },
  21: { grass: 0.44, paved: 0.18, building: 0.12, forest: 0.12, path: 0.06, bare: 0.05 },
  22: { building: 0.27, paved: 0.27, grass: 0.27, forest: 0.1, path: 0.05 },
  23: { building: 0.37, paved: 0.4, grass: 0.13, forest: 0.05, path: 0.04 },
  24: { building: 0.45, paved: 0.44, grass: 0.05, path: 0.04 },
  31: { bare: 0.76, scrub: 0.09, grass: 0.06, paved: 0.04, water: 0.03 },
  41: { forest: 0.8, grass: 0.07, scrub: 0.06, path: 0.03, building: 0.02 },
  42: { forest: 0.82, scrub: 0.08, grass: 0.05, path: 0.02 },
  43: { forest: 0.82, scrub: 0.07, grass: 0.05, path: 0.03 },
  51: { scrub: 0.74, bare: 0.12, grass: 0.1 },
  52: { scrub: 0.72, grass: 0.13, bare: 0.1 },
  71: { grass: 0.68, scrub: 0.14, crop: 0.09, bare: 0.06 },
  72: { grass: 0.7, wetland: 0.12, scrub: 0.12 },
  73: { bare: 0.55, scrub: 0.25, grass: 0.15 },
  74: { wetland: 0.4, grass: 0.32, bare: 0.2 },
  81: { grass: 0.54, crop: 0.34, scrub: 0.06 },
  82: { crop: 0.8, grass: 0.11, bare: 0.05 },
  90: { wetland: 0.5, forest: 0.36, scrub: 0.07 },
  95: { wetland: 0.72, water: 0.13, grass: 0.09 },
};
export function srcCover(sh: StationFacts): SourcePart {
  if (!sh.conus) return { ll: zeros(), status: 'na', note: 'NLCD covers the conterminous US only' };
  if (sh.nlcd === undefined) return { ll: zeros(), status: 'wait' };
  if (!sh.nlcd || sh.nlcd.code == null)
    return {
      ll: zeros(),
      status: sh.nlcd === null ? 'err' : 'na',
      note: 'land-cover service gave no class here',
    };
  const mix = NLCD_MIX[sh.nlcd.code];
  if (!mix) return { ll: zeros(), status: 'na', note: 'unmapped NLCD code' };
  const ll = zeros();
  for (const k of K) ll[CIX[k]] = Math.log((mix[k] || 0) + 0.012);
  return {
    ll: centre(ll),
    status: 'ok',
    note: `NLCD 2021 · ${sh.nlcd.code} — ${sh.nlcd.name}\n30 m pixel, read as a mixture rather than a verdict`,
  };
}
/** tree canopy and impervious share per class: [mean %, sd %] */
export const TCC_SIG: Record<ClassKey, [number, number]> = {
  forest: [78, 22],
  scrub: [26, 22],
  grass: [8, 14],
  crop: [5, 13],
  wetland: [28, 28],
  water: [3, 9],
  bare: [4, 11],
  snow: [3, 9],
  building: [14, 22],
  paved: [9, 18],
  path: [42, 38],
  rail: [14, 26],
};
export const IMP_SIG: Record<ClassKey, [number, number]> = {
  building: [82, 26],
  paved: [80, 26],
  rail: [34, 34],
  path: [22, 30],
  grass: [10, 18],
  crop: [3, 10],
  forest: [3, 10],
  scrub: [3, 10],
  water: [2, 9],
  wetland: [2, 9],
  bare: [6, 14],
  snow: [2, 9],
};
/** what each impervious descriptor (20 primary road … 29) says, per class */
export const IMPD_LL: Record<number, Record<string, number>> = {
  20: { paved: 2.6, building: -1.0, forest: -1.2, grass: -0.8 },
  21: { paved: 2.5, building: -0.9, forest: -1.1, grass: -0.7 },
  22: { paved: 2.2, path: 0.5, building: -0.7, forest: -1.0 },
  23: { paved: 1.0, path: 1.2, bare: 0.6, forest: -0.5 },
  24: { building: 1.3, paved: 1.2, grass: 0.4, forest: -0.8, crop: -0.8 },
  25: { building: 2.8, paved: -0.6, forest: -1.2 },
  26: { building: 0.7, paved: 0.8, forest: -0.6 },
  27: { bare: 1.0, paved: 0.4 },
  28: { bare: 1.6, paved: 0.4 },
  29: { bare: 1.2, paved: 0.5 },
};
export function srcCanopy(sh: StationFacts): SourcePart {
  if (!sh.conus)
    return {
      ll: zeros(),
      status: 'na',
      note: 'canopy and impervious rasters cover the conterminous US only',
    };
  if (sh.nlcd === undefined) return { ll: zeros(), status: 'wait' };
  const n = sh.nlcd;
  if (!n || (n.canopy == null && n.imperv == null && n.desc == null))
    return { ll: zeros(), status: n === null ? 'err' : 'na', note: 'no canopy / impervious value here' };
  const ll = zeros(),
    bits: string[] = [];
  if (n.canopy != null) {
    for (const k of K) {
      const [mu, sd] = TCC_SIG[k];
      ll[CIX[k]] += tll((n.canopy - mu) / sd);
    }
    bits.push(`tree canopy ${n.canopy}%`);
  }
  if (n.imperv != null) {
    for (const k of K) {
      const [mu, sd] = IMP_SIG[k];
      ll[CIX[k]] += tll((n.imperv - mu) / sd);
    }
    bits.push(`impervious ${n.imperv}%`);
  }
  if (n.desc != null && IMPD_LL[n.desc]) {
    add(ll, IMPD_LL[n.desc]);
    bits.push(`descriptor: ${n.descName}`);
  } else if (n.desc === 0) bits.push('descriptor: not impervious');
  return {
    ll: centre(ll),
    status: 'ok',
    note:
      bits.join('  ·  ') +
      '\nNLCD 2021, 30 m — shares a lineage with the land-cover source, so both sit below weight 1',
  };
}
