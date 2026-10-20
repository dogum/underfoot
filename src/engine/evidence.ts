/**
 * Evidence: one function per source, each returning a centred log-likelihood
 * over the classes, a status, and the reasoning shown in the ledger. Here the
 * map's polygons and lines, US building footprints and the imagery; NLCD in
 * engine/nlcd, terrain in engine/terrain, the gazetteer in engine/gazetteer,
 * and the newer sources in their own modules. Pure.
 */
import { CIX, NAME } from '../core/classes';
import { Phi, add, centre, clamp, fmt, lodds, zeros } from '../core/math';
import { POLY_RULES, RULE_ORDER, USE_RULES } from './geometry';
import { IMG_MODEL, imgLogLik } from './imagery-model';
import type {
  ClassKey,
  ExactTerm,
  GeoQuery,
  ImgFeatures,
  SourcePart,
  StationFacts,
  StructAttrs,
} from '../core/types';

/* ---------------------------------------------------- evidence sources */
export const GEOM_ERR = 1.8; // metres: OSM centreline vs the real tread
export const EDGE_ERR = 3.0; // metres: OSM polygon boundary vs the real edge
/** the tread classes a mapped line can be */
type Tread = 'paved' | 'path' | 'rail' | 'water';
/* share of each tread class that is a mapped line in OSM (the rest is
   driveways, plazas, desire lines, culverted ditches…) */
export const MAPPED_SHARE: Record<Tread, number> = { paved: 0.6, path: 0.7, rail: 0.95, water: 0.8 };

