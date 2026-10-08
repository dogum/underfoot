/**
 * Community weights: marks shared by many people, fitted together the way a
 * local refit fits yours (engine/refit), with three guards so that no one
 * person, and no one round, can move the weights far. Pure: the refit script
 * (scripts/community-refit) and the tests both call it.
 *
 * - Each person (a random id per browser) counts as at most COMMUNITY.perPerson
 *   marks, however many they share.
 * - No weight, and not N_eff, moves by more than COMMUNITY.step of its value in
 *   one round, and each moves only if more people's held-out marks (shared
 *   marks the fit never trained on) do better with that move than worse. A
 *   person is one vote however many marks they share, so one person pulling a
 *   weight the others' marks don't support gets nowhere with it.
 * - A round needs marks from COMMUNITY.minPeople people, and is published only
 *   if it does better on the held-out marks and no worse on the benchmark (the
 *   engine's fixtures, model/benchmark.json).
 */
import { fitWeights, nll, rightCount, usable, type Fit, type FitMark, type Weights } from './refit';
import { CIX, K, PRIORS, SOURCES } from '../core/classes';
import type { ClassKey, ClassMap, Parts, SharedRow, SourceId } from '../core/types';

export const COMMUNITY = {
  /** one person's marks count as at most this many between them */
  perPerson: 10,
  /** the most any weight, or N_eff, moves in a round, as a share of its value */
  step: 0.15,
  /** the share of marks held out of every fit, to judge it */
  holdOut: 0.2,
  /** a round needs marks from at least this many people */
  minPeople: 5,
};

export interface SharedMark extends FitMark {
  /** the mark's id, which also decides whether it's held out */
  id: string;
  /** the random id of the browser that shared it */
  who: string;
}

/** each person's marks share a weight of at most `cap` marks between them */
export function capPerPerson<T extends SharedMark>(marks: T[], cap = COMMUNITY.perPerson): T[] {
  const n = new Map<string, number>();
  for (const m of marks) n.set(m.who, (n.get(m.who) || 0) + 1);
  return marks.map(m => ({ ...m, wt: Math.min(1, cap / (n.get(m.who) || 1)) }));
}

/** from `from` toward `to`, but no weight (nor N_eff) by more than `step` of its value */
export function limitStep(from: Fit, to: Fit, step = COMMUNITY.step): Fit {
  const lim = (a: number, b: number) => Math.min(a * (1 + step), Math.max(a * (1 - step), b));
  return {
    weights: Object.fromEntries(
      SOURCES.map(s => [s.id, lim(from.weights[s.id], to.weights[s.id])]),
    ) as Weights,
    neff: lim(from.neff, to.neff),
  };
}

/** FNV-1a: a mark's id decides its side, so it stays held out (or not) round after round */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
export const isHeldOut = (id: string, share = COMMUNITY.holdOut) => hash(id) % 1000 < share * 1000;

export interface Score {
  /** −log P(truth), each mark counted by its weight */
  nll: number;
  /** marks called right */
  right: number;
  /** marks scored */
  n: number;
}
const score = (marks: FitMark[], fit: Fit, prior: ClassMap<number>): Score => ({
  nll: nll(marks, fit, prior),
  right: rightCount(marks, fit, prior),
  n: usable(marks).length,
});

/** a vote of the people behind the held-out marks: how many do better with `cand` than with `current`, less how many do worse */
function vote(test: SharedMark[], current: Fit, prior: ClassMap<number>) {
  const by = new Map<string, SharedMark[]>();
  for (const m of usable(test)) by.set(m.who, [...(by.get(m.who) || []), m]);
  const was = new Map([...by].map(([who, ms]) => [who, nll(ms, current, prior)]));
  return (cand: Fit) => {
    let n = 0;
    for (const [who, ms] of by) {
      const d = nll(ms, cand, prior) - was.get(who)!;
      n += d < -1e-9 ? 1 : d > 1e-9 ? -1 : 0;
    }
    return n;
  };
}

