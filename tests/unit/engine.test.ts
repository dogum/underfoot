/* Engine fixtures: synthetic map features around a point, written in local
 * metres, with the evidence each source would see. No network, runs in Node.
 * These are the scenarios the fusion was tuned against; a change that breaks
 * one should be a deliberate one. */
import { describe, it, expect } from 'vitest';
import MEDIAN from './fixtures/class_median_feats.json';
import { K, CIX, PRIORS, SOURCES } from '../../src/core/classes';
import { offset } from '../../src/core/geo';
import { buildGeo, geoAt } from '../../src/engine/geometry';
import { computeParts, fuseParts, DEFAULT_NEFF } from '../../src/engine/fuse';
import { smoothChain } from '../../src/engine/smooth';
import { fieldGeometry, fieldFuse, positional } from '../../src/engine/field';
import { narrate } from '../../src/engine/narrate';
import type { FuseOptions } from '../../src/core/types';

type Any = any;
const MED = MEDIAN as Record<string, number[]>;
const feat = (c: string): Any => {
  const v = MED[c];
  return {
    v,
    core: {
      L: v[0],
      S: v[3],
      G: v[4],
      B: v[7],
      sd: Math.exp(v[9]) - 0.004,
      edge: Math.exp(v[10]) - 0.003,
      D: v[11],
    },
  };
};
const O = { lat: 37.74, lon: -119.59 };
// synthetic tile features, written in local metres around O
const ll = (x: number, y: number) => {
  const p = offset(O, x, y);
  return [p.lon, p.lat];
};
const ring = (pts: number[][]) => {
  const a: number[] = [];
  for (const [x, y] of pts) a.push(...ll(x, y));
  a.push(a[0], a[1]);
  return Float64Array.from(a);
};
const box = (x0: number, y0: number, x1: number, y1: number) =>
  ring([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);
const bb = (r: Float64Array) => {
  let w = 180,
    s = 90,
    e = -180,
    n = -90;
  for (let i = 0; i < r.length; i += 2) {
    w = Math.min(w, r[i]);
    e = Math.max(e, r[i]);
    s = Math.min(s, r[i + 1]);
    n = Math.max(n, r[i + 1]);
  }
  return [w, s, e, n];
};
const poly = (L: string, p: Any, r: Float64Array) => ({ L, t: 3, p, r: [r], bb: bb(r) });
const line = (L: string, p: Any, pts: number[][]) => {
  const a: number[] = [];
  for (const [x, y] of pts) a.push(...ll(x, y));
  const r = Float64Array.from(a);
  return { L, t: 2, p, r: [r], bb: bb(r) };
};
const hline = (L: string, p: Any, y: number) =>
  line(L, p, [
    [-300, y],
    [300, y],
  ]);
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => poly('building', {}, box(120 + i * 3, 120, 121.5 + i * 3, 121.5))); // map density far away
const sh = (o: Any = {}) => ({
  conus: true,
  inUS: true,
  structOk: true,
  nlcd: undefined,
  terr: undefined,
  nom: null,
  gazAsked: false,
  imgWmul: 1,
  ...o,
});
const nl = (code: number, canopy: number, imperv: number, desc: number) => ({
  code,
  name: 'nlcd ' + code,
  canopy,
  imperv,
  desc,
  descName: desc ? 'desc ' + desc : null,
});
const t1 = (slope: number, rough = 0.2, rel = 0) => ({
  slope,
  rough,
  rel,
  z: 100,
  r: 10,
  src: '3DEP 1 m',
  res: 1,
});
const t90 = (slope: number, rough = 0.4, rel = 0) => ({
  slope,
  rough,
  rel,
  z: 100,
  r: 45,
  src: 'DEM 90 m',
  res: 90,
});
const st = (r: Float64Array) => ({
  id: 1,
  a: { OCC_CLS: 'Residential', PRIM_OCC: 'Single Family Dwelling', HEIGHT: 6.5, SQFEET: 2660 },
  r: [Array.from(r)],
});

