// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Map geometry for the engine: OSM polygon and line rules (with modelled
 * surface half-widths), buildGeo() to project features around a station, and
 * geoAt() to query what encloses or lies near any point. Pure.
 */
import { D2R, polyD2, projector, ringArea, ringContains } from '../core/geo';

/* ---------------------------------------------- OSM polygon & line rules */
/* OpenMapTiles classes -> containment rule key */
export function polyRule(L, p) {
  const c = p.class,
    s = p.subclass;
  if (L === 'building') return 'building';
  if (L === 'water') return p.intermittent ? 'water_int' : 'water';
  if (L === 'aeroway')
    return ['apron', 'runway', 'taxiway', 'helipad'].includes(c)
      ? 'hard'
      : c === 'aerodrome'
        ? 'aerodrome'
        : null;
  if (L === 'park') return 'park';
  if (L === 'landcover') {
    if (c === 'wood') return 'wood';
    if (c === 'grass') return s === 'scrub' || s === 'heath' ? 'scrub' : 'grass';
    if (c === 'farmland') return 'farm';
    if (c === 'wetland') return 'wetland';
    if (c === 'sand') return 'sand';
    if (c === 'rock') return 'rock';
    if (c === 'ice') return 'ice';
    return null;
  }
  if (L === 'landuse') {
    if (['residential', 'suburb', 'quarter', 'neighbourhood'].includes(c)) return 'residential';
    if (['commercial', 'retail', 'industrial'].includes(c)) return 'industrial';
    if (['quarry', 'landfill', 'brownfield', 'construction'].includes(c)) return 'disturbed';
    if (['school', 'university', 'college', 'kindergarten', 'hospital', 'library'].includes(c))
      return 'campus';
    if (['theme_park', 'zoo'].includes(c)) return 'leisure';
    if (['pitch', 'playground', 'track', 'cemetery', 'railway', 'stadium', 'garages', 'dam'].includes(c))
      return c;
  }
  return null;
}
/* precedence order (most specific first); the first match counts in full,
   later ones are damped because nested polygons are one fact, not several */
export const POLY_RULES = {
  building: [
    {
      building: 5.2,
      paved: -1.0,
      forest: -2.2,
      water: -2.6,
      grass: -2.0,
      crop: -2.4,
      bare: -1.6,
      snow: -1.8,
    },
    'building footprint',
  ],
  water: [
    { water: 5.0, wetland: 0.7, building: -2.4, paved: -2.4, forest: -2.6, grass: -2.4, crop: -2.6 },
    'water body',
  ],
  hard: [{ paved: 3.6, building: -0.6, forest: -2.2, grass: -1.2, crop: -2.2 }, 'airfield hardstanding'],
  wetland: [{ wetland: 4.2, water: 1.1, grass: -0.4, paved: -1.8, building: -2.0 }, 'wetland'],
  ice: [{ snow: 4.6, water: 0.6, bare: 0.3 }, 'glacier / ice'],
  wood: [
    { forest: 2.9, path: 0.4, scrub: 0.4, grass: -0.9, crop: -2.0, paved: -1.4, building: -1.8 },
    'wood',
  ],
  scrub: [{ scrub: 3.2, grass: 0.4, forest: 0.2, paved: -1.4, building: -1.8 }, 'scrub / heath'],
  sand: [{ bare: 3.8, water: 0.4, grass: -1.4, forest: -2.0, building: -2.0 }, 'sand / beach'],
  rock: [{ bare: 3.6, snow: 0.4, grass: -1.0, forest: -1.6, building: -2.0 }, 'bare rock'],
  farm: [{ crop: 3.2, grass: 0.6, forest: -1.4, building: -1.2, paved: -1.2 }, 'farmland'],
  grass: [{ grass: 2.7, path: 0.4, crop: 0.4, forest: -0.6, building: -1.6, paved: -0.6 }, 'grass'],
  pitch: [{ grass: 2.0, paved: 0.5, bare: 0.4, building: -1.4, forest: -1.4 }, 'sports pitch'],
  track: [{ path: 1.8, paved: 1.0, grass: 0.6, building: -1.4, forest: -1.6 }, 'running track'],
  garages: [{ paved: 1.7, building: 1.8, forest: -1.5, grass: -0.8 }, 'garages'],
  playground: [{ grass: 0.9, bare: 0.7, paved: 0.6, path: 0.4, building: -1.0 }, 'playground'],
  railway: [{ rail: 1.8, bare: 0.9, paved: 0.4, forest: -0.8, building: -0.6 }, 'railway land'],
  disturbed: [{ bare: 2.4, paved: 0.6, forest: -1.4, grass: -0.6 }, 'quarry / construction'],
  cemetery: [{ grass: 1.7, forest: 0.4, path: 0.3, building: -1.0, crop: -1.4 }, 'cemetery'],
  campus: [{ building: 1.1, paved: 1.1, grass: 0.9, crop: -1.6, water: -1.2 }, 'campus'],
  stadium: [{ grass: 0.9, paved: 0.9, building: 1.0 }, 'stadium'],
  industrial: [
    { building: 1.5, paved: 1.7, grass: -0.5, forest: -1.5, crop: -2.1, water: -1.4 },
    'commercial / industrial',
  ],
  residential: [
    { building: 1.1, grass: 1.0, paved: 1.0, path: 0.5, forest: -0.4, crop: -1.7, water: -1.3, bare: -0.8 },
    'residential',
  ],
  leisure: [{ paved: 0.6, grass: 0.6, building: 0.5 }, 'theme park / zoo'],
  aerodrome: [{ grass: 0.9, paved: 1.0, building: 0.2, forest: -1.2, crop: -0.6 }, 'aerodrome'],
  water_int: [
    { water: 2.2, wetland: 1.4, bare: 1.2, grass: 0.3, building: -1.6, paved: -1.4 },
    'intermittent water',
  ],
  dam: [{ paved: 0.6, bare: 0.6, water: 0.4 }, 'dam'],
  park: [
    { forest: 0.9, grass: 0.9, scrub: 0.6, path: 0.5, water: 0.2, building: -1.7, paved: -1.3, crop: -1.1 },
    'park / reserve',
  ],
};
export const RULE_ORDER = Object.keys(POLY_RULES);
export const USE_RULES = new Set([
  'residential',
  'industrial',
  'campus',
  'leisure',
  'aerodrome',
  'park',
  'stadium',
  'cemetery',
  'playground',
  'pitch',
  'garages',
  'railway',
  'disturbed',
  'dam',
]);

