/**
 * World cover (M5): Impact Observatory's 10 m land cover (with Microsoft and
 * Esri), made from Sentinel-2, one map a year (data/worldcover). Pure.
 *
 * It answers where NLCD has no class: outside the lower 48, and inside the
 * lower-48 box where NLCD came back empty (southern Canada, northern Mexico)
 * or failed. Where NLCD has a class, World cover stays out, so no answer in
 * the US changes and land cover isn't counted twice. Like NLCD, each class is
 * read as a mixture rather than a verdict: built area is roofs and roads, and
 * rangeland is grass, scrub and the bare ground between them.
 */
import { CIX, K } from '../core/classes';
import { centre, zeros } from '../core/math';
import type { ClassKey, SourcePart, StationFacts, WorldFacts } from '../core/types';

/** each class the map uses: its name, and the share of each of our classes it stands for */
export const WORLD: Record<number, { name: string; mix: Partial<Record<ClassKey, number>> }> = {
  1: { name: 'Water', mix: { water: 0.86, wetland: 0.06, bare: 0.03, grass: 0.02 } },
  2: { name: 'Trees', mix: { forest: 0.78, scrub: 0.1, grass: 0.04, wetland: 0.03, path: 0.02 } },
  4: {
    name: 'Flooded vegetation',
    mix: { wetland: 0.62, grass: 0.12, crop: 0.1, water: 0.08, forest: 0.05 },
  },
  5: { name: 'Crops', mix: { crop: 0.74, grass: 0.16, bare: 0.04, path: 0.02 } },
  7: {
    name: 'Built area',
    mix: { building: 0.34, paved: 0.34, grass: 0.12, forest: 0.06, path: 0.05, bare: 0.04, rail: 0.02 },
  },
  8: { name: 'Bare ground', mix: { bare: 0.78, scrub: 0.06, grass: 0.05, snow: 0.04, paved: 0.03 } },
  9: { name: 'Snow / ice', mix: { snow: 0.86, bare: 0.11 } },
  /* the map's definition has two halves of equal standing: open grass and pasture,
     and bushes, shrubs and tufts over exposed soil or rock */
  11: { name: 'Rangeland', mix: { grass: 0.38, scrub: 0.38, bare: 0.16, crop: 0.04 } },
};
/** the map's own name for a class it marks but we don't read */
const OTHER: Record<number, string> = { 10: 'Clouds', 0: 'No data' };
export const worldName = (code: number) => WORLD[code]?.name ?? OTHER[code] ?? `class ${code}`;

/** floor under a mixture's shares, as for NLCD: no class is ruled out */
const FLOOR = 0.012;

export function srcWorld(sh: StationFacts): SourcePart {
  /* in the lower-48 box, NLCD speaks first */
  if (sh.conus && sh.nlcd === undefined) return { ll: zeros(), status: 'wait' };
  if (sh.conus && sh.nlcd && sh.nlcd.code != null)
    return {
      ll: zeros(),
      status: 'na',
      note: 'NLCD covers this point; World cover answers where it has no class',
    };
  const w = sh.world as WorldFacts | null | undefined;
  if (w === undefined) return { ll: zeros(), status: 'wait', note: 'reading the global land cover' };
  if (!w) return { ll: zeros(), status: 'na', note: 'the global land cover had no reading here' };
  const c = WORLD[w.code];
  if (!c)
    return {
      ll: zeros(),
      status: 'quiet',
      note: `${w.year} map · ${worldName(w.code)} at the 10 m pixel, which says nothing about the ground`,
    };
  const ll = zeros();
  for (const k of K) ll[CIX[k]] = Math.log((c.mix[k] || 0) + FLOOR);
  return {
    ll: centre(ll),
    status: 'ok',
    note: `${w.year} map · ${c.name} at the 10 m pixel (Impact Observatory, Microsoft and Esri), read as a mixture rather than a verdict`,
  };
}
