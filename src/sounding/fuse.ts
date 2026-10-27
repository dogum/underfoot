/**
 * Fusing a run: every station's sources into its answer, smoothed along a
 * line (engine/smooth); then each answer's doubt, a line's check list and
 * getting across. The app puts the GPS disc's average in between (app/sound).
 */
import { PRIOR } from '../core/classes';
import { checkList, doubtOf } from '../engine/doubt';
import { computeParts, finishPosterior, fuseParts } from '../engine/fuse';
import { smoothChain } from '../engine/smooth';
import { rateAll } from './going';
import { fuseOpt } from './run';
import type { Run } from './run';

/** each station's answer from the sources in so far, smoothed along a line */
export function fuseStations(run: Run) {
  const opt = fuseOpt(run);
  for (const r of run.results) {
    if (!r) continue;
    r.parts = computeParts(r.sh, r.q, r.feat);
    r.fused = fuseParts(r.parts, opt);
    r.view = r.fused;
    r.mode = 'raw';
  }
  const n = run.results.length;
  if (run.mode === 'path' && run.smooth && n >= 3) {
    /* crossing stations are point events — a road, a stream — so they neither
       get smoothed nor smooth their neighbours */
    const reg = run.results
      .map((r, i) => i)
      .filter(i => run.stations[i] && run.results[i] && run.results[i].fused && !run.stations[i].x);
    const sm = smoothChain(
      reg.map(i => run.results[i].fused!.p),
      reg.map(i => run.stations[i].d),
      PRIOR,
    );
    reg.forEach((i, j) => {
      const r = run.results[i];
      r.view = finishPosterior(sm[j], {
        parts: r.parts,
        tau: r.fused!.tau,
        wsum: r.fused!.wsum,
        W: run.weights,
        prior: PRIOR,
      });
      r.mode = 'smoothed';
    });
    run.results.forEach((r, i) => {
      if (r && run.stations[i] && run.stations[i].x) r.mode = 'crossing';
    });
  }
}

/** what follows the answers: how much each is worth a second look, a line's check list, go / slow / no-go */
export function finishRun(run: Run) {
  for (const r of run.results) if (r) r.doubt = r.view ? doubtOf(r.view) : null;
  run.checks =
    run.mode === 'path'
      ? checkList(
          run.results.flatMap((r, i) =>
            r && r.doubt && run.stations[i] ? [{ i, d: run.stations[i].d, score: r.doubt.score }] : [],
          ),
        ).map(s => s.i)
      : [];
  run.going = rateAll(run);
}
