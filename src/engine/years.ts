/**
 * The time machine's reasoning, pure: what a spot was in each of Esri's past
 * captures, smoothed across them, and where it changed.
 *
 * Each capture brings the imagery classifier's probabilities for the nine
 * classes it knows. A single capture is noisy (an autumn shadow reads forest,
 * a leaf-off wood reads wetland), so the captures are smoothed together:
 * forward–backward on a chain over the nine classes that stays put over a gap
 * of d years with probability exp(-d / T), and otherwise redraws evenly. A
 * change is flagged between two captures when the chain says it most likely
 * changed there (probability CHANGE_AT or more) and the smoothed call differs
 * either side. The settings were chosen on six places that changed and five that
 * didn't, holding false flags near 5% on 421 calibration points whose older
 * pictures still match today's (docs/validation.md#time-machine).
 */
import { NAME } from '../core/classes';
import type { ClassKey } from '../core/types';
import { IMG_MODEL } from './imagery-model';

/** the classes the imagery classifier knows, in its own order */
export const YEAR_CLASSES = IMG_MODEL.classes as ClassKey[];
export const YEARS = {
  /** years: a spot stays the same over d years with probability exp(-d / T) */
  T: 7,
  /** each capture's probabilities (an average of five patches) are raised to this power before smoothing */
  sharpen: 2,
  /** a change between two captures is flagged from this probability up */
  changeAt: 0.6,
  /** a class is named before or after a change when it holds this share */
  nameFrom: 0.25,
};

/** One distinct capture at the spot, oldest first. */
export interface Capture {
  /** acquisition date, YYYY-MM-DD */
  date: string;
  /** the Wayback release whose tiles show it */
  rel: number;
  /** provider and source resolution, from the release's metadata */
  src?: string | null;
  res?: number | null;
  /** the imagery classifier's probabilities, in YEAR_CLASSES order */
  p: number[];
}
export interface Change {
  /** between caps[i] and caps[i + 1] */
  i: number;
  /** probability that the spot changed in that interval */
  p: number;
  from: ClassKey[];
  to: ClassKey[];
}
export interface Years {
  caps: Capture[];
  /** smoothed probabilities per capture, YEAR_CLASSES order */
  g: number[][];
  /** probability of a change between capture t and t + 1 */
  change: number[];
  flags: Change[];
}

/** a date as fractional years */
export function yearOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return y + ((m || 1) - 1) / 12 + ((d || 1) - 1) / 365;
}

function norm(a: number[]): number[] {
  const s = a.reduce((x, y) => x + y, 0) || 1;
  return a.map(v => v / s);
}

/** forward–backward over the captures; returns the smoothed calls and the chance of a change in each gap */
export function smoothCaptures(
  P: number[][],
  years: number[],
  opt = YEARS,
): { g: number[][]; change: number[] } {
  const n = P.length,
    C = YEAR_CLASSES.length;
  if (!n) return { g: [], change: [] };
  const E = P.map(p => p.map(v => Math.pow(Math.max(v, 1e-9), opt.sharpen)));
  const stay = (t: number) => Math.exp(-Math.max(years[t + 1] - years[t], 0) / opt.T);
  /* one step of the chain: keep the class with probability s, else redraw evenly */
  const step = (v: number[], s: number) => {
    const sum = v.reduce((x, y) => x + y, 0);
    return v.map(x => s * x + ((1 - s) * sum) / C);
  };
  const A: number[][] = new Array(n),
    B: number[][] = new Array(n);
  A[0] = norm(E[0].map(e => e / C));
  for (let t = 1; t < n; t++) A[t] = norm(step(A[t - 1], stay(t - 1)).map((v, c) => v * E[t][c]));
  B[n - 1] = new Array(C).fill(1 / C);
  for (let t = n - 2; t >= 0; t--)
    B[t] = norm(
      step(
        E[t + 1].map((e, c) => e * B[t + 1][c]),
        stay(t),
      ),
    );
  const g = A.map((a, t) => norm(a.map((v, c) => v * B[t][c])));
  /* the chance the class is the same either side of a gap, from the two-slice marginal */
  const change: number[] = [];
  for (let t = 0; t < n - 1; t++) {
    const s = stay(t),
      nx = E[t + 1].map((e, c) => e * B[t + 1][c]),
      nxSum = nx.reduce((x, y) => x + y, 0);
    let same = 0,
      all = 0;
    for (let i = 0; i < C; i++) {
      same += A[t][i] * (s + (1 - s) / C) * nx[i];
      all += A[t][i] * (s * nx[i] + ((1 - s) / C) * nxSum);
    }
    change.push(all > 0 ? 1 - same / all : 0);
  }
  return { g, change };
}

const top = (v: number[]) => v.indexOf(Math.max(...v));
/** the classes that hold at least `from` of a smoothed call, strongest first, at most two */
function named(v: number[], from: number): ClassKey[] {
  const order = [...v.keys()].sort((a, b) => v[b] - v[a]);
  const out = order.slice(0, 2).filter(k => v[k] >= from);
  return (out.length ? out : [order[0]]).map(k => YEAR_CLASSES[k]);
}

/** the whole history: smoothed calls and the changes flagged */
export function readYears(caps: Capture[], opt = YEARS): Years {
  const { g, change } = smoothCaptures(
    caps.map(c => c.p),
    caps.map(c => yearOf(c.date)),
    opt,
  );
  const flags: Change[] = [];
  change.forEach((p, i) => {
    if (p >= opt.changeAt && top(g[i]) !== top(g[i + 1]))
      flags.push({ i, p, from: named(g[i], opt.nameFrom), to: named(g[i + 1], opt.nameFrom) });
  });
  return { caps, g, change, flags };
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mar 2019" */
export const monthYear = (date: string) => `${MONTH[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}`;
const say = (k: ClassKey) => NAME[k].split(' /')[0].toLowerCase();
const both = (ks: ClassKey[]) => ks.map(say).join(' and ');

/**
 * The flag in words. "Changed between Dec 2017 and Mar 2019: cropland and
 * grass → bare ground, and it stayed bare ground." With no change flagged,
 * what the captures agree on.
 */
export function yearsWords(h: Years): string {
  const n = h.caps.length;
  if (!n) return '';
  if (!h.flags.length) {
    const calls = new Set(h.g.map(v => YEAR_CLASSES[top(v)]));
    return calls.size === 1
      ? `No change found: ${say([...calls][0])} in all ${n} captures.`
      : `No change found across the ${n} captures.`;
  }
  return h.flags
    .map((f, k) => {
      const head = `${k ? 'Between' : 'Changed between'} ${monthYear(h.caps[f.i].date)} and ${monthYear(h.caps[f.i + 1].date)}: `,
        last = k === h.flags.length - 1,
        stays = last && h.g.slice(f.i + 1).every(v => YEAR_CLASSES[top(v)] === f.to[0]);
      return (
        head +
        `${both(f.from)} → ${both(f.to)}` +
        (stays && f.i + 2 < n ? `, and it stayed ${say(f.to[0])}` : '') +
        '.'
      );
    })
    .join(' ');
}