const CASES: Any[] = [
  [
    'water',
    'reservoir interior',
    [poly('water', { class: 'lake' }, box(-300, -300, 300, 300))],
    [],
    sh({ nlcd: nl(11, 0, 0, 0), terr: t1(0.1, 0.02, -0.05) }),
    feat('water'),
  ],
  [
    'water',
    'river, on the centreline',
    [
      poly('water', { class: 'river' }, box(-300, -20, 300, 20)),
      hline('waterway', { class: 'river' }, 0),
      ...filler(20),
    ],
    [],
    sh({ nlcd: nl(11, 0, 0, 0), terr: t1(0.2, 0.03, -0.3) }),
    feat('water'),
  ],
  [
    'path',
    'trail through woods (on centreline)',
    [
      poly('landcover', { class: 'wood', subclass: 'wood' }, box(-300, -300, 300, 300)),
      hline('transportation', { class: 'path', subclass: 'path' }, 0),
      hline('waterway', { class: 'stream' }, 26),
      ...filler(14),
    ],
    [],
    sh({ nlcd: nl(41, 89, 0, 0), terr: t1(9, 0.4) }),
    feat('forest'),
  ],
  [
    'forest',
    'woods, 13 m off the trail',
    [
      poly('landcover', { class: 'wood', subclass: 'wood' }, box(-300, -300, 300, 300)),
      hline('transportation', { class: 'path', subclass: 'path' }, 13),
      hline('waterway', { class: 'stream' }, -13),
      ...filler(14),
    ],
    [],
    sh({ nlcd: nl(41, 91, 0, 0), terr: t1(11, 0.5) }),
    feat('forest'),
  ],
  [
    'paved',
    'residential street centreline',
    [
      poly('landuse', { class: 'residential' }, box(-300, -300, 300, 300)),
      hline('transportation', { class: 'minor' }, 0.3),
      hline('transportation', { class: 'path', subclass: 'footway' }, 7),
      poly('building', {}, box(-8, 11, 8, 25)),
      ...filler(30),
    ],
    [st(box(-8, 11, 8, 25))],
    sh({ nlcd: nl(22, 12, 62, 22), terr: t1(1.5, 0.1) }),
    feat('paved'),
  ],
  [
    'paved',
    'motorway, 2 m off centreline',
    [hline('transportation', { class: 'motorway' }, 2), ...filler(20)],
    [],
    sh({ nlcd: nl(23, 3, 88, 20), terr: t1(1, 0.08) }),
    feat('paved'),
  ],
  [
    'building',
    'inside a footprint',
    [
      poly('landuse', { class: 'commercial' }, box(-300, -300, 300, 300)),
      poly('building', {}, box(-15, -15, 15, 15)),
      hline('transportation', { class: 'service' }, -29),
      ...filler(40),
    ],
    [st(box(-15, -15, 15, 15))],
    sh({ nlcd: nl(24, 2, 93, 25), terr: t1(1, 0.05) }),
    feat('building'),
  ],
  [
    'building',
    'suburban house, canopy over the lot',
    [
      poly('landuse', { class: 'residential' }, box(-300, -300, 300, 300)),
      poly('building', {}, box(-7, -6, 9, 8)),
      hline('transportation', { class: 'minor' }, -25),
      ...filler(26),
    ],
    [st(box(-7, -6, 9, 8))],
    sh({ nlcd: nl(22, 37, 37, 25), terr: t1(3, 0.2) }),
    feat('building'),
  ],
  [
    'grass',
    'park lawn',
    [
      poly('park', { class: 'park' }, box(-300, -300, 300, 300)),
      poly('landcover', { class: 'grass', subclass: 'park' }, box(-80, -80, 80, 80)),
      hline('transportation', { class: 'path', subclass: 'footway' }, 9),
      ...filler(24),
    ],
    [],
    sh({ nlcd: nl(21, 6, 14, 24), terr: t1(2, 0.15) }),
    feat('grass'),
  ],
  [
    'crop',
    'farmland',
    [poly('landcover', { class: 'farmland', subclass: 'farmland' }, box(-300, -300, 300, 300)), ...filler(6)],
    [],
    sh({ nlcd: nl(82, 1, 0, 0), terr: t1(1.5, 0.1) }),
    feat('crop'),
  ],
  [
    'bare',
    'beach',
    [poly('landcover', { class: 'sand', subclass: 'beach' }, box(-300, -300, 300, 300)), ...filler(9)],
    [],
    sh({ nlcd: nl(31, 0, 2, 0), terr: t1(1, 0.1) }),
    feat('bare'),
  ],
  [
    'wetland',
    'emergent marsh (sparse map)',
    [poly('landcover', { class: 'wetland', subclass: 'marsh' }, box(-300, -300, 300, 300))],
    [],
    sh({ nlcd: nl(95, 12, 0, 0), terr: t1(0.5, 0.05) }),
    feat('wetland'),
  ],
  [
    'rail',
    'on a rail centreline',
    [hline('transportation', { class: 'rail', subclass: 'rail' }, 0.4), ...filler(14)],
    [],
    sh({ nlcd: nl(21, 9, 31, 23), terr: t1(1, 0.08) }),
    feat('paved'),
  ],
  [
    'paved',
    'two-lane road, descriptor says tertiary',
    [
      poly('landuse', { class: 'residential' }, box(-300, -300, 300, 300)),
      hline('transportation', { class: 'tertiary' }, 0.5),
      ...filler(30),
    ],
    [],
    sh({ nlcd: nl(21, 22, 44, 22), terr: t1(2, 0.1) }),
    feat('paved'),
  ],
  [
    'snow',
    'glacier (abroad)',
    [poly('landcover', { class: 'ice', subclass: 'glacier' }, box(-300, -300, 300, 300))],
    [],
    sh({ conus: false, inUS: false, nlcd: null, terr: t90(12) }),
    { v: MED.bare, core: { L: 0.88, S: 0.03, G: 0, B: 0.03, sd: 0.02, edge: 0.01, D: 0 } },
  ],
  [
    'water',
    'open sea abroad, ocean polygon',
    [poly('water', { class: 'ocean' }, box(-300, -300, 300, 300))],
    [],
    sh({ conus: false, inUS: false, nlcd: null, terr: { ...t90(0, 0, 0), ocean: true } }),
    feat('water'),
  ],
  [
    'water',
    'open sea abroad, terrain + pixels only',
    [],
    [],
    sh({ conus: false, inUS: false, nlcd: null, terr: { ...t90(0, 0, 0), ocean: true } }),
    feat('water'),
  ],
  [
    'forest',
    'forest abroad (OSM + pixels only)',
    [poly('landcover', { class: 'wood', subclass: 'forest' }, box(-300, -300, 300, 300)), ...filler(8)],
    [],
    sh({ conus: false, inUS: false, nlcd: null, terr: t90(14) }),
    feat('forest'),
  ],
];

