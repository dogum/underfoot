/**
 * Local refit: source weights and N_eff fitted to your own marks. Pure.
 *
 * A mark keeps the eight sources' readings at the moment it was made and the
 * class that was really there. The fit finds the weights and N_eff under which
 * those true classes are most likely, through the same fusion the app uses
 * (engine/fuse, checked against fuseParts in the tests), pulled toward the defaults: a handful of marks nudges, a few
 * hundred can move a weight a long way. Accuracy is scored on held-out marks,
 * so a mark never grades the fit it helped make.
 */
import { CIX, K, SOURCES } from '../core/classes';
import { DEFAULT_NEFF, EPSILON } from './fuse';
import type { ClassKey, ClassMap, Parts, SourceId } from '../core/types';

export interface FitMark {
  /** the sources' readings when the mark was made (engine/fuse computeParts) */
  parts: Parts;
  /** what was really there */
  truth: ClassKey;
  /** how much it counts, 1 by default (the community fit caps each person's marks, engine/community) */
  wt?: number;
}
export type Weights = Record<SourceId, number>;
export interface Fit {
  weights: Weights;
  neff: number;
}

export const REFIT = {
  /** marks needed before a refit is offered */
  minMarks: 10,
  /** pull toward the defaults: nats per (log-weight change)² */
  pull: 2,
  steps: 250,
  rate: 0.05,
  /** above this many marks, hold out by k-fold instead of one at a time */
  looMax: 40,
  folds: 5,
  /** the fit stays inside the ledger sliders' range */
  wMin: 0.05,
  wMax: 2,
  neffMin: 1,
  neffMax: 8,
};

export const defaultFit = (): Fit => ({
  weights: Object.fromEntries(SOURCES.map(s => [s.id, s.w])) as Weights,
  neff: DEFAULT_NEFF,
});

const IDS = SOURCES.map(s => s.id);
const toTheta = (f: Fit) => [...IDS.map(id => Math.log(f.weights[id])), Math.log(f.neff)];
const fromTheta = (t: number[]): Fit => ({
  weights: Object.fromEntries(IDS.map((id, i) => [id, Math.exp(t[i])])) as Weights,
  neff: Math.exp(t[IDS.length]),
});

/* The fused score for class k is log prior(k) plus each source's clamped
   log-likelihood times w·wmul/τ, with τ = max(1, Σ w·wmul / N_eff), then a
   softmax and the ε mixture (engine/fuse). That's linear in each weight apart
   from τ, so the gradient is short; the tests check these probabilities equal
   fuseParts' exactly. Marks where geometry set the answer (a crossing, a
   followed path) carry no information about the weights and are left out. */
interface Prepared {
  /** per active source: its index in IDS, its per-call multiplier, its clamped log-likelihoods */
  src: { i: number; m: number; L: Float64Array }[];
  y: number;
  wt: number;
}
/** the marks a fit can learn from: those where the sources, not geometry, made the call */
export const usable = <T extends FitMark>(marks: T[]): T[] =>
  marks.filter(mk => !Object.values(mk.parts).some(p => p && p.exact));
const prepare = (marks: FitMark[]): Prepared[] =>
  usable(marks).map(mk => ({
    wt: mk.wt ?? 1,
    y: CIX[mk.truth],
    src: IDS.flatMap((id, i) => {
      const p = mk.parts[id];
      return p && p.status === 'ok'
        ? [{ i, m: p.wmul || 1, L: Float64Array.from(p.ll, v => Math.max(-8, Math.min(8, v))) }]
        : [];
    }),
  }));

/** the fused probabilities for one prepared mark, and the gradient of −log P(truth) if asked */
function evalMark(pm: Prepared, w: number[], neff: number, logPrior: number[], grad?: number[]) {
  const nk = logPrior.length;
  let W = 0;
  for (const s of pm.src) W += w[s.i] * s.m;
  const tau = Math.max(1, W / neff),
    clamped = W / neff <= 1,
    sc = logPrior.slice(),
    Lbar = new Array(nk).fill(0);
  for (const s of pm.src) {
    const a = (w[s.i] * s.m) / tau;
    for (let k = 0; k < nk; k++) {
      sc[k] += a * s.L[k];
      Lbar[k] += (w[s.i] * s.m * s.L[k]) / (W || 1);
    }
  }
  let mx = -Infinity;
  for (const v of sc) if (v > mx) mx = v;
  let z = 0;
  const e = sc.map(v => {
    const x = Math.exp(v - mx);
    z += x;
    return x;
  });
  const p = e.map(x => x / z),
    pm1 = p.map(v => (1 - EPSILON) * v + EPSILON / nk);
  if (grad) {
    /* d(−log p'_y)/ds_k = −(1−ε) p_y (δ_ky − p_k) / p'_y */
    const c = ((1 - EPSILON) * p[pm.y]) / pm1[pm.y],
      ds = p.map((v, k) => -c * ((k === pm.y ? 1 : 0) - v));
    for (const s of pm.src) {
      /* d s_k / d log w = w·m/τ (L_k − L̄_k) when τ > 1, else w·m·L_k */
      let g = 0;
      for (let k = 0; k < nk; k++) g += ds[k] * (clamped ? s.L[k] : s.L[k] - Lbar[k]);
      grad[s.i] += (pm.wt * g * w[s.i] * s.m) / tau;
    }
    /* d s_k / d log N_eff = the evidence part of s_k, when τ > 1 */
    if (!clamped) for (let k = 0; k < nk; k++) grad[IDS.length] += pm.wt * ds[k] * (sc[k] - logPrior[k]);
  }
  return pm1;
}
const logOf = (prior: ClassMap<number>) => K.map(k => Math.log(prior[k]));
const wv = (f: Fit) => IDS.map(id => f.weights[id]);

