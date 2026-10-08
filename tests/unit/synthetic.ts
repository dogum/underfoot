/* Synthetic marks for the refit tests: a world where each source points at
 * the truth a known share of the time, so a fit has something to find. */
import { K, SOURCES } from '../../src/core/classes';
import { centre, zeros } from '../../src/core/math';
import type { FitMark } from '../../src/engine/refit';
import type { ClassKey, Parts, SourceId } from '../../src/core/types';

/** deterministic random numbers */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CLASSES: ClassKey[] = ['forest', 'grass', 'water', 'bare', 'scrub'];
/** how often each source points at the truth in this world */
export const RIGHT: Partial<Record<SourceId, number>> = { contain: 0.7, image: 0.9, cover: 0.5 };

/** n marks from a world where each source is right `world[id]` of the time */
export function marks(n: number, seed: number, world = RIGHT): FitMark[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const truth = CLASSES[Math.floor(r() * CLASSES.length)];
    const parts: Parts = {};
    for (const s of SOURCES) {
      const q = world[s.id];
      if (q == null) {
        parts[s.id] = { ll: zeros(), status: 'na' };
        continue;
      }
      const pick = r() < q ? truth : CLASSES.filter(c => c !== truth)[Math.floor(r() * (CLASSES.length - 1))];
      const ll = zeros();
      ll[K.indexOf(pick)] = 2.5;
      parts[s.id] = { ll: centre(ll), status: 'ok' };
    }
    return { parts, truth };
  });
}
