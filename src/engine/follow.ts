/**
 * Follow the trail: find the stretches of a line that run along a mapped path
 * or road, and where on that path or road each point of a stretch most likely
 * is. Pure.
 *
 * A point dropped 2 m from a trail in a forest is fairly read as forest: the
 * map puts the tread within its error, and everything that sees area says
 * trees. A line that runs along that trail for 300 m, turning where it turns,
 * is different evidence. Being on the trail is then known the way a crossing
 * is known, and only the trail's existence is in doubt.
 */
import { haversine, projector } from '../core/geo';
import { clamp } from '../core/math';
import { NAME_CLS, lineRule } from './geometry';
import type { ClassKey, LatLon, TileFeature } from '../core/types';

/* ---- the model --------------------------------------------------------------
 * The line is sampled every few metres. At each sample a hidden state says
 * whether the walker is off any mapped line, on a path, or on a road. Roads are
 * in the model so that a line down a street isn't matched to the sidewalk
 * mapped beside it; following either one counts.
 *
 * Evidence for "on" at a sample is the distance to the nearest line of that
 * class, past its modelled half-width, under a heavy-tailed error (a Student-t,
 * so a fix 20 m off in a gorge costs a little, not a veto), and whether the
 * line runs parallel to it (axial von Mises: a crossing at right angles argues
 * against). "Off" is a flat density over the search radius. Changes of state
 * cost the same anywhere; Viterbi finds the likeliest sequence. Runs shorter
 * than `min` don't count: a line that grazes a path for 20 m isn't following
 * it.
 *
 * How far off is still "on" depends on where the line came from. A recorded
 * line (GPS fixes, a surveyed trail) has a vertex every few metres and wanders
 * by GPS error. A line drawn by hand has long straight chords, each placed to
 * within a few metres: 8 m beside a path is a choice, not noise. So the error
 * scale follows the length of the chord under each sample, and the samples on
 * one chord share that chord's evidence instead of each counting in full (a
 * 200 m chord is two clicks, not forty observations). */
export const FOLLOW_CLASSES = ['path', 'paved'] as const;
export type FollowClass = (typeof FOLLOW_CLASSES)[number];
export const FOLLOW = {
  /** m between samples (more on very long lines) */
  step: 5,
  /** m: farthest a followed line can be from the sample */
  radius: 40,
  /** m: GPS and map error together, the scale of the Student-t (ν = 4)… */
  scale: 7,
  /** …and for a chord drawn by hand, placed to a few metres */
  drawnScale: 3,
  /** m: chords up to this long are a recorded line's; from `drawn` up, a hand-drawn line's */
  recorded: 20,
  drawn: 60,
  /** m either side of a sample used to read the line's direction */
  heading: 10,
  /** how tightly a followed line runs parallel (von Mises κ on the doubled angle) */
  kappa: 2,
  /** m: mean distance between changes of state */
  run: 250,
  /** m: the shortest stretch that counts as following */
  min: 40,
  /** samples a few metres apart are not independent fixes */
  weight: 0.5,
  /** m: a chord longer than this counts as this much line, however many samples it gets */
  chord: 15,
};

export interface FollowStretch {
  cls: FollowClass;
  /** where the stretch starts and ends, in metres along the line */
  d0: number;
  d1: number;
  /** the mapped name, if the stretch mostly has one */
  name: string | null;
  /** what OpenStreetMap calls it: path, footway, track, street… */
  what: string;
  /** median distance from the line to the followed line, m */
  off: number;
  /** the followed path or road itself along the stretch, as [lat, lon] every few metres */
  geom: [number, number][];
}
export interface Snapped extends LatLon {
  /** how far the point moved to reach the followed line, m */
  off: number;
}
export interface FollowMatch {
  stretches: FollowStretch[];
  /** the index of the stretch covering distance d along the line, or −1 */
  at(d: number): number;
  /** the nearest point on the followed line, for a point at distance d */
  snap(p: LatLon, d: number): Snapped | null;
}
export const NO_FOLLOW: FollowMatch = { stretches: [], at: () => -1, snap: () => null };

