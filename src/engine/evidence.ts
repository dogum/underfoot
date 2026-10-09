// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Evidence: one function per source, each returning a centred log-likelihood
 * over the classes, a status, and the reasoning shown in the ledger. Pure.
 */
import { CIX, K, NAME } from '../core/classes';
import { polyD2, projector, ringContains } from '../core/geo';
import { Phi, add, centre, clamp, fmt, zeros } from '../core/math';
import { POLY_RULES, RULE_ORDER, USE_RULES } from './geometry';
import { IMG_MODEL, imgLogLik } from './imagery-model';

/* ---------------------------------------------------- evidence sources */
export const GEOM_ERR = 1.8; // metres: OSM centreline vs the real tread
export const EDGE_ERR = 3.0; // metres: OSM polygon boundary vs the real edge
/* Heavy-tailed (Student-t, ν=5) log-kernel for the continuous signatures.
   A Gaussian lets one misread raster cast a −100-nat veto (a 1 m terrain
   rosette at a ravine stream did exactly that); this one tops out at a few nats. */
export const tll = (z, nu = 5) => -0.5 * (nu + 1) * Math.log(1 + (z * z) / nu);
/* share of each tread class that is a mapped line in OSM (the rest is
   driveways, plazas, desire lines, culverted ditches…) */
export const MAPPED_SHARE = { paved: 0.6, path: 0.7, rail: 0.95, water: 0.8 };
export function lodds(p) {
  p = clamp(p, 1e-4, 0.995);
  return Math.log(p / (1 - p));
}

