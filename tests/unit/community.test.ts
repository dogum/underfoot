/* Community weights (engine/community): thirty people sharing marks from a
 * world where the photo is right 90% of the time and land cover 50%, and one
 * person sharing 1,000 marks that say land cover is always right. */
import { describe, it, expect } from 'vitest';
import { PRIORS, SOURCES } from '../../src/core/classes';
import { defaultFit, type Fit } from '../../src/engine/refit';
import {
  COMMUNITY,
  capPerPerson,
  communityRound,
  isHeldOut,
  limitStep,
  type SharedMark,
} from '../../src/engine/community';
import { loadBenchmark } from '../../src/engine/benchmark';
import BENCH from '../../model/benchmark.json';
import { marks } from './synthetic';

const prior = PRIORS.probed;
const bench = loadBenchmark(BENCH);
const people = (n: number, each: number, seed: number, world?: Parameters<typeof marks>[2]): SharedMark[] =>
  Array.from({ length: n }, (_, p) =>
    marks(each, seed + p, world).map((m, k) => ({ ...m, who: `p${seed}-${p}`, id: `m${seed}-${p}-${k}` })),
  ).flat();
const honest = people(30, 10, 100);
/* one person, 1,000 marks, every one saying land cover was right and the others mostly wrong */
const rigged = people(1, 1000, 7, { cover: 1, contain: 0.2, image: 0.2 });
const within = (from: Fit, to: Fit, step: number) =>
  SOURCES.every(s => Math.abs(to.weights[s.id] / from.weights[s.id] - 1) <= step + 1e-12) &&
  Math.abs(to.neff / from.neff - 1) <= step + 1e-12;
const rounds = (shared: SharedMark[], n: number) => {
  let cur = defaultFit();
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = communityRound(shared, cur, prior, bench);
    out.push(r);
    if (r.publish) cur = r.next;
  }
  return { out, last: cur };
};

describe('the guards', () => {
  it("one person's marks count as ten between them", () => {
    const w = capPerPerson([...honest, ...rigged]);
    expect(w.find(m => m.who.startsWith('p7'))!.wt).toBeCloseTo(COMMUNITY.perPerson / 1000, 12);
    expect(w.find(m => m.who.startsWith('p100'))!.wt).toBe(1);
  });
  it('no weight moves more than 15% in a step', () => {
    const to = { weights: { ...defaultFit().weights, image: 9, cover: 0.01 }, neff: 50 };
    expect(within(defaultFit(), limitStep(defaultFit(), to), COMMUNITY.step)).toBe(true);
  });
  it('a mark stays held out, or not, by its id; about a fifth are', () => {
    const held = honest.filter(m => isHeldOut(m.id)).length;
    expect(held / honest.length).toBeGreaterThan(0.15);
    expect(held / honest.length).toBeLessThan(0.25);
    expect(honest.map(m => isHeldOut(m.id))).toEqual(honest.map(m => isHeldOut(m.id)));
  });
});

describe('thirty honest people', () => {
  const { out, last } = rounds(honest, 6);
  it('the first round is published, and moves the photo up by the most a round allows', () => {
    expect(out[0].publish).toBe(true);
    expect(out[0].next.weights.image).toBeCloseTo(defaultFit().weights.image * (1 + COMMUNITY.step), 9);
    expect(within(defaultFit(), out[0].next, COMMUNITY.step)).toBe(true);
  });
  it('rounds settle with the photo well above land cover, then stop publishing', () => {
    expect(last.weights.image).toBeGreaterThan(1.4);
    expect(last.weights.cover).toBeLessThan(defaultFit().weights.cover);
    expect(out.at(-1)!.publish).toBe(false);
  });
  it('and never do worse on the benchmark', () => {
    for (const r of out) expect(r.after.bench.right).toBeGreaterThanOrEqual(r.before.bench.right);
  });
});

describe('one person with 1,000 rigged marks', () => {
  const { out, last } = rounds([...honest, ...rigged], 6);
  it('alone, gets no round published', () => {
    const r = communityRound(rigged, defaultFit(), prior, bench);
    expect(r.publish).toBe(false);
    expect(r.why).toMatch(/1 person/);
  });
  it('among thirty honest people, moves no weight past the step in any round', () => {
    for (const r of out) expect(within(r.current, r.next, COMMUNITY.step)).toBe(true);
  });
  it('and never gets land cover, the weight they pushed, above its default', () => {
    expect(last.weights.cover).toBeLessThanOrEqual(defaultFit().weights.cover + 1e-12);
    expect(last.weights.image).toBeGreaterThan(1.4);
  });
});
