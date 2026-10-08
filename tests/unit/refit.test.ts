/* Local refit on synthetic marks: a world where the photo is right 90% of the
 * time and land cover only 50%, and the defaults don't know it. The fit has
 * to find that, a handful of marks must only nudge, and the defaults come
 * back exactly. */
import { describe, it, expect } from 'vitest';
import { K, PRIORS, SOURCES } from '../../src/core/classes';
import { centre, zeros } from '../../src/core/math';
import { fuseParts } from '../../src/engine/fuse';
import {
  REFIT,
  defaultFit,
  fitWeights,
  heldOut,
  markProbs,
  nll,
  nllGradient,
  rightCount,
  type FitMark,
} from '../../src/engine/refit';
import type { ClassKey, Parts, SourceId } from '../../src/core/types';

/* deterministic random numbers */
function rng(seed: number) {
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
const RIGHT: Partial<Record<SourceId, number>> = { contain: 0.7, image: 0.9, cover: 0.5 };

function marks(n: number, seed: number): FitMark[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const truth = CLASSES[Math.floor(r() * CLASSES.length)];
    const parts: Parts = {};
    for (const s of SOURCES) {
      const q = RIGHT[s.id];
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
const prior = PRIORS.probed;
const ratio = (w: Record<string, number>) => w.image / w.cover;

describe('local refit', () => {
  const big = marks(300, 1),
    fit = fitWeights(big, prior);
  it('finds the photo more trustworthy than land cover', () => {
    expect(ratio(fit.weights)).toBeGreaterThan(1.5 * ratio(defaultFit().weights));
  });
  it('does better on marks it never saw', () => {
    const test = marks(200, 2);
    expect(rightCount(test, fit, prior)).toBeGreaterThan(rightCount(test, defaultFit(), prior));
  });
  it('a handful of marks only nudges', () => {
    const few = fitWeights(marks(5, 3), prior),
      d = defaultFit();
    for (const s of SOURCES)
      expect(Math.abs(Math.log(few.weights[s.id] / d.weights[s.id]))).toBeLessThan(0.35);
  });
  it('held out five ways, the fit beats the defaults on a hundred marks', () => {
    const r = heldOut(marks(100, 4), prior);
    expect(r.n).toBe(100);
    expect(r.fitted).toBeGreaterThan(r.defaults);
  });
  /* about 0.2 s on a laptop; shared CI runners take 2–3 times longer. The
     bound catches a real regression (the finite-difference fit took 8 s). */
  it('thirty marks held out one at a time, in under 2 s', () => {
    const t = performance.now();
    heldOut(marks(30, 5), prior);
    expect(performance.now() - t).toBeLessThan(2000);
  });
  it('its gradient matches finite differences, with τ above 1 and clamped at 1', () => {
    const ms = marks(25, 7);
    for (const neff of [3.5, 50]) {
      const fit = { weights: { ...defaultFit().weights, image: 1.3, cover: 0.6 }, neff },
        g = nllGradient(ms, fit, prior),
        h = 1e-5,
        ids = SOURCES.map(s => s.id);
      ids.forEach((id, i) => {
        const up = { ...fit, weights: { ...fit.weights, [id]: fit.weights[id] * Math.exp(h) } },
          dn = { ...fit, weights: { ...fit.weights, [id]: fit.weights[id] * Math.exp(-h) } };
        expect(g[i]).toBeCloseTo((nll(ms, up, prior) - nll(ms, dn, prior)) / (2 * h), 4);
      });
      const fd =
        (nll(ms, { ...fit, neff: neff * Math.exp(h) }, prior) -
          nll(ms, { ...fit, neff: neff * Math.exp(-h) }, prior)) /
        (2 * h);
      expect(g[ids.length]).toBeCloseTo(fd, 4);
    }
  });
  it('its probabilities are the engine’s own, whatever the weights', () => {
    const r = rng(9);
    for (const mk of marks(20, 6)) {
      const fit = { weights: { ...defaultFit().weights }, neff: 1 + r() * 5 };
      for (const s of SOURCES) fit.weights[s.id] *= 0.3 + r() * 2;
      const a = markProbs(mk, fit, prior)!,
        b = fuseParts(mk.parts, { weights: fit.weights, neff: fit.neff, prior, lite: true }).p;
      a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 12));
    }
  });
  it('however hard the marks pull, the fit stays inside the sliders', () => {
    const f = fitWeights(marks(400, 10), prior);
    for (const s of SOURCES) {
      expect(f.weights[s.id]).toBeLessThanOrEqual(REFIT.wMax + 1e-12);
      expect(f.weights[s.id]).toBeGreaterThanOrEqual(REFIT.wMin - 1e-12);
    }
    expect(f.neff).toBeGreaterThanOrEqual(REFIT.neffMin - 1e-12);
    expect(f.neff).toBeLessThanOrEqual(REFIT.neffMax + 1e-12);
  });
  it('marks where geometry made the call are left out, and not counted', () => {
    const ms = marks(12, 8),
      exact = {
        ...ms[0],
        parts: {
          ...ms[0].parts,
          prox: { ...ms[0].parts.contain!, exact: { cls: 'path' as const, p: 0.93 } },
        },
      };
    expect(heldOut([...ms, exact], prior).n).toBe(12);
  });
  it('the defaults are the app’s own, exactly', () => {
    const d = defaultFit();
    for (const s of SOURCES) expect(d.weights[s.id]).toBe(s.w);
  });
});
