/**
 * The refit benchmark: the engine's fixtures (tests/unit/engine.test.ts) as
 * each source's readings and the class that's right, kept in
 * model/benchmark.json. The community refit publishes new weights only if
 * they call these no worse than the current weights do. A unit test keeps the
 * file equal to the fixtures, so the two can't drift apart. Pure.
 */
import type { FitMark } from './refit';
import type { ClassKey, ExactTerm, Parts, SourceId, SourceStatus } from '../core/types';

export interface BenchPart {
  ll: number[];
  status: SourceStatus;
  wmul?: number;
  exact?: ExactTerm;
}
export interface BenchCase {
  name: string;
  truth: ClassKey;
  parts: Partial<Record<SourceId, BenchPart>>;
}

/* `|| 0`: JSON writes -0 as 0, so the file and the fixtures agree on it */
const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0;

/** a fixture's readings as plain JSON: log-likelihoods to six places, no prose */
export function benchCase(name: string, truth: ClassKey, parts: Parts): BenchCase {
  const out: BenchCase['parts'] = {};
  for (const [id, p] of Object.entries(parts) as [SourceId, NonNullable<Parts[SourceId]>][]) {
    if (!p) continue;
    out[id] = {
      ll: Array.from(p.ll, round),
      status: p.status,
      ...(p.wmul != null && p.wmul !== 1 ? { wmul: round(p.wmul) } : {}),
      ...(p.exact ? { exact: { cls: p.exact.cls, p: round(p.exact.p) } } : {}),
    };
  }
  return { name, truth, parts: out };
}

/** the benchmark file as marks the refit can score */
export function loadBenchmark(json: unknown): (FitMark & { name: string })[] {
  return (json as BenchCase[]).map(c => ({
    name: c.name,
    truth: c.truth,
    parts: Object.fromEntries(
      Object.entries(c.parts).map(([id, p]) => [id, { ...p, ll: Float64Array.from(p!.ll) }]),
    ) as Parts,
  }));
}
