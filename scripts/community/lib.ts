/**
 * The community refit as plain functions: rows from the store in; the next
 * weights file, a changelog entry and a summary out. refit.ts does the reading
 * and writing; tests/unit/refit-job.test.ts runs this on synthetic rows.
 */
import { PRIORS, SOURCES } from '../../src/core/classes';
import { loadBenchmark } from '../../src/engine/benchmark';
import { communityRound, markFromRow, type Round, type SharedMark } from '../../src/engine/community';
import { defaultFit, type Weights } from '../../src/engine/refit';
import type { SharedRow, WeightsFile } from '../../src/core/types';

export type { WeightsFile };

const NAME: Record<string, string> = {
  ...Object.fromEntries(SOURCES.map(s => [s.id, s.n])),
  neff: 'N_eff (overlap)',
};
const f2 = (v: number) => v.toFixed(2);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export interface Job {
  round: Round;
  /** rows the fit could use, and rows left out (another prior, or malformed) */
  used: number;
  skipped: number;
  next: WeightsFile | null;
  /** the changelog entry, when a round is published */
  entry: string;
  /** what happened, for the job's log and the pull request */
  summary: string;
}

export function refitJob(rows: SharedRow[], current: WeightsFile, bench: unknown, date: string): Job {
  const marks = rows.map(r => markFromRow(r)).filter((m): m is SharedMark => !!m),
    round = communityRound(
      marks,
      /* a source added since the last round starts from its default */
      { weights: { ...defaultFit().weights, ...current.weights }, neff: current.neff },
      PRIORS.probed,
      loadBenchmark(bench),
    ),
    { before, after } = round,
    version = current.version + 1;
  const next: WeightsFile | null = round.publish
    ? {
        version,
        date,
        marks: round.marks,
        people: round.people,
        weights: Object.fromEntries(SOURCES.map(s => [s.id, r4(round.next.weights[s.id])])) as Weights,
        neff: r4(round.next.neff),
        note: `Fitted to ${round.marks} shared marks from ${round.people} people (docs/weights-changelog.md).`,
      }
    : null;
  const moved = round.moved.map(m => `| ${NAME[m.id]} | ${f2(m.from)} | ${f2(m.to)} |`).join('\n'),
    scores =
      `Held out: ${round.test} marks, −log P ${before.test.nll.toFixed(2)} → ${after.test.nll.toFixed(2)}, ` +
      `right ${before.test.right} → ${after.test.right}. Benchmark: ${after.bench.right} of ${after.bench.n} right (was ${before.bench.right}).`;
  const entry = next
    ? `## v${version} · ${date}\n\n${round.marks} marks from ${round.people} people. ${scores}\n\n| Weight | Was | Now |\n| --- | --: | --: |\n${moved}\n`
    : '';
  const summary = [
    next ? `**Published v${version}.** ${round.why}.` : `**Nothing published.** ${round.why}.`,
    '',
    `${rows.length} rows read: ${marks.length} used, ${rows.length - marks.length} left out (another prior, or malformed). ${round.train} trained on, from ${round.people} ${round.people === 1 ? 'person' : 'people'}.`,
    '',
    scores,
    ...(moved ? ['', '| Weight | Was | Now |', '| --- | --: | --: |', moved] : []),
  ].join('\n');
  return { round, used: marks.length, skipped: rows.length - marks.length, next, entry, summary };
}

/** the changelog with a new entry on top, under its heading */
export function addEntry(changelog: string, entry: string): string {
  const at = changelog.indexOf('\n## ');
  return at < 0
    ? `${changelog.trimEnd()}\n\n${entry}`
    : `${changelog.slice(0, at + 1)}${entry}\n${changelog.slice(at + 1)}`;
}
