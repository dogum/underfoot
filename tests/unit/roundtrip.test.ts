/* M3's round trip, end to end in code: marks as the app keeps them → the rows
 * Share sends (io/contribute) → JSON, as the store holds them → the refit job
 * (scripts/community) → a new weights file → the fusion the app runs with it.
 * The HTTP between the steps is checked in the browser suite; the store
 * itself waits until it's switched on. */
import { describe, it, expect } from 'vitest';
import { PRIORS, SOURCES } from '../../src/core/classes';
import { fuseParts } from '../../src/engine/fuse';
import { toRow } from '../../src/io/contribute';
import { keepParts, type Mark } from '../../src/io/marks';
import { refitJob, type WeightsFile } from '../../scripts/community/lib';
import BENCH from '../../model/benchmark.json';
import V0 from '../../model/weights.json';
import { marks } from './synthetic';
import type { SharedRow } from '../../src/core/types';

/* thirty people's marks, as io/marks keeps them */
const kept: { who: string; mark: Mark }[] = Array.from({ length: 30 }, (_, p) =>
  marks(10, 100 + p).map((m, k) => ({
    who: `browser-${p}`,
    mark: {
      id: `mark-${p}-${k}`,
      t: Date.UTC(2026, 9, 8 + (k % 20)),
      lat: 37.7 + p / 1000,
      lon: -119.6 + k / 1000,
      verdict: m.truth === 'grass' ? 'right' : 'wrong',
      call: 'grass',
      p: 0.5,
      truth: m.truth,
      how: 'here',
      parts: keepParts(m.parts),
      prior: 'probed',
      place: 'Yosemite Valley',
      link: '#m=point&v=37.7,-119.6',
      station: 1,
      d: null,
      v: '1.3.0',
    } as Mark,
  })),
).flat();

describe('a mark, from the app to the weights and back', () => {
  /* what Share sends, through JSON as the store keeps it */
  const stored = JSON.parse(JSON.stringify(kept.map(k => toRow(k.mark, k.who)))) as SharedRow[];
  const job = refitJob(stored, V0 as WeightsFile, BENCH, '2026-11-01');
  it('the rows carry no point, place or day', () => {
    expect(stored.every(r => r.lat === null && r.lon === null)).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/Yosemite|#m=|2026-10-\d\d/);
  });
  it('every row comes back as a mark the fit can use', () => {
    expect(job.used).toBe(300);
    expect(job.skipped).toBe(0);
  });
  it('the refit publishes v1, with the photo trusted more', () => {
    expect(job.next!.version).toBe(1);
    expect(job.next!.weights.image).toBeGreaterThan(V0.weights.image);
  });
  it('and the app fuses with it: a mark where only the photo is right leans further its way', () => {
    const m = kept.find(k => {
      const ll = k.mark.parts;
      const top = (id: 'image' | 'contain' | 'cover') => {
        const v = Array.from(ll[id]!.ll);
        return v.indexOf(Math.max(...v));
      };
      return top('image') !== top('contain') && top('image') !== top('cover');
    })!.mark;
    const opt = (w: Record<string, number>, neff: number) => ({ weights: w, neff, prior: PRIORS.probed });
    const img = Array.from(m.parts.image!.ll),
      fav = img.indexOf(Math.max(...img)),
      before = fuseParts(m.parts, opt(V0.weights, V0.neff)).p[fav],
      after = fuseParts(m.parts, opt(job.next!.weights, job.next!.neff)).p[fav];
    expect(after).toBeGreaterThan(before);
    expect(Object.keys(job.next!.weights).sort()).toEqual(SOURCES.map(s => s.id).sort());
  });
});