export const ROAD_W = {
  motorway: 11,
  trunk: 9,
  primary: 7,
  secondary: 6.5,
  tertiary: 5.5,
  minor: 4,
  service: 2.8,
  raceway: 6,
  busway: 3.5,
  bus_guideway: 3,
};
export const FOOT_W = {
  footway: 1.1,
  cycleway: 1.3,
  steps: 0.9,
  bridleway: 0.9,
  pedestrian: 4,
  path: 0.8,
  corridor: 1.2,
  platform: 2,
};
export const RAIL_W = {
  rail: 3.0,
  narrow_gauge: 1.8,
  light_rail: 2.2,
  tram: 1.5,
  subway: 2.2,
  monorail: 1.4,
  funicular: 1.6,
  preserved: 2.4,
};
export const WATERWAY_W = { river: 8, canal: 4, stream: 1.6, ditch: 1.0, drain: 1.0 };
export function lineRule(L, p) {
  if (p.brunnel === 'tunnel') return null; // underground: not the surface you stand on
  const c = p.class,
    s = p.subclass;
  if (L === 'transportation') {
    if (ROAD_W[c] != null) {
      let w = ROAD_W[c];
      if (c === 'service' && p.service === 'driveway') w = 1.8;
      if (c === 'service' && p.service === 'parking_aisle') w = 3.5;
      return { cls: 'paved', w, what: c === 'minor' ? 'street' : c };
    }
    if (c === 'track') return { cls: p.surface === 'paved' ? 'paved' : 'path', w: 2.2, what: 'track' };
    if (c === 'path') return { cls: 'path', w: FOOT_W[s] ?? 0.9, what: s || 'path' };
    if (c === 'rail' || c === 'transit') return { cls: 'rail', w: RAIL_W[s] ?? 2.2, what: s || c };
    return null;
  }
  if (L === 'waterway' && WATERWAY_W[c] != null)
    return {
      cls: 'water',
      w: WATERWAY_W[c] * (p.intermittent ? 0.6 : 1),
      what: c + (p.intermittent ? ' (intermittent)' : ''),
    };
  if (L === 'aeroway') {
    if (c === 'runway') return { cls: 'paved', w: 22, what: 'runway' };
    if (c === 'taxiway') return { cls: 'paved', w: 11, what: 'taxiway' };
  }
  return null;
}

/* ---------------------------------------------------------- geo index */
/* Everything within R metres of a station, projected once into that
   station's tangent plane. The station's own evidence and the whole field
   map around it are then cheap point queries against this index. */
