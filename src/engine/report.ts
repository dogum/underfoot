/**
 * The route surface report: what a line runs over, by length, and what it
 * crosses, climbs and is unsure about. Pure; the transect card and the GeoJSON
 * export both read it.
 *
 * Lengths reconcile with the transect: each station's call covers its own
 * stretch of the line (spanBounds), exactly as the call strip draws it, so the
 * classes sum to the line's length.
 */
import type { ClassKey, Station } from '../core/types';

/** what the readout shows for one station: its call and how sure it is */
export interface StationCall {
  top: ClassKey;
  topP: number;
  /** 1 − H/Hmax, the gauge in the verdict */
  conf: number;
}
export interface ProfilePoint {
  d: number;
  z: number | null;
}
export interface ClassShare {
  cls: ClassKey;
  /** metres of line called this class */
  m: number;
  share: number;
  /** the longest unbroken run called this class */
  longest: { m: number; d0: number; d1: number };
}
export interface CrossingCount {
  cls: ClassKey;
  n: number;
  /** the distinct names the map gives them */
  names: string[];
}
export interface RouteReport {
  length: number;
  /** most to least */
  classes: ClassShare[];
  /** metres whose station hasn't answered yet */
  pending: number;
  crossings: CrossingCount[];
  /** metres up and down along the line; null without an elevation profile */
  climb: number | null;
  descent: number | null;
  /** the steepest grade held over at least GRADE_SPAN, signed along the line (+ is uphill) */
  steepest: { grade: number; d0: number; d1: number } | null;
  /** stations under DOUBT confidence, in order along the line */
  doubtful: { i: number; d: number; top: ClassKey; conf: number }[];
}

/** stations whose confidence is under this are listed as doubtful */
export const DOUBT = 0.4;
/** m: a climb counts once the line has risen this far from its last low (DEM noise isn't climbing) */
export const DEAD_BAND = 1;
/** m: the steepest grade is the steepest held over at least this far */
export const GRADE_SPAN = 20;
/**
 * Where each station's stretch of the line starts and ends: n + 1 bounds for
 * n stations, from 0 to the line's length. Between two ordinary stations the
 * bound is the midpoint. A crossing station covers what it crosses at its
 * mapped width, a road's 8 m rather than the gap to its neighbours, who take
 * the rest; two crossings side by side split the ground between their edges.
 */
export function spanBounds(stations: Station[]): number[] {
  const n = stations.length,
    L = n ? stations[n - 1].d : 0,
    b = [0];
  const half = (s: Station) => (s.x ? Math.max(0.5, s.x.w ?? 0.5) : null);
  for (let i = 1; i < n; i++) {
    const a = stations[i - 1],
      c = stations[i],
      ha = half(a),
      hc = half(c);
    let m = (a.d + c.d) / 2;
    if (ha != null && hc != null) m = (a.d + ha + (c.d - hc)) / 2;
    else if (ha != null) m = Math.min(m, a.d + ha);
    else if (hc != null) m = Math.max(m, c.d - hc);
    b.push(Math.min(c.d, Math.max(a.d, m)));
  }
  b.push(L);
  return b;
}

/** the order crossings are listed in: things you cross on foot first */
const CROSS_ORDER: ClassKey[] = ['paved', 'path', 'rail', 'water', 'building'];

export function routeReport(
  stations: Station[],
  calls: (StationCall | null | undefined)[],
  profile: ProfilePoint[] | null | undefined,
  names: (string | null | undefined)[] = [],
): RouteReport {
  const n = stations.length,
    L = n ? stations[n - 1].d : 0,
    B = spanBounds(stations);
  const from = (i: number) => B[i],
    to = (i: number) => B[i + 1];

  /* share of length, and the longest run, per class */
  const m = new Map<ClassKey, number>(),
    longest = new Map<ClassKey, { m: number; d0: number; d1: number }>();
  let pending = 0,
    run: { cls: ClassKey; d0: number } | null = null;
  const close = (end: number) => {
    if (!run) return;
    const len = end - run.d0,
      best = longest.get(run.cls);
    if (!best || len > best.m) longest.set(run.cls, { m: len, d0: run.d0, d1: end });
    run = null;
  };
  for (let i = 0; i < n; i++) {
    const c = calls[i],
      span = to(i) - from(i);
    if (!c) {
      pending += span;
      close(from(i));
      continue;
    }
    m.set(c.top, (m.get(c.top) || 0) + span);
    if (run && run.cls !== c.top) close(from(i));
    if (!run) run = { cls: c.top, d0: from(i) };
  }
  close(L);
  const classes = [...m]
    .map(([cls, len]) => ({ cls, m: len, share: L > 0 ? len / L : 0, longest: longest.get(cls)! }))
    .sort((a, b) => b.m - a.m);

  /* crossings by what was crossed */
  const cross = new Map<ClassKey, { n: number; names: Set<string> }>();
  stations.forEach((s, i) => {
    if (!s.x) return;
    const c = cross.get(s.x.cls) || { n: 0, names: new Set<string>() };
    c.n++;
    const nm = names[i] || s.x.name;
    if (nm) c.names.add(nm);
    cross.set(s.x.cls, c);
  });
  const crossings = [...cross]
    .map(([cls, c]) => ({ cls, n: c.n, names: [...c.names] }))
    .sort((a, b) => CROSS_ORDER.indexOf(a.cls) - CROSS_ORDER.indexOf(b.cls));

  /* climb with a dead band, and the steepest grade held over GRADE_SPAN */
  const pr = (profile || [])
    .filter((p): p is { d: number; z: number } => p.z != null)
    .sort((a, b) => a.d - b.d);
  let climb: number | null = null,
    descent: number | null = null,
    steepest: RouteReport['steepest'] = null;
  if (pr.length > 1) {
    climb = 0;
    descent = 0;
    let ref = pr[0].z;
    for (const p of pr) {
      if (p.z - ref >= DEAD_BAND) {
        climb += p.z - ref;
        ref = p.z;
      } else if (ref - p.z >= DEAD_BAND) {
        descent += ref - p.z;
        ref = p.z;
      }
    }
    for (let i = 0, j = 0; i < pr.length; i++) {
      while (j < pr.length && pr[j].d - pr[i].d < GRADE_SPAN) j++;
      if (j >= pr.length) break;
      const g = (pr[j].z - pr[i].z) / (pr[j].d - pr[i].d);
      if (!steepest || Math.abs(g) > Math.abs(steepest.grade))
        steepest = { grade: g, d0: pr[i].d, d1: pr[j].d };
    }
  }

  const doubtful = stations
    .map((s, i) => ({ i, d: s.d, c: calls[i] }))
    .filter(x => x.c && x.c.conf < DOUBT)
    .map(x => ({ i: x.i, d: x.d, top: x.c!.top, conf: x.c!.conf }));

  return { length: L, classes, pending, crossings, climb, descent, steepest, doubtful };
}