const W = Object.fromEntries(SOURCES.map(s => [s.id, s.w]));
const opt: FuseOptions = { weights: W, neff: DEFAULT_NEFF, prior: PRIORS.probed };
const run = (c: Any) => {
  const [, , feats, structs, shv, ft] = c;
  const G = buildGeo(O, feats, structs, 170),
    q = geoAt(G, 0, 0, true);
  return fuseParts(computeParts(shv, q, ft), opt);
};

describe('fixtures: the right class wins, or comes second', () => {
  for (const c of CASES)
    it(`${c[0].padEnd(8)} ${c[1]}`, () => {
      const f = run(c);
      const second = K[f.order[1]];
      expect([f.top, second]).toContain(c[0]);
    });
  it('at least 17 of 18 are called exactly', () => {
    const exact = CASES.filter(c => run(c).top === c[0]).length;
    expect(exact).toBeGreaterThanOrEqual(17);
  });
  it('never claims certainty: every call stays under 99%', () => {
    for (const c of CASES) expect(run(c).topP).toBeLessThan(0.99);
  });
});

describe('controls', () => {
  it('no evidence at all gives a low-confidence answer', () => {
    const f = fuseParts(
      computeParts(
        sh({ conus: false, inUS: false, nlcd: null, terr: null }),
        geoAt(buildGeo(O, [], [], 170), 0, 0),
        null,
      ),
      opt,
    );
    expect(f.conf).toBeLessThan(0.2);
  });
});

describe('path smoothing', () => {
  const mk = (o: Record<string, number>) => K.map(k => o[k] ?? 0.004),
    nz = (a: number[]) => {
      const s = a.reduce((x, y) => x + y, 0);
      return a.map(v => v / s);
    };
  const forest = nz(mk({ forest: 0.8, scrub: 0.1, grass: 0.05 })),
    flick = nz(mk({ grass: 0.5, forest: 0.35, scrub: 0.1 })),
    road = nz(mk({ paved: 0.93, forest: 0.03 }));
  const seq = [forest, forest, forest, flick, forest, forest, road, forest, forest],
    d = seq.map((_, i) => i * 12);
  const sm = smoothChain(seq, d, PRIORS.probed);
  it('a one-station grass flicker inside a forest run is treated as noise', () => {
    expect(sm[3][CIX.grass]).toBeLessThan(0.1);
  });
  it('a real road crossing survives smoothing', () => {
    expect(sm[6][CIX.paved]).toBeGreaterThan(0.9);
  });
});

describe('field map and GPS uncertainty', () => {
  const c = CASES.find(x => x[1].startsWith('suburban'));
  const G = buildGeo(O, c[2], c[3], 170);
  const F = fieldGeometry(G, c[4], opt);
  fieldFuse(F, null, c[4], opt);
  it('±3 m around a house still says building', () => {
    const p = positional(F, 3)!;
    expect(p[CIX.building]).toBeGreaterThan(0.85);
  });
  it('a wider fix spreads belief to the yard and the street', () => {
    const p3 = positional(F, 3)!,
      p10 = positional(F, 10)!;
    expect(p10[CIX.building]).toBeLessThan(p3[CIX.building]);
    expect(p10[CIX.grass] + p10[CIX.paved]).toBeGreaterThan(p3[CIX.grass] + p3[CIX.paved]);
  });
  it('the field fuses 3,600 cells quickly', () => {
    const t = performance.now();
    fieldFuse(F, null, c[4], { ...opt, neff: 2.5 });
    expect(performance.now() - t).toBeLessThan(400);
  });
  it('narrates in plain language', () => {
    const q = geoAt(G, 0, 0, true);
    const txt = narrate(fuseParts(computeParts(c[4], q, c[5]), opt), c[4], q);
    expect(txt).toMatch(/building/i);
  });
});