/* ---- segments and a grid to find them ------------------------------------- */
interface Seg {
  ax: number;
  ay: number;
  ux: number;
  uy: number;
  len: number;
  /** the class this segment belongs to (a road or path), or a name class */
  cls: string;
  w: number;
  what: string;
  name?: string;
}
class Grid {
  private cells = new Map<number, Seg[]>();
  constructor(private size: number) {}
  private key(ix: number, iy: number) {
    return (ix + 32768) * 65536 + (iy + 32768);
  }
  add(s: Seg) {
    const bx = s.ax + s.ux * s.len,
      by = s.ay + s.uy * s.len,
      c = this.size;
    for (let ix = Math.floor(Math.min(s.ax, bx) / c); ix <= Math.floor(Math.max(s.ax, bx) / c); ix++)
      for (let iy = Math.floor(Math.min(s.ay, by) / c); iy <= Math.floor(Math.max(s.ay, by) / c); iy++) {
        const k = this.key(ix, iy),
          a = this.cells.get(k);
        a ? a.push(s) : this.cells.set(k, [s]);
      }
  }
  near(x: number, y: number, r: number): Set<Seg> {
    const out = new Set<Seg>(),
      c = this.size;
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++)
      for (let iy = Math.floor((y - r) / c); iy <= Math.floor((y + r) / c); iy++) {
        const a = this.cells.get(this.key(ix, iy));
        if (a) for (const s of a) out.add(s);
      }
    return out;
  }
}
/** distance from (x, y) to a segment, and the foot of the perpendicular */
function foot(s: Seg, x: number, y: number) {
  const t = clamp((x - s.ax) * s.ux + (y - s.ay) * s.uy, 0, s.len),
    fx = s.ax + s.ux * t,
    fy = s.ay + s.uy * t;
  return { d: Math.hypot(x - fx, y - fy), fx, fy };
}

/* ---- per-sample evidence -------------------------------------------------- */
const besselI0 = (x: number) => {
  let s = 1,
    t = 1;
  for (let k = 1; k < 30; k++) {
    t *= (x * x) / (4 * k * k);
    s += t;
  }
  return s;
};
/** log density ratio, on vs off, of being d metres from a followed line, at error scale s */
export function distLL(d: number, s = FOLLOW.scale) {
  return Math.log((0.75 * FOLLOW.radius) / s) - 2.5 * Math.log(1 + (d * d) / (4 * s * s));
}
/** log density ratio, on vs off, of the line and the mapped line meeting at this angle (|cos|) */
export function headLL(cosAbs: number) {
  const k = FOLLOW.kappa;
  return k * (2 * cosAbs * cosAbs - 1) - Math.log(besselI0(k));
}
const NONE = -8; // no line of this class within the radius

interface Cand {
  seg: Seg;
  d: number;
  fx: number;
  fy: number;
  ll: number;
}
function bestOf(
  grid: Grid,
  cls: string,
  x: number,
  y: number,
  hx: number,
  hy: number,
  sc: number,
): Cand | null {
  let best: Cand | null = null;
  for (const s of grid.near(x, y, FOLLOW.radius + 10)) {
    if (s.cls !== cls) continue;
    const f = foot(s, x, y);
    if (f.d > FOLLOW.radius + s.w) continue;
    let ll = distLL(Math.max(0, f.d - s.w), sc);
    if (hx || hy) ll += headLL(Math.abs(hx * s.ux + hy * s.uy));
    if (!best || ll > best.ll) best = { seg: s, ...f, ll };
  }
  return best;
}