/** −log P(truth) summed over the marks, each counted by its weight, under these weights */
export function nll(marks: FitMark[], fit: Fit, prior: ClassMap<number>): number {
  const lp = logOf(prior),
    w = wv(fit);
  return prepare(marks).reduce((a, pm) => a - pm.wt * Math.log(evalMark(pm, w, fit.neff, lp)[pm.y]), 0);
}

/** the fused probabilities for a mark under these weights (the fast path, for the tests) */
export const markProbs = (mark: FitMark, fit: Fit, prior: ClassMap<number>) =>
  prepare([mark]).map(pm => evalMark(pm, wv(fit), fit.neff, logOf(prior)))[0] || null;

/** how many marks the weights call right */
export function rightCount(marks: FitMark[], fit: Fit, prior: ClassMap<number>): number {
  const lp = logOf(prior),
    w = wv(fit);
  let n = 0;
  for (const pm of prepare(marks)) {
    const p = evalMark(pm, w, fit.neff, lp);
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
    if (best === pm.y) n++;
  }
  return n;
}

/** the gradient of nll in log-weight and log-N_eff space (for the tests) */
export function nllGradient(marks: FitMark[], fit: Fit, prior: ClassMap<number>): number[] {
  const g = new Array(IDS.length + 1).fill(0),
    lp = logOf(prior),
    w = wv(fit);
  for (const pm of prepare(marks)) evalMark(pm, w, fit.neff, lp, g);
  return g;
}

/**
 * Fit weights and N_eff to the marks: Adam on log-weights and log N_eff,
 * starting from the defaults (or from `from`) and pulled back toward the
 * defaults.
 */
export function fitWeights(marks: FitMark[], prior: ClassMap<number>, from: Fit = defaultFit()): Fit {
  const pms = prepare(marks),
    lp = logOf(prior),
    t0 = toTheta(defaultFit()),
    t = toTheta(from),
    n = t.length,
    m = new Array(n).fill(0),
    v = new Array(n).fill(0),
    b1 = 0.9,
    b2 = 0.999,
    lo = [...IDS.map(() => Math.log(REFIT.wMin)), Math.log(REFIT.neffMin)],
    hi = [...IDS.map(() => Math.log(REFIT.wMax)), Math.log(REFIT.neffMax)];
  for (let step = 1; step <= REFIT.steps; step++) {
    const g = t.map((x, i) => 2 * REFIT.pull * (x - t0[i])),
      w = t.slice(0, IDS.length).map(Math.exp),
      neff = Math.exp(t[IDS.length]);
    for (const pm of pms) evalMark(pm, w, neff, lp, g);
    for (let i = 0; i < n; i++) {
      m[i] = b1 * m[i] + (1 - b1) * g[i];
      v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
      t[i] -= (REFIT.rate * (m[i] / (1 - b1 ** step))) / (Math.sqrt(v[i] / (1 - b2 ** step)) + 1e-8);
      t[i] = Math.min(hi[i], Math.max(lo[i], t[i]));
    }
  }
  return fromTheta(t);
}

/**
 * Accuracy before and after, each mark held out of the fit that scores it:
 * one at a time for a few dozen marks, k-fold beyond that. "Before" is
 * `from`, the weights the fits start from (the defaults, or the community's).
 */
export function heldOut(all: FitMark[], prior: ClassMap<number>, from: Fit = defaultFit()) {
  const marks = usable(all),
    folds = marks.length <= REFIT.looMax ? marks.length : REFIT.folds;
  let fitted = 0;
  for (let f = 0; f < folds; f++) {
    const test = marks.filter((_, i) => i % folds === f),
      train = marks.filter((_, i) => i % folds !== f);
    fitted += rightCount(test, fitWeights(train, prior, from), prior);
  }
  return { n: marks.length, defaults: rightCount(marks, from, prior), fitted };
}