export function srcContain(sh: StationFacts, q: GeoQuery | null | undefined): SourcePart {
  if (sh.osmErr)
    return {
      ll: zeros(),
      status: 'err',
      note: 'OpenStreetMap tiles failed — ' + sh.osmErr + '\nThis is "could not look", not "nothing here".',
    };
  if (!q) return { ll: zeros(), status: 'wait' };
  const hits = q.enclosing.slice().sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
  if (!hits.length) return { ll: zeros(), status: 'ok', note: 'no mapped polygon encloses the point' };
  const ll = zeros(),
    names: string[] = [],
    seen = new Set<string>();
  let rank = 0;
  for (const h of hits) {
    if (seen.has(h.rule)) continue;
    seen.add(h.rule);
    const [vec, label] = POLY_RULES[h.rule];
    let scale = rank === 0 ? 1 : 0.55;
    /* a land-USE polygon says less the bigger it is (a 4 km² park is mostly
       not lawn); a land-COVER polygon — a lake, a wood, a glacier — means the
       same thing at any size, and tiles clip big ones to arbitrary areas anyway */
    if (USE_RULES.has(h.rule) && h.area && isFinite(h.area))
      scale *= clamp(1.25 - Math.log10(Math.max(h.area, 30)) / 5.2, 0.5, 1.15);
    /* a polygon edge is good to a few metres, so right on the boundary you do
       not know which side you are on: P(truly inside) = Φ(d_edge / 3 m) */
    if (h.edge != null && isFinite(h.edge)) scale *= clamp(2 * Phi(h.edge / EDGE_ERR) - 1, 0, 1);
    add(ll, vec, scale);
    names.push(
      (h.name ? h.name + ' · ' : '') +
        label +
        (h.rule === 'building' ? ` (${Math.round(h.area)} m²)` : '') +
        (h.edge < 6 ? ` — ${fmt(h.edge, 1)} m from its edge` : ''),
    );
    rank++;
  }
  return { ll: centre(ll), status: 'ok', note: sh.lite ? '' : 'inside: ' + names.slice(0, 4).join('  ·  ') };
}
export function srcProx(sh: StationFacts, q: GeoQuery | null | undefined): SourcePart {
  if (sh.osmErr) return { ll: zeros(), status: 'err', note: 'OpenStreetMap tiles failed — ' + sh.osmErr };
  if (!q) return { ll: zeros(), status: 'wait' };
  const ll = zeros(),
    notes: string[] = [],
    b = q.best,
    inW = q.enclosing.some(e => e.rule === 'water' || e.rule === 'water_int');
  let exact: ExactTerm | null = null;
  for (const cls of ['paved', 'path', 'rail', 'water'] as Tread[]) {
    const f = b[cls];
    if (!f) continue;
    /* at a crossing station the position is DEFINED by the crossing: lateral
       map error slides the crossing along the line, never off it, so the only
       doubt left is whether the feature exists at all. A station on a stretch
       that follows a mapped path or road is known the same way: the whole
       stretch ran along it (engine/follow), and the station sits on it. */
    if (q.crossing === cls || q.follow === cls) {
      exact = { cls, p: Math.max(0.93, Phi((f.w - f.d) / GEOM_ERR)) };
      if (!sh.lite)
        notes.push(
          q.crossing === cls && q.over
            ? `the line crosses the ${q.over} on ${f.name || 'a ' + f.what + ' bridge'} here → P(on)=${fmt(exact.p * 100, 0)}% — it's on the deck, not in the water`
            : q.crossing === cls
              ? `the line crosses ${f.name || 'this ' + f.what} here → P(on)=${fmt(exact.p * 100, 0)}% — position along the line is exact by construction, so only existence is in doubt`
              : `the line follows ${f.name || 'this ' + f.what} here → P(on)=${fmt(exact.p * 100, 0)}% — it ran along it, so only existence is in doubt`,
        );
      continue;
    }
    /* Not every paved surface is a mapped carriageway — driveways, plazas,
       parking lanes and unmapped trails exist. So the likelihood is a mixture:
       P(cls | d) ∝ mapped·LR_on(d) + (1-mapped). Right on the centreline it is
       strongly positive; a few metres off it costs log(1-mapped), not −3 nats. */
    const pOn = Phi((f.w - f.d) / GEOM_ERR),
      lr = pOn / (1 - pOn),
      m = MAPPED_SHARE[cls];
    const lo = clamp(Math.log(m * lr + (1 - m)), -4.2, 5);
    /* a waterway centreline only guesses its width (8 m either side for any
       river), and the Merced in Yosemite Valley is 33 m bank to bank. Inside a
       mapped water polygon the banks are known, so the guess can't argue
       against water there */
    if (cls === 'water' && inW && lo < 0) {
      if (!sh.lite)
        notes.push(
          `${f.name || f.what} ${fmt(f.d, 1)} m · inside the mapped water, so its guessed half-width (≈${fmt(f.w, 1)} m) doesn't count against it`,
        );
      continue;
    }
    ll[CIX[cls]] += lo;
    if (lo > -1.5 && !sh.lite)
      notes.push(
        `${f.name || f.what} ${fmt(f.d, 1)} m · half-width ≈${fmt(f.w, 1)} m → P(on)=${fmt(pOn * 100, 0)}%`,
      );
  }
  const inBld = q.enclosing.some(e => e.rule === 'building');
  if (!inBld && q.bD < 14) {
    const pIn = Phi((1.2 - q.bD) / 2.2);
    ll[CIX.building] += clamp(lodds(pIn), -3, 2.4);
    if (pIn > 0.08) notes.push(`mapped building ${fmt(q.bD, 1)} m away → P(inside)=${fmt(pIn * 100, 0)}%`);
  }
  /* the map's silence counts, but only where the map is dense enough for
     silence to mean something */
  const inf = clamp(q.density / 25, 0, 1);
  if (inf > 0.15) {
    if (!b.paved || b.paved.d > 45) {
      ll[CIX.paved] -= 1.7 * inf;
      notes.push(
        `no road within ${b.paved ? fmt(b.paved.d, 0) + ' m' : 'the window'} (map density ${fmt(inf * 100, 0)}%)`,
      );
    }
    if (!b.path || b.path.d > 35) ll[CIX.path] -= 1.4 * inf;
    if (!b.rail || b.rail.d > 60) ll[CIX.rail] -= 2.0 * inf;
    if (!inBld && q.bD > 50) ll[CIX.building] -= 1.5 * inf;
    if (!inW && (!b.water || b.water.d > 60)) ll[CIX.water] -= 1.6 * inf;
  }
  return {
    ll: centre(ll),
    status: 'ok',
    exact,
    note: sh.lite ? '' : notes.length ? notes.slice(0, 4).join('\n') : 'no mapped line near the point',
  };
}
export const FT2 = 0.09290304;
export function srcStruct(sh: StationFacts, q: GeoQuery | null | undefined): SourcePart {
  if (!sh.inUS) return { ll: zeros(), status: 'na', note: 'USA Structures covers the United States only' };
  if (sh.structErr) return { ll: zeros(), status: 'err', note: 'footprint service failed — ' + sh.structErr };
  if (!q || !sh.structOk) return { ll: zeros(), status: 'wait' };
  const ll = zeros();
  let note: string;
  const desc = (a: StructAttrs) =>
    [
      a.PRIM_OCC && a.PRIM_OCC !== 'Unclassified' ? a.PRIM_OCC : a.OCC_CLS,
      a.HEIGHT ? `${fmt(a.HEIGHT, 1)} m tall` : null,
      a.SQFEET ? `${Math.round(a.SQFEET * FT2).toLocaleString()} m² floor` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  if (q.stIn) {
    add(ll, {
      building: 5.0,
      paved: -1.0,
      forest: -2.0,
      water: -2.6,
      grass: -1.8,
      crop: -2.4,
      bare: -1.4,
      snow: -1.8,
    });
    note = 'inside a surveyed footprint: ' + desc(q.stIn.attr);
  } else {
    const d = q.stD;
    const pIn = Phi((0.8 - d) / 1.6);
    ll[CIX.building] += clamp(lodds(pIn), -2.2, 2.2);
    note =
      d < 45
        ? `nearest footprint ${fmt(d, 1)} m away — ${desc(q.stNear!.attr)}`
        : 'no surveyed structure within 45 m';
  }
  return { ll: centre(ll), status: 'ok', note };
}
export function srcImage(sh: StationFacts, feat: ImgFeatures | null | undefined): SourcePart {
  if (sh.imgErr) return { ll: zeros(), status: 'na', note: sh.imgErr };
  if (!feat) return { ll: zeros(), status: 'wait' };
  const lp = imgLogLik(feat.v),
    ll = zeros();
  if (sh.lite) {
    let s0 = 0;
    for (const c of IMG_MODEL.classes) {
      ll[CIX[c as ClassKey]] = lp[c];
      s0 += lp[c];
    }
    const m0 = s0 / IMG_MODEL.classes.length;
    const wh = feat.core.L > 0.72 && feat.core.S < 0.12,
      al = (sh.terr && sh.terr.z > 1800) || (sh.pt && Math.abs(sh.pt.lat) > 62);
    ll[CIX.path] = m0;
    ll[CIX.rail] = m0;
    ll[CIX.snow] = wh ? (al ? Math.max(...IMG_MODEL.classes.map(k => lp[k])) + 0.4 : lp.bare) : m0 - 1.5;
    return { ll: centre(ll), status: 'ok', wmul: sh.imgWmul || 1 };
  }
  let s = 0;
  for (const c of IMG_MODEL.classes) {
    ll[CIX[c as ClassKey]] = lp[c];
    s += lp[c];
  }
  const mean = s / IMG_MODEL.classes.length;
  /* a canopied trail is pixel-identical to its canopy and a rail bed to a
     road, so those abstain; a white surface might be snow or a salt flat */
  ll[CIX.path] = mean;
  ll[CIX.rail] = mean;
  /* bright, unsaturated pixels are snow or a salt flat / white sand — the
     pixels cannot tell which, but altitude and latitude can */
  const white = feat.core.L > 0.72 && feat.core.S < 0.12,
    alpine = (sh.terr && sh.terr.z > 1800) || (sh.pt && Math.abs(sh.pt.lat) > 62);
  ll[CIX.snow] = white
    ? alpine
      ? Math.max(...IMG_MODEL.classes.map(k => lp[k])) + 0.4
      : lp.bare
    : mean - 1.5;
  const c = feat.core;
  const note =
    `L ${fmt(c.L, 2)}  green ${fmt(c.G, 3)}  blue ${fmt(c.B, 3)}  texture ${fmt(c.sd, 3)}  edge ${fmt(c.edge, 3)}` +
    `\nmodel's own call: ${NAME[(IMG_MODEL.classes as ClassKey[])[IMG_MODEL.classes.map(k => lp[k]).indexOf(Math.max(...IMG_MODEL.classes.map(k => lp[k])))]]}` +
    ` · fitted on ${IMG_MODEL.n.toLocaleString('en-US')} labelled z18 patches, ${Math.round(IMG_MODEL.cv.balanced * 100)}% balanced accuracy unaided`;
  return { ll: centre(ll), status: 'ok', note, wmul: sh.imgWmul || 1 };
}