/* ---- matching ------------------------------------------------------------- */
export interface FollowOptions {
  /** a live track: its end is "now", not where the walk stopped, so ending on a mapped line costs nothing */
  openEnd?: boolean;
}
export function followLines(
  v: LatLon[],
  feats: TileFeature[] | null | undefined,
  opt: FollowOptions = {},
): FollowMatch {
  if (!v || v.length < 2 || !feats || !feats.length) return NO_FOLLOW;
  const cum = [0];
  for (let i = 1; i < v.length; i++) cum.push(cum[i - 1] + haversine(v[i - 1], v[i]));
  const L = cum[cum.length - 1];
  if (L < FOLLOW.min) return NO_FOLLOW;
  const P = projector(v[0].lat, v[0].lon);
  const at = (d: number): [number, number] => {
    let j = 0;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const t = clamp((d - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9), 0, 1);
    return P.fwd(v[j].lat + (v[j + 1].lat - v[j].lat) * t, v[j].lon + (v[j + 1].lon - v[j].lon) * t);
  };

  /* the mapped roads, paths and their names near the line */
  const pad = (FOLLOW.radius + 30) / 111320,
    padLon = pad / Math.max(0.15, Math.cos((v[0].lat * Math.PI) / 180));
  const lats = v.map(p => p.lat),
    lons = v.map(p => p.lon);
  const W = [
    Math.min(...lons) - padLon,
    Math.min(...lats) - pad,
    Math.max(...lons) + padLon,
    Math.max(...lats) + pad,
  ];
  const grid = new Grid(40),
    names = new Grid(40);
  for (const f of feats) {
    if (f.t !== 2 || f.bb[2] < W[0] || f.bb[0] > W[2] || f.bb[3] < W[1] || f.bb[1] > W[3]) continue;
    const isName = f.L === 'transportation_name';
    const lr = isName ? null : lineRule(f.L, f.p);
    if (isName ? !f.p.name : !lr || !(FOLLOW_CLASSES as readonly string[]).includes(lr.cls)) continue;
    for (const r of f.r)
      for (let k = 0; k + 3 < r.length; k += 2) {
        const [ax, ay] = P.fwd(r[k + 1], r[k]),
          [bx, by] = P.fwd(r[k + 3], r[k + 2]),
          len = Math.hypot(bx - ax, by - ay);
        if (len < 0.05) continue;
        const s: Seg = { ax, ay, ux: (bx - ax) / len, uy: (by - ay) / len, len, cls: '', w: 0, what: '' };
        if (isName) names.add({ ...s, cls: f.p.class, name: f.p.name });
        else grid.add({ ...s, cls: lr!.cls, w: lr!.w, what: lr!.what });
      }
  }

  /* samples along the line, each with the line's own direction there */
  const step = Math.max(FOLLOW.step, L / 3000),
    n = Math.floor(L / step) + 1;
  const sd: number[] = [],
    sx: number[] = [],
    sy: number[] = [],
    hx: number[] = [],
    hy: number[] = [],
    sc: number[] = [],
    sw: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = i === n - 1 ? L : i * step;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const chord = cum[j + 1] - cum[j],
      t = clamp((chord - FOLLOW.recorded) / (FOLLOW.drawn - FOLLOW.recorded), 0, 1);
    sc.push(FOLLOW.scale + (FOLLOW.drawnScale - FOLLOW.scale) * t);
    sw.push(FOLLOW.weight * Math.min(1, FOLLOW.chord / Math.max(chord, 1e-9)));
    const [x, y] = at(d),
      [x0, y0] = at(Math.max(0, d - FOLLOW.heading)),
      [x1, y1] = at(Math.min(L, d + FOLLOW.heading)),
      h = Math.hypot(x1 - x0, y1 - y0);
    sd.push(d);
    sx.push(x);
    sy.push(y);
    hx.push(h > 1 ? (x1 - x0) / h : 0);
    hy.push(h > 1 ? (y1 - y0) / h : 0);
  }

  /* Viterbi over off / path / road */
  const S = 1 + FOLLOW_CLASSES.length,
    pSw = 1 - Math.exp(-step / FOLLOW.run),
    stay = Math.log(1 - pSw),
    move = Math.log(pSw / (S - 1));
  const cands: (Cand | null)[][] = [],
    back: Int8Array[] = [];
  /* the line starts and ends off any mapped line: following from the first
     sample, or to the last, costs a change of state like anywhere else, so a
     whole line needs as much evidence to follow as a stretch inside one. A
     live track (openEnd) hasn't ended: its last fix is just the newest one */
  let V = [0, ...FOLLOW_CLASSES.map(() => move)];
  for (let i = 0; i < n; i++) {
    const c = FOLLOW_CLASSES.map(k => bestOf(grid, k, sx[i], sy[i], hx[i], hy[i], sc[i]));
    cands.push(c);
    const e = [0, ...c.map(b => sw[i] * (b ? b.ll : NONE))];
    const nv = new Array(S),
      bk = new Int8Array(S);
    for (let s = 0; s < S; s++) {
      let m = -Infinity;
      for (let r = 0; r < S; r++) {
        const x = V[r] + (i === 0 ? (r === s ? 0 : -Infinity) : r === s ? stay : move);
        if (x > m) {
          m = x;
          bk[s] = r;
        }
      }
      nv[s] = m + e[s];
    }
    V = nv;
    back.push(bk);
  }
  const lab = new Int8Array(n);
  const fin = V.map((x, s) => x + (s && !opt.openEnd ? move : 0));
  lab[n - 1] = fin.indexOf(Math.max(...fin));
  for (let i = n - 1; i > 0; i--) lab[i - 1] = back[i][lab[i]];

  /* runs shorter than `min` don't count: a short run between two runs of
     the same class joins them, any other becomes "off" */
  const runs = () => {
    const out: { s: number; i0: number; i1: number }[] = [];
    for (let i = 0; i < n; i++)
      if (i && lab[i] === lab[i - 1]) out[out.length - 1].i1 = i;
      else out.push({ s: lab[i], i0: i, i1: i });
    return out;
  };
  const span = (r: { i0: number; i1: number }) => sd[r.i1] - sd[r.i0] + step;
  for (let pass = 0; pass < 4; pass++) {
    const R = runs();
    let changed = false;
    R.forEach((r, j) => {
      if (!r.s || span(r) >= FOLLOW.min) return;
      const a = R[j - 1],
        b = R[j + 1],
        to = a && b && a.s === b.s && a.s ? a.s : 0;
      lab.fill(to, r.i0, r.i1 + 1);
      changed = true;
    });
    if (!changed) break;
  }

  const stretches: FollowStretch[] = [];
  for (const r of runs()) {
    if (!r.s || span(r) < FOLLOW.min) continue;
    const cls = FOLLOW_CLASSES[r.s - 1],
      offs: number[] = [],
      geom: [number, number][] = [],
      nameN = new Map<string, number>(),
      whatN = new Map<string, number>();
    for (let i = r.i0; i <= r.i1; i++) {
      const c = cands[i][r.s - 1];
      if (!c) continue;
      offs.push(c.d);
      geom.push(P.inv(c.fx, c.fy));
      whatN.set(c.seg.what, (whatN.get(c.seg.what) || 0) + 1);
      let nm: string | undefined,
        nd = 6;
      for (const s of names.near(c.fx, c.fy, nd)) {
        if (!NAME_CLS[cls].includes(s.cls)) continue;
        const f = foot(s, c.fx, c.fy);
        if (f.d < nd) {
          nd = f.d;
          nm = s.name;
        }
      }
      if (nm) nameN.set(nm, (nameN.get(nm) || 0) + 1);
    }
    const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0];
    const nm = top(nameN);
    offs.sort((a, b) => a - b);
    stretches.push({
      cls,
      d0: r.i0 === 0 ? 0 : Math.max(0, sd[r.i0] - step / 2),
      d1: r.i1 === n - 1 ? L : Math.min(L, sd[r.i1] + step / 2),
      name: nm && nm[1] >= 0.3 * (r.i1 - r.i0 + 1) ? nm[0] : null,
      what: (top(whatN) || [cls])[0],
      off: offs.length ? offs[offs.length >> 1] : 0,
      geom,
    });
  }

  /* stations are placed by their own arithmetic: allow for its rounding at the ends */
  const atD = (d: number) => stretches.findIndex(s => d >= s.d0 - 1e-6 * L && d <= s.d1 + 1e-6 * L);
  return {
    stretches,
    at: atD,
    snap(p, d) {
      const k = atD(d);
      if (k < 0) return null;
      const i = clamp(Math.round(d / step), 0, n - 1),
        [x, y] = P.fwd(p.lat, p.lon),
        c = bestOf(grid, stretches[k].cls, x, y, hx[i], hy[i], sc[i]);
      if (!c) return null;
      const [lat, lon] = P.inv(c.fx, c.fy);
      return { lat, lon, off: c.d };
    },
  };
}