export function srcContain(sh, q) {
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
    names = [],
    seen = new Set();
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
export function srcProx(sh, q) {
  if (sh.osmErr) return { ll: zeros(), status: 'err', note: 'OpenStreetMap tiles failed — ' + sh.osmErr };
  if (!q) return { ll: zeros(), status: 'wait' };
  const ll = zeros(),
    notes = [],
    b = q.best,
    inW = q.enclosing.some(e => e.rule === 'water' || e.rule === 'water_int');
  let exact = null;
  for (const cls of ['paved', 'path', 'rail', 'water']) {
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
export function srcStruct(sh, q) {
  if (!sh.inUS) return { ll: zeros(), status: 'na', note: 'USA Structures covers the United States only' };
  if (sh.structErr) return { ll: zeros(), status: 'err', note: 'footprint service failed — ' + sh.structErr };
  if (!q || !sh.structOk) return { ll: zeros(), status: 'wait' };
  const ll = zeros();
  let note;
  const desc = a =>
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
        ? `nearest footprint ${fmt(d, 1)} m away — ${desc(q.stNear.attr)}`
        : 'no surveyed structure within 45 m';
  }
  return { ll: centre(ll), status: 'ok', note };
}
export function srcImage(sh, feat) {
  if (sh.imgErr) return { ll: zeros(), status: 'na', note: sh.imgErr };
  if (!feat) return { ll: zeros(), status: 'wait' };
  const lp = imgLogLik(feat.v),
    ll = zeros();
  if (sh.lite) {
    let s0 = 0;
    for (const c of IMG_MODEL.classes) {
      ll[CIX[c]] = lp[c];
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
    ll[CIX[c]] = lp[c];
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
    `\nmodel's own call: ${NAME[IMG_MODEL.classes[IMG_MODEL.classes.map(k => lp[k]).indexOf(Math.max(...IMG_MODEL.classes.map(k => lp[k])))]]}` +
    ` · fitted on ${IMG_MODEL.n.toLocaleString('en-US')} labelled z18 patches, ${Math.round(IMG_MODEL.cv.balanced * 100)}% balanced accuracy unaided`;
  return { ll: centre(ll), status: 'ok', note, wmul: sh.imgWmul || 1 };
}
export const NLCD_MIX = {
  11: { water: 0.84, wetland: 0.08, bare: 0.04, snow: 0.02 },
  12: { snow: 0.86, water: 0.07, bare: 0.05 },
  21: { grass: 0.44, paved: 0.18, building: 0.12, forest: 0.12, path: 0.06, bare: 0.05 },
  22: { building: 0.27, paved: 0.27, grass: 0.27, forest: 0.1, path: 0.05 },
  23: { building: 0.37, paved: 0.4, grass: 0.13, forest: 0.05, path: 0.04 },
  24: { building: 0.45, paved: 0.44, grass: 0.05, path: 0.04 },
  31: { bare: 0.76, scrub: 0.09, grass: 0.06, paved: 0.04, water: 0.03 },
  41: { forest: 0.8, grass: 0.07, scrub: 0.06, path: 0.03, building: 0.02 },
  42: { forest: 0.82, scrub: 0.08, grass: 0.05, path: 0.02 },
  43: { forest: 0.82, scrub: 0.07, grass: 0.05, path: 0.03 },
  51: { scrub: 0.74, bare: 0.12, grass: 0.1 },
  52: { scrub: 0.72, grass: 0.13, bare: 0.1 },
  71: { grass: 0.68, scrub: 0.14, crop: 0.09, bare: 0.06 },
  72: { grass: 0.7, wetland: 0.12, scrub: 0.12 },
  73: { bare: 0.55, scrub: 0.25, grass: 0.15 },
  74: { wetland: 0.4, grass: 0.32, bare: 0.2 },
  81: { grass: 0.54, crop: 0.34, scrub: 0.06 },
  82: { crop: 0.8, grass: 0.11, bare: 0.05 },
  90: { wetland: 0.5, forest: 0.36, scrub: 0.07 },
  95: { wetland: 0.72, water: 0.13, grass: 0.09 },
};
export function srcCover(sh) {
  if (!sh.conus) return { ll: zeros(), status: 'na', note: 'NLCD covers the conterminous US only' };
  if (sh.nlcd === undefined) return { ll: zeros(), status: 'wait' };
  if (!sh.nlcd || sh.nlcd.code == null)
    return {
      ll: zeros(),
      status: sh.nlcd === null ? 'err' : 'na',
      note: 'land-cover service gave no class here',
    };
  const mix = NLCD_MIX[sh.nlcd.code];
  if (!mix) return { ll: zeros(), status: 'na', note: 'unmapped NLCD code' };
  const ll = zeros();
  for (const k of K) ll[CIX[k]] = Math.log((mix[k] || 0) + 0.012);
  return {
    ll: centre(ll),
    status: 'ok',
    note: `NLCD 2021 · ${sh.nlcd.code} — ${sh.nlcd.name}\n30 m pixel, read as a mixture rather than a verdict`,
  };
}
export const TCC_SIG = {
  forest: [78, 22],
  scrub: [26, 22],
  grass: [8, 14],
  crop: [5, 13],
  wetland: [28, 28],
  water: [3, 9],
  bare: [4, 11],
  snow: [3, 9],
  building: [14, 22],
  paved: [9, 18],
  path: [42, 38],
  rail: [14, 26],
};
export const IMP_SIG = {
  building: [82, 26],
  paved: [80, 26],
  rail: [34, 34],
  path: [22, 30],
  grass: [10, 18],
  crop: [3, 10],
  forest: [3, 10],
  scrub: [3, 10],
  water: [2, 9],
  wetland: [2, 9],
  bare: [6, 14],
  snow: [2, 9],
};
export const IMPD_LL = {
  20: { paved: 2.6, building: -1.0, forest: -1.2, grass: -0.8 },
  21: { paved: 2.5, building: -0.9, forest: -1.1, grass: -0.7 },
  22: { paved: 2.2, path: 0.5, building: -0.7, forest: -1.0 },
  23: { paved: 1.0, path: 1.2, bare: 0.6, forest: -0.5 },
  24: { building: 1.3, paved: 1.2, grass: 0.4, forest: -0.8, crop: -0.8 },
  25: { building: 2.8, paved: -0.6, forest: -1.2 },
  26: { building: 0.7, paved: 0.8, forest: -0.6 },
  27: { bare: 1.0, paved: 0.4 },
  28: { bare: 1.6, paved: 0.4 },
  29: { bare: 1.2, paved: 0.5 },
};
export function srcCanopy(sh) {
  if (!sh.conus)
    return {
      ll: zeros(),
      status: 'na',
      note: 'canopy and impervious rasters cover the conterminous US only',
    };
  if (sh.nlcd === undefined) return { ll: zeros(), status: 'wait' };
  const n = sh.nlcd;
  if (!n || (n.canopy == null && n.imperv == null && n.desc == null))
    return { ll: zeros(), status: n === null ? 'err' : 'na', note: 'no canopy / impervious value here' };
  const ll = zeros(),
    bits = [];
  if (n.canopy != null) {
    for (const k of K) {
      const [mu, sd] = TCC_SIG[k];
      ll[CIX[k]] += tll((n.canopy - mu) / sd);
    }
    bits.push(`tree canopy ${n.canopy}%`);
  }
  if (n.imperv != null) {
    for (const k of K) {
      const [mu, sd] = IMP_SIG[k];
      ll[CIX[k]] += tll((n.imperv - mu) / sd);
    }
    bits.push(`impervious ${n.imperv}%`);
  }
  if (n.desc != null && IMPD_LL[n.desc]) {
    add(ll, IMPD_LL[n.desc]);
    bits.push(`descriptor: ${n.descName}`);
  } else if (n.desc === 0) bits.push('descriptor: not impervious');
  return {
    ll: centre(ll),
    status: 'ok',
    note:
      bits.join('  ·  ') +
      '\nNLCD 2021, 30 m — shares a lineage with the land-cover source, so both sit below weight 1',
  };
}
export function srcTerrain(sh) {
  const t = sh.terr;
  if (t === undefined) return { ll: zeros(), status: 'wait' };
  if (!t) return { ll: zeros(), status: 'na', note: 'no elevation service answered' };
  /* the narrow kernel fits 3DEP's 1 m, 3 m and 10 m DEMs alike: at the same
     10 m rosettes on the Yosemite Valley floor, the 10 m DEM's slope is within
     0.4° of the 1 m lidar's and its water term matches (+0.30 vs +0.29 nats),
     where the wide kernel would add 0.6. The wide one is for 30 m cells and
     coarser, where the whole rosette sits inside a cell or two */
  const ll = zeros(),
    { slope, rough, rel } = t,
    fine = t.res <= 15;
  if (t.ocean) {
    add(ll, { water: 3.0, wetland: 0.4 });
    return {
      ll: centre(ll),
      status: 'ok',
      note: 'elevation reads exactly 0 m across the whole rosette — open sea\n' + t.src,
    };
  }
  const sS = fine ? 1.0 : 2.2,
    sR = fine ? 0.1 : 1.1,
    kRel = fine ? 0.8 : 0.55;
  /* water: flat, smooth ground in a local low is evidence FOR it; steepness
     argues only weakly against, because streams run in ravines */
  const flat = Math.exp(-0.5 * (slope / sS) ** 2 - 0.5 * (rough / sR) ** 2);
  ll[CIX.water] += 1.2 * flat - Math.min(1.0, slope / 30) + clamp(-rel * kRel, -1.0, 1.3);
  ll[CIX.wetland] += 0.8 * flat - Math.min(0.8, slope / 25) + clamp(-rel * kRel * 0.6, -0.8, 0.9);
  const sl = {
    snow: 26,
    building: 13,
    paved: 14,
    crop: 11,
    grass: 17,
    rail: 7,
    forest: 40,
    scrub: 44,
    bare: 48,
    path: 38,
  };
  for (const k in sl) ll[CIX[k]] += tll(slope / sl[k]);
  let note = `slope ${fmt(slope, 1)}°  ·  roughness ±${fmt(rough, 2)} m  ·  centre ${rel >= 0 ? '+' : ''}${fmt(rel, 2)} m vs ring\n${t.src}`;
  if (t.coarse) note += ` — the ~90 m DEM calls this ${fmt(t.coarse.slope, 1)}°`;
  return { ll: centre(ll), status: 'ok', note };
}
export function gazCovers(g, pt) {
  const G = g.geojson;
  if (!G || !pt) return null;
  const P = projector(pt.lat, pt.lon),
    proj = r => {
      const a = new Float64Array(r.length * 2);
      r.forEach(([lo, la], i) => {
        a[2 * i] = (lo - pt.lon) * P.kx;
        a[2 * i + 1] = (la - pt.lat) * P.ky;
      });
      return a;
    };
  if (G.type === 'Polygon' || G.type === 'MultiPolygon') {
    const polys = G.type === 'Polygon' ? [G.coordinates] : G.coordinates;
    let ins = false;
    for (const pl of polys) for (const r of pl) if (ringContains(0, 0, proj(r))) ins = !ins;
    return ins;
  }
  if (G.type === 'LineString' || G.type === 'MultiLineString') {
    const ls = G.type === 'LineString' ? [G.coordinates] : G.coordinates;
    let d = Infinity;
    for (const l of ls) d = Math.min(d, Math.sqrt(polyD2(0, 0, proj(l))));
    return d < 6;
  }
  if (G.type === 'Point') {
    const [lo, la] = G.coordinates;
    return Math.hypot((lo - pt.lon) * P.kx, (la - pt.lat) * P.ky) < 4;
  }
  return null;
}
export const GAZ_ROAD = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
]);
export const GAZ_FOOT = new Set([
  'footway',
  'path',
  'cycleway',
  'steps',
  'bridleway',
  'pedestrian',
  'track',
  'corridor',
]);
export function srcGaz(sh) {
  const g = sh.nom;
  if (g === undefined)
    return {
      ll: zeros(),
      status: sh.gazAsked ? 'wait' : 'na',
      note: 'asked only for the station in focus (1 request/s policy)',
    };
  if (!g || g.error) return { ll: zeros(), status: 'na', note: 'no gazetteer match' };
  /* reverse geocoding returns the NEAREST addressable object, not the one you
     are standing in — so it only gets a vote when its geometry covers the point */
  const cover = gazCovers(g, sh.pt);
  if (cover === false)
    return {
      ll: zeros(),
      status: 'ok',
      note: `nearest named feature (${g.category}=${g.type}${g.name ? ' · ' + g.name : ''}) does not cover the point — no vote`,
    };
  const cat = g.category || '',
    ty = g.type || '',
    ll = zeros();
  if (cat === 'highway' && GAZ_ROAD.has(ty)) add(ll, { paved: 1.9, path: 0.3, forest: -0.9, water: -1.3 });
  else if (cat === 'highway' && GAZ_FOOT.has(ty)) add(ll, { path: 1.9, paved: 0.4, forest: -0.2 });
  else if (cat === 'building') add(ll, { building: 1.9, paved: 0.4, forest: -1.1, water: -1.4 });
  else if (cat === 'railway') add(ll, { rail: 2.1, paved: 0.3 });
  else if (cat === 'waterway' || ['water', 'river', 'reservoir', 'lake', 'bay'].includes(ty))
    add(ll, { water: 2.0, wetland: 0.5 });
  else if (['wood', 'forest'].includes(ty)) add(ll, { forest: 1.6, path: 0.2 });
  else if (['scrub', 'heath'].includes(ty)) add(ll, { scrub: 1.6 });
  else if (['wetland', 'marsh'].includes(ty)) add(ll, { wetland: 1.7 });
  else if (['farmland', 'orchard', 'vineyard'].includes(ty)) add(ll, { crop: 1.6 });
  else if (['park', 'grass', 'meadow', 'garden', 'pitch', 'golf_course'].includes(ty))
    add(ll, { grass: 1.4, forest: 0.3 });
  else if (['sand', 'beach', 'bare_rock'].includes(ty)) add(ll, { bare: 1.7 });
  else if (ty === 'glacier') add(ll, { snow: 1.9 });
  else if (['parking', 'apron'].includes(ty)) add(ll, { paved: 1.7 });
  else if (['residential', 'neighbourhood'].includes(ty))
    add(ll, { building: 0.5, grass: 0.5, paved: 0.5, crop: -0.9 });
  else
    return {
      ll: zeros(),
      status: 'ok',
      note: `nearest named feature is ${cat || '—'}/${ty || '—'} — no surface implication`,
    };
  return {
    ll: centre(ll),
    status: 'ok',
    note: `nearest feature: ${cat}=${ty}${g.name ? ' · ' + g.name : ''}`,
  };
}
