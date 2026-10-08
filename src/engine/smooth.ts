// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Forward–backward smoothing along a line, for cover classes only. Pure.
 */
import { K } from '../core/classes';

/* ---- smoothing along a path ----------------------------------------------
 * Neighbouring stations are not independent — but only some classes persist.
 * Forest, grass, crop, water, wetland, scrub, bare and snow are COVER: they
 * come in patches, so a lone "grass" station inside a forest run is probably
 * noise. Roads, paths, rail and buildings are OBJECTS the line crosses: a
 * 6 m road between two forest stations is exactly what a transect should
 * find. (A first version smoothed everything and erased a 93% road crossing
 * down to 11% — the test suite caught it.)
 * So each station's object mass is kept as-is, and only the cover share is
 * smoothed: forward–backward on a Markov chain over the cover classes, which
 * stays put over a gap d with probability exp(-d/L) and otherwise redraws from
 * the prior. */
export const PATCH_L = 35;
export const OBJECTS = new Set(['building', 'paved', 'path', 'rail']);
export function smoothChain(posts, dists, prior) {
  const n = posts.length;
  if (n < 3) return posts;
  const cov = K.map((k, i) => (OBJECTS.has(k) ? -1 : i)).filter(i => i >= 0),
    C = cov.length;
  const pri = cov.map(i => prior[K[i]]),
    ps = pri.reduce((a, b) => a + b, 0);
  for (let c = 0; c < C; c++) pri[c] /= ps;
  const share = posts.map(p => cov.reduce((s, i) => s + p[i], 0));
  const em = posts.map((p, t) => cov.map((i, c) => Math.max(p[i] / Math.max(share[t], 1e-9), 1e-9) / pri[c]));
  const step = (prev, d) => {
    const stay = Math.exp(-Math.max(d, 0.5) / PATCH_L);
    let s = 0;
    for (const v of prev) s += v;
    return prev.map((v, c) => stay * v + (1 - stay) * pri[c] * s);
  };
  const norm = a => {
    const s = a.reduce((x, y) => x + y, 0) || 1;
    return a.map(v => v / s);
  };
  const A = new Array(n),
    B = new Array(n);
  A[0] = norm(pri.map((v, c) => v * em[0][c]));
  for (let t = 1; t < n; t++) {
    const pr = step(A[t - 1], dists[t] - dists[t - 1]);
    A[t] = norm(pr.map((v, c) => v * em[t][c]));
  }
  B[n - 1] = new Array(C).fill(1 / C);
  for (let t = n - 2; t >= 0; t--) {
    const nx = B[t + 1].map((v, c) => v * em[t + 1][c]);
    B[t] = norm(step(nx, dists[t + 1] - dists[t]));
  }
  return posts.map((p, t) => {
    const g = norm(A[t].map((v, c) => v * B[t][c])),
      out = p.slice();
    cov.forEach((i, c) => {
      out[i] = g[c] * share[t];
    });
    return out;
  });
}