export function buildGeo(st, feats, structs, R = 170) {
  const P = projector(st.lat, st.lon);
  const dLat = R / 111320,
    dLon = R / (111320 * Math.max(0.15, Math.cos(st.lat * D2R)));
  const W = [st.lon - dLon, st.lat - dLat, st.lon + dLon, st.lat + dLat];
  const hit = bb => !(bb[2] < W[0] || bb[0] > W[2] || bb[3] < W[1] || bb[1] > W[3]);
  const proj = r => {
    const o = new Float64Array(r.length);
    for (let i = 0; i < r.length; i += 2) {
      o[i] = (r[i] - st.lon) * P.kx;
      o[i + 1] = (r[i + 1] - st.lat) * P.ky;
    }
    return o;
  };
  const lbb = a => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < a.length; i += 2) {
      const x = a[i],
        y = a[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  };
  const polys = [],
    blds = [],
    lines = [],
    names = [],
    sts = [];
  let density = 0;
  const seenLine = new Set();
  for (const f of feats) {
    if (!hit(f.bb)) continue;
    if (f.t === 3) {
      if (f.L === 'building') {
        for (const r of f.r) {
          const a = proj(r),
            bb = lbb(a);
          if (bb[2] < -R || bb[0] > R || bb[3] < -R || bb[1] > R) continue;
          blds.push({ a, bb, area: ringArea(a) });
          density++;
        }
      } else {
        const rule = polyRule(f.L, f.p);
        if (!rule) continue;
        const rings = f.r.map(proj);
        let bb = [Infinity, Infinity, -Infinity, -Infinity];
        for (const a of rings) {
          const b = lbb(a);
          bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])];
        }
        polys.push({ rule, rings, bb, name: f.p.name || null, L: f.L, cls: f.p.class, sub: f.p.subclass });
      }
    } else if (f.t === 2) {
      if (f.L === 'transportation_name') {
        if (f.p.name) for (const r of f.r) names.push({ cls: f.p.class, name: f.p.name, a: proj(r) });
        continue;
      }
      const lr = lineRule(f.L, f.p);
      if (!lr) continue;
      for (const r of f.r) {
        const key = lr.cls + lr.what + r[0].toFixed(6) + r[1].toFixed(6) + r.length; // the same way appears in neighbouring tiles
        if (seenLine.has(key)) continue;
        seenLine.add(key);
        const a = proj(r),
          bb = lbb(a);
        lines.push({ ...lr, a, bb, surface: f.p.surface || null });
        density++;
      }
    }
  }
  for (const s of structs || []) {
    for (const r of s.r) {
      const a = proj(r),
        bb = lbb(a);
      if (bb[2] < -R || bb[0] > R || bb[3] < -R || bb[1] > R) continue;
      sts.push({ a, bb, area: ringArea(a), attr: s.a });
    }
  }
  return { st, P, polys, blds, lines, names, sts, density, R };
}
/* what the map says at local point (x,y) */
export function geoAt(G, x, y, withNames = false) {
  const enclosing = [];
  for (const p of G.polys) {
    const b = p.bb;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    let inside = false,
      area = Infinity;
    for (const a of p.rings)
      if (ringContains(x, y, a)) {
        inside = !inside;
        const ar = ringArea(a);
        if (ar < area) area = ar;
      }
    if (inside) {
      let e2 = Infinity;
      for (const a of p.rings) {
        const d2 = polyD2(x, y, a);
        if (d2 < e2) e2 = d2;
      }
      enclosing.push({ rule: p.rule, area, name: p.name, edge: Math.sqrt(e2) });
    }
  }
  let inB = false,
    bArea = 0,
    bD2 = Infinity,
    bEdge = Infinity;
  for (const b of G.blds) {
    const bb = b.bb;
    if (x < bb[0] - 20 || x > bb[2] + 20 || y < bb[1] - 20 || y > bb[3] + 20) continue;
    if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && ringContains(x, y, b.a)) {
      inB = true;
      bArea = b.area;
      bD2 = 0;
      bEdge = Math.sqrt(polyD2(x, y, b.a));
      break;
    }
    const d2 = polyD2(x, y, b.a);
    if (d2 < bD2) bD2 = d2;
  }
  if (inB) enclosing.push({ rule: 'building', area: bArea, name: null, edge: bEdge });
  const best = {};
  for (const l of G.lines) {
    const bb = l.bb,
      pad = l.w + 60;
    if (x < bb[0] - pad || x > bb[2] + pad || y < bb[1] - pad || y > bb[3] + pad) continue;
    const d = Math.sqrt(polyD2(x, y, l.a));
    const cur = best[l.cls];
    if (!cur || d - l.w < cur.d - cur.w)
      best[l.cls] = { d, w: l.w, what: l.what, surface: l.surface, a: withNames ? l.a : null };
  }
  let stIn = null,
    stD2 = Infinity,
    stNear = null;
  for (const s of G.sts) {
    const bb = s.bb;
    if (x < bb[0] - 45 || x > bb[2] + 45 || y < bb[1] - 45 || y > bb[3] + 45) continue;
    if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && ringContains(x, y, s.a)) {
      stIn = s;
      stD2 = 0;
      break;
    }
    const d2 = polyD2(x, y, s.a);
    if (d2 < stD2) {
      stD2 = d2;
      stNear = s;
    }
  }
  if (withNames)
    for (const k in best) {
      const b = best[k];
      b.name = lineName(G, x, y, b, k);
      b.a = null;
    }
  return { enclosing, best, bD: Math.sqrt(bD2), stIn, stD: Math.sqrt(stD2), stNear, density: G.density };
}
export const NAME_CLS = {
  paved: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track'],
  path: ['path', 'track'],
  rail: ['rail', 'transit'],
};
export function lineName(G, x, y, b, cls) {
  const ok = NAME_CLS[cls];
  if (!ok) return null;
  let best = null,
    bd = b.d + 4;
  for (const n of G.names) {
    if (!ok.includes(n.cls)) continue;
    const d = Math.sqrt(polyD2(x, y, n.a));
    if (d < bd) {
      bd = d;
      best = n.name;
    }
  }
  return best;
}
