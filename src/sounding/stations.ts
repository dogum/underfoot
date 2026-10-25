/**
 * Stations along a line: spacing, interpolation, and the crossing stations
 * placed wherever the line meets a mapped road, path, rail line or stream.
 * Shared by the app and the headless reader; pure.
 */
import { MAX_STATIONS } from './run';
import { areaStations } from './area';
import { haversine, polyD2, projector, ringContains } from '../core/geo';
import { clamp, lerp } from '../core/math';
import { GEOM_ERR } from '../engine/evidence';
import { NO_FOLLOW } from '../engine/follow';
import { lineRule } from '../engine/geometry';
import type { FollowMatch } from '../engine/follow';
import type { ClassKey, Crossing, LatLon, LineRule, Mode, Station, TileFeature } from '../core/types';

type XY = [number, number];

/* ---- stations from vertices ---------------------------------------------- */
/** metres along the line at each vertex */
export function cumLen(v: LatLon[]): number[] {
  const c = [0];
  for (let i = 1; i < v.length; i++) c.push(c[i - 1] + haversine(v[i - 1], v[i]));
  return c;
}
/** the point d metres along the line */
export function along(v: LatLon[], cum: number[], d: number): LatLon {
  let j = 0;
  while (j < cum.length - 2 && cum[j + 1] < d) j++;
  const t = clamp((d - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9), 0, 1);
  return { lat: lerp(v[j].lat, v[j + 1].lat, t), lon: lerp(v[j].lon, v[j + 1].lon, t) };
}
/** the stations for what's drawn: evenly spaced along a line, one per tile of an area, each point of a batch */
export function stationsFor(run: { verts: LatLon[]; mode: Mode; spacing: string }): Station[] {
  const v = run.verts;
  if (!v.length) return [];
  if (run.mode === 'area') return areaStations(v);
  /* a batch's group: each point is a station of its own (app/batch) */
  if (run.mode === 'batch') return v.map((p, i) => ({ ...p, d: i }));
  if (run.mode === 'point' || v.length < 2) return [{ ...v[v.length - 1], d: 0 }];
  const cum = cumLen(v),
    L = cum[cum.length - 1];
  if (L < 1) return [{ ...v[0], d: 0 }];
  if (run.spacing === '0') {
    if (v.length <= MAX_STATIONS) return v.map((p, i) => ({ ...p, d: cum[i] }));
    return Array.from({ length: MAX_STATIONS }, (_, k) => {
      const d = (L * k) / (MAX_STATIONS - 1);
      return { ...along(v, cum, d), d };
    });
  }
  const want = run.spacing === 'auto' ? Math.max(L / (MAX_STATIONS - 1), 4) : +run.spacing;
  const n = clamp(Math.floor(L / want) + 1, 2, MAX_STATIONS);
  return Array.from({ length: n }, (_, k) => {
    const d = (L * k) / (n - 1);
    return { ...along(v, cum, d), d };
  });
}

/* ---- feature-aware stations ----------------------------------------------
 * Evenly spaced stations step straight over narrow things: at 15 m spacing an
 * 8 m road can fall between two of them and the transect never shows the line
 * crossing it — which is the one thing a transect is for. So once the OSM
 * tiles are in, every place the line crosses a mapped road, path, rail line or
 * stream, or passes through a building, gets a station of its own. */