export interface Round {
  current: Fit;
  /** what the training marks alone would choose */
  fitted: Fit;
  /** the fit, step-limited from the current weights, keeping only the moves the held-out marks back: what would be published */
  next: Fit;
  marks: number;
  people: number;
  train: number;
  test: number;
  before: { test: Score; bench: Score };
  after: { test: Score; bench: Score };
  publish: boolean;
  why: string;
  /** the weights (and N_eff, as 'neff') that moved by more than half a percent */
  moved: { id: SourceId | 'neff'; from: number; to: number }[];
}

/** one round: cap, fit on the training marks, limit the step, judge on held-out marks and the benchmark */
export function communityRound(
  shared: SharedMark[],
  current: Fit,
  prior: ClassMap<number>,
  bench: FitMark[],
): Round {
  const capped = capPerPerson(shared),
    test = capped.filter(m => isHeldOut(m.id)),
    train = capped.filter(m => !isHeldOut(m.id)),
    fitted = fitWeights(train, prior, current),
    stepped = limitStep(current, fitted),
    next: Fit = { weights: { ...current.weights }, neff: current.neff },
    votes = vote(test, current, prior);
  /* each weight, and N_eff, moves only if the people's held-out marks back that move alone */
  for (const s of SOURCES)
    if (votes({ ...current, weights: { ...current.weights, [s.id]: stepped.weights[s.id] } }) > 0)
      next.weights[s.id] = stepped.weights[s.id];
  if (votes({ ...current, neff: stepped.neff }) > 0) next.neff = stepped.neff;
  const people = new Set(usable(train).map(m => m.who)).size,
    before = { test: score(test, current, prior), bench: score(bench, current, prior) },
    after = { test: score(test, next, prior), bench: score(bench, next, prior) },
    better = after.test.nll < before.test.nll - 1e-9 && votes(next) > 0,
    keeps = after.bench.right >= before.bench.right,
    enough = people >= COMMUNITY.minPeople,
    publish = enough && before.test.n > 0 && better && keeps;
  const moved: Round['moved'] = [
    ...SOURCES.map(s => ({ id: s.id, from: current.weights[s.id], to: next.weights[s.id] })),
    { id: 'neff' as const, from: current.neff, to: next.neff },
  ].filter(x => Math.abs(x.to / x.from - 1) > 0.005);
  return {
    current,
    fitted,
    next,
    marks: shared.length,
    people: new Set(shared.map(m => m.who)).size,
    train: usable(train).length,
    test: usable(test).length,
    before,
    after,
    publish,
    why: !enough
      ? `marks from ${people} ${people === 1 ? 'person' : 'people'}; a round needs ${COMMUNITY.minPeople}`
      : !before.test.n
        ? 'no held-out marks yet'
        : !better
          ? 'no better on the held-out marks'
          : !keeps
            ? 'worse on the benchmark'
            : 'better on the held-out marks, no worse on the benchmark',
    moved,
  };
}

const CLASS = new Set<string>(K);
const SOURCE = new Set<string>(SOURCES.map(s => s.id));
/**
 * A row from the store as a mark the fit can use, or null when it can't be:
 * an unknown class or source, a reading that isn't twelve finite numbers, or a
 * mark made under a prior other than `prior` (the fit uses one prior at a time).
 * The store's checks refuse most of this already; the fit doesn't rely on it.
 */
export function markFromRow(row: SharedRow, prior: keyof typeof PRIORS = 'probed'): SharedMark | null {
  if (!row || row.prior !== prior || !CLASS.has(row.truth) || !CLASS.has(row.call)) return null;
  if (row.verdict !== 'right' && row.verdict !== 'wrong') return null;
  const parts: Parts = {};
  for (const [id, r] of Object.entries(row.readings || {})) {
    if (!SOURCE.has(id) || !r || typeof r.ll !== 'object') return null;
    const ll = new Float64Array(K.length);
    for (const [k, v] of Object.entries(r.ll)) {
      if (!CLASS.has(k) || typeof v !== 'number' || !Number.isFinite(v)) return null;
      ll[CIX[k as ClassKey]] = v;
    }
    parts[id as SourceId] = {
      ll,
      status: r.status,
      ...(r.wmul != null ? { wmul: r.wmul } : {}),
      ...(r.exact ? { exact: r.exact } : {}),
    };
  }
  return { id: String(row.id), who: String(row.who), truth: row.truth, parts };
}