export const MAX_CROSS = 24;
export function findCrossings(
  v: LatLon[],
  feats: TileFeature[] | null | undefined,
  fol: FollowMatch = NO_FOLLOW,
): Crossing[] {
  if (v.length < 2 || !feats || !feats.length) return [];
  const P = projector(v[0].lat, v[0].lon),
    pv = v.map(p => P.fwd(p.lat, p.lon)),
    cum = cumLen(v),
    out: Crossing[] = [];
  const pb = [
    Math.min(...v.map(p => p.lon)),
    Math.min(...v.map(p => p.lat)),
    Math.max(...v.map(p => p.lon)),
    Math.max(...v.map(p => p.lat)),
  ];
  const hit = (bb: number[]) => !(bb[2] < pb[0] || bb[0] > pb[2] || bb[3] < pb[1] || bb[1] > pb[3]);
  const segX = (a: XY, b: XY, c: XY, d: XY) => {
    const r = [b[0] - a[0], b[1] - a[1]],
      s_ = [d[0] - c[0], d[1] - c[1]],
      den = r[0] * s_[1] - r[1] * s_[0];
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * s_[1] - (c[1] - a[1]) * s_[0]) / den,
      u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  };
  const dAt = (i: number, t: number) => cum[i] + t * (cum[i + 1] - cum[i]);
  /* Along a stretch that follows a mapped path or road, the line weaves across
     it with every wobble of a GPS fix or a hand-drawn line: those aren't
     crossings. Anything else crossed there is kept only where the followed
     line crosses it too (a footbridge over a creek), not where the line
     wandered over a river running beside the trail. */
  /* A river crossed on a bridge is crossed on the deck: the surface there is
     the bridge's (path, road, rail), not the water under it. A water crossing
     that falls on a mapped bridge, within its half-width and the map's error,
     becomes a crossing of the bridge. A ford stays water. */
  const bridges: { flat: number[]; lr: LineRule }[] = [],
    pad = 30 / 111320,
    near = (bb: number[]) =>
      !(bb[2] < pb[0] - pad || bb[0] > pb[2] + pad || bb[3] < pb[1] - pad || bb[1] > pb[3] + pad);
  for (const f of feats) {
    if (f.t !== 2 || f.p.brunnel !== 'bridge' || !near(f.bb)) continue;
    const lr = lineRule(f.L, f.p);
    if (!lr || lr.cls === 'water') continue;
    for (const r of f.r) {
      const flat: number[] = [];
      for (let k = 0; k < r.length; k += 2) flat.push(...P.fwd(r[k + 1], r[k]));
      bridges.push({ flat, lr });
    }
  }
  const deck = (i: number, t: number) => {
    const x = pv[i][0] + t * (pv[i + 1][0] - pv[i][0]),
      y = pv[i][1] + t * (pv[i + 1][1] - pv[i][1]);
    let best: LineRule | null = null,
      bd = GEOM_ERR;
    for (const b of bridges) {
      const d = Math.sqrt(polyD2(x, y, b.flat)) - b.lr.w;
      if (d < bd) {
        bd = d;
        best = b.lr;
      }
    }
    return best;
  };
  const followed = (i: number, t: number, cls: ClassKey, q: XY[], tol: number) => {
    const d = dAt(i, t),
      k = fol.at(d);
    if (k < 0) return true;
    if (fol.stretches[k].cls === cls) return false;
    const [lat, lon] = P.inv(
        pv[i][0] + t * (pv[i + 1][0] - pv[i][0]),
        pv[i][1] + t * (pv[i + 1][1] - pv[i][1]),
      ),
      sp = fol.snap({ lat, lon }, d);
    if (!sp) return true;
    const [x, y] = P.fwd(sp.lat, sp.lon),
      flat = q.flat();
    return (cls === 'building' && ringContains(x, y, flat)) || polyD2(x, y, flat) <= tol * tol;
  };
  for (const f of feats) {
    if (!hit(f.bb)) continue;
    if (f.t === 2) {
      const lr = lineRule(f.L, f.p);
      if (!lr) continue;
      for (const r of f.r) {
        const q: XY[] = [];
        for (let k = 0; k < r.length; k += 2) q.push(P.fwd(r[k + 1], r[k]));
        for (let i = 0; i < pv.length - 1; i++)
          for (let k = 0; k < q.length - 1; k++) {
            const t = segX(pv[i], pv[i + 1], q[k], q[k + 1]);
            if (t == null) continue;
            const on = lr.cls === 'water' ? deck(i, t) : null,
              c: Crossing = on
                ? { d: dAt(i, t), cls: on.cls, what: 'bridge', name: null, over: lr.what, w: on.w }
                : { d: dAt(i, t), cls: lr.cls, what: lr.what, name: null, w: lr.w };
            if (followed(i, t, c.cls, q, lr.w + 3)) out.push(c);
          }
      }
    } else if (f.t === 3 && f.L === 'building') {
      for (const r of f.r) {
        const q: XY[] = [];
        for (let k = 0; k < r.length; k += 2) q.push(P.fwd(r[k + 1], r[k]));
        const ds: { d: number; i: number; t: number }[] = [];
        for (let i = 0; i < pv.length - 1; i++)
          for (let k = 0; k < q.length - 1; k++) {
            const t = segX(pv[i], pv[i + 1], q[k], q[k + 1]);
            if (t != null) ds.push({ d: dAt(i, t), i, t });
          }
        ds.sort((a, b) => a.d - b.d);
        for (let k = 0; k + 1 < ds.length; k += 2) {
          const a = ds[k],
            b = ds[k + 1],
            m = (a.d + b.d) / 2,
            mi = a.i === b.i ? a.i : m < cum[a.i + 1] ? a.i : b.i,
            mt = clamp((m - cum[mi]) / Math.max(cum[mi + 1] - cum[mi], 1e-9), 0, 1);
          if (followed(mi, mt, 'building', q, 2))
            out.push({ d: m, cls: 'building', what: 'building', name: null, w: (b.d - a.d) / 2 });
        }
      }
    }
  }
  out.sort((a, b) => a.d - b.d);
  const ded: Crossing[] = [];
  for (const c of out) {
    const last = ded[ded.length - 1];
    if (last && last.cls === c.cls && Math.abs(last.d - c.d) < 3) continue;
    ded.push(c);
  }
  /* keep the most informative when there are too many: objects before streams */
  const rank: Partial<Record<ClassKey, number>> = { paved: 0, rail: 1, building: 2, path: 3, water: 4 };
  return ded
    .sort((a, b) => rank[a.cls]! - rank[b.cls]!)
    .slice(0, MAX_CROSS)
    .sort((a, b) => a.d - b.d)
    .filter(c => c.d > 1 && c.d < cum[cum.length - 1] - 1);
}
/** the line's stations with a station of its own at each crossing */
export function mergeCrossings(v: LatLon[], base: Station[], cross: Crossing[]): Station[] {
  if (!cross.length) return base;
  const cum = cumLen(v);
  const xs = cross.map(c => ({ ...along(v, cum, c.d), d: c.d, x: c }));
  /* a regular station within 2 m of a crossing is redundant */
  const kept = base.filter(s => !xs.some(x => Math.abs(x.d - s.d) < 2));
  return kept.concat(xs).sort((a, b) => a.d - b.d);
}

/* ---- stations on a followed stretch sit on the path or road it follows ---- */
export function snapStations(st: Station[], fol: FollowMatch = NO_FOLLOW): Station[] {
  if (!fol.stretches.length) return st;
  return st.map(s => {
    const k = fol.at(s.d);
    if (k < 0) return s;
    const sp = fol.snap(s, s.d);
    if (!sp) return s;
    const out: Station = { ...s, lat: sp.lat, lon: sp.lon, raw: { lat: s.lat, lon: s.lon } };
    /* a crossing station keeps its own meaning; it just moves onto the followed line */
    if (!s.x) out.f = { k, cls: fol.stretches[k].cls, off: sp.off };
    return out;
  });
}
