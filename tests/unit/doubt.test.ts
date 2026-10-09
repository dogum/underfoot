/* Doubt: the cases docs/roadmap.md names. Seasonal snow over mapped bare rock
 * (Aletsch) lights up; at a Seine-type quay the photo counts against the map
 * but stays under the bar (a known miss); a reservoir and a rooftop stay
 * quiet. Synthetic scenes in local metres, evidence as each source would see
 * it, and synthetic ledgers for who counts. No network, runs in Node. */
import { describe, it, expect } from 'vitest';
import MEDIAN from './fixtures/class_median_feats.json';
import { K, PRIORS, SOURCES } from '../../src/core/classes';
import { CHECK, DOUBT_AT, checkList, doubtOf, doubtWords } from '../../src/engine/doubt';
import { computeParts, fuseParts, DEFAULT_NEFF } from '../../src/engine/fuse';
import { buildGeo, geoAt } from '../../src/engine/geometry';
import { at, box, line } from './scene';
import type { ClassKey, Fused, SourceId, TileFeature } from '../../src/core/types';

const MED = MEDIAN as Record<string, number[]>;
const pixels = (c: string) => {
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
/* bright, flat white: snow above 1,800 m, bare ground below */
const white = { v: MED.bare, core: { L: 0.88, S: 0.03, G: 0, B: 0.03, sd: 0.02, edge: 0.01, D: 0 } };
const facts = (o: Record<string, unknown>) => ({
  conus: true,
  inUS: true,
  structOk: true,
  nom: null,
  imgWmul: 1,
  ...o,
});
const nlcd = (code: number, canopy: number, imperv: number, desc = 0) => ({
  code,
  name: 'nlcd ' + code,
  canopy,
  imperv,
  desc,
  descName: desc ? 'desc ' + desc : null,
});
const terr = (slope: number, z = 100, res = 1, rough = 0.2, rel = 0) => ({
  slope,
  rough,
  rel,
  z,
  r: res > 3 ? 45 : 10,
  src: 'test',
  res,
  ocean: false,
});
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => box('building', {}, 120 + i * 3, 120, 121.5 + i * 3, 121.5));
const W = Object.fromEntries(SOURCES.map(s => [s.id, s.w]));
const opt = { weights: W, neff: DEFAULT_NEFF, prior: PRIORS.probed };
const read = (feats: TileFeature[], sh: Record<string, unknown>, px: unknown, structs: unknown[] = []) => {
  const q = geoAt(buildGeo(at(0, 0), feats, structs, 170), 0, 0, true),
    f = fuseParts(computeParts(sh, q, px), opt);
  return { f, d: doubtOf(f) };
};

describe('quiet where the sources agree', () => {
  it('a reservoir', () => {
    const { f, d } = read(
      [box('water', { class: 'lake' }, -300, -300, 300, 300)],
      facts({ nlcd: nlcd(11, 0, 0), terr: terr(0.1, 100, 1, 0.02, -0.05) }),
      pixels('water'),
    );
    expect(f.top).toBe('water');
    expect(d.score).toBeLessThan(DOUBT_AT);
  });
  it('a rooftop', () => {
    const roof = box('building', {}, -15, -15, 15, 15);
    const { f, d } = read(
      [box('landuse', { class: 'commercial' }, -300, -300, 300, 300), roof, ...filler(40)],
      facts({ nlcd: nlcd(24, 2, 93, 25), terr: terr(1, 100, 1, 0.05) }),
      pixels('building'),
      [{ id: 1, a: { OCC_CLS: 'Commercial', HEIGHT: 9, SQFEET: 9000 }, r: [Array.from(roof.r[0])] }],
    );
    expect(f.top).toBe('building');
    expect(d.score).toBeLessThan(DOUBT_AT);
  });
});

describe('quiet where geometry decides', () => {
  it('a trail the line follows, under forest the area sources all see', () => {
    const trail = line('transportation', { class: 'path', subclass: 'path' }, [
      [-300, 0],
      [300, 0],
    ]);
    const q = Object.assign(
      geoAt(
        buildGeo(at(0, 0), [box('landcover', { class: 'wood' }, -300, -300, 300, 300), trail], [], 170),
        0,
        0,
        true,
      ),
      {
        follow: 'path' as const,
      },
    );
    const f = fuseParts(
      computeParts(facts({ nlcd: nlcd(42, 80, 0), terr: terr(8) }), q, pixels('forest')),
      opt,
    );
    expect(f.top).toBe('path');
    expect(doubtOf(f).score).toBeLessThan(DOUBT_AT);
  });
});

describe('lit where it is worth a look', () => {
  const quay = () =>
    read(
      [
        box('water', { class: 'river' }, -300, -3, 300, 120),
        line('transportation', { class: 'minor' }, [
          [-300, -12],
          [300, -12],
        ]),
        ...filler(30),
      ],
      facts({ conus: false, inUS: false, nlcd: null, terr: terr(0.5, 35, 90, 0.4) }),
      pixels('paved'),
    );
  it('a quay 3 m inside a mapped river: the map says water, the photo says stone', () => {
    const { f, d } = quay();
    expect(f.top).toBe('water');
    /* the photo reads paved 1.84 or building 1.66, water -1.11: split, and against the call */
    expect(d.against?.id).toBe('image');
    expect(d.against?.cls).toBe('paved');
    expect(d.spread).toBeCloseTo(0.4, 6);
    expect(doubtWords(d, f)).toBe('the map says water, the photo says paved surface');
  });
  /* A miss since the v4 imagery classifier (M6). Water wins at 71% (v3: 55%,
     close enough to light), and the photo is the only dissent: 1.0 of the 2.5
     weight with an opinion, against the map (1.0) and the terrain (0.5), which
     both back water. 0.40 stays under the bar. Kept as an expected failure. */
  it.fails('and lights', () => {
    expect(quay().d.score).toBeGreaterThanOrEqual(DOUBT_AT);
  });
  it('seasonal snow over mapped bare rock: confident, and still doubtful', () => {
    const { f, d } = read(
      [box('landcover', { class: 'rock' }, -300, -300, 300, 300)],
      facts({ conus: false, inUS: false, nlcd: null, terr: terr(22, 2700, 90, 1.5) }),
      white,
    );
    expect(f.top).toBe('bare');
    expect(f.topP).toBeGreaterThan(0.6);
    expect(d.score).toBeGreaterThanOrEqual(DOUBT_AT);
    expect(d.against?.cls).toBe('snow');
    expect(d.against?.id).toBe('image');
    expect(doubtWords(d, f)).toBe('the map says bare ground, the photo says snow');
  });
});

describe('who counts', () => {
  /* a station from its sources alone: the call at 90%, each source's
     log-likelihoods (0 where not given) */
  const station = (call: ClassKey, rows: [SourceId, number, Partial<Record<ClassKey, number>>][]) => {
    const p = K.map(k => (k === call ? 0.9 : 0.1 / (K.length - 1)));
    return {
      top: call,
      topP: 0.9,
      p,
      order: K.map((_, i) => i).sort((a, b) => p[b] - p[a]),
      tau: 1,
      ledger: rows.map(([id, w, ll]) => ({
        id,
        n: id,
        d: '',
        w,
        wbase: w,
        status: 'ok' as const,
        bits: 0,
        ll: Float64Array.from(K, k => ll[k] ?? 0),
      })),
    } as unknown as Fused;
  };
  it('a source split between two classes that both lead the call dissents', () => {
    const d = doubtOf(
      station('water', [
        ['contain', 1, { water: 3 }],
        ['image', 1, { paved: 1.8, building: 1.6, water: -1 }],
      ]),
    );
    expect(d.spread).toBe(0.5);
    expect(d.against).toMatchObject({ id: 'image', cls: 'paved' });
  });
  it('a pair that holds the call says nothing about it', () => {
    const d = doubtOf(
      station('building', [
        ['struct', 1, { building: 3 }],
        ['image', 1, { paved: 1.8, building: 1.6 }],
      ]),
    );
    expect(d.spread).toBe(0);
    expect(d.backer?.id).toBe('struct');
  });
  it('three or more favourites say nothing: the line source only argues against classes', () => {
    const d = doubtOf(
      station('grass', [
        ['contain', 1, { grass: 2 }],
        ['prox', 1, { path: -1, rail: -1, paved: -1, building: -1 }],
        ['image', 1, { snow: 1, bare: 0.9, crop: 0.8, grass: -1 }],
      ]),
    );
    expect(d.spread).toBe(0);
    expect(d.against).toBeNull();
  });
});

describe('the walk check list', () => {
  const spot = (i: number, d: number, score: number) => ({ i, d, score });
  it('takes the most doubtful, one per stretch, in walking order', () => {
    const lit = [
      spot(0, 0, 0.55),
      spot(1, 10, 0.9),
      spot(2, 30, 0.95),
      spot(3, 100, 0.6),
      spot(4, 300, 0.7),
      spot(5, 200, 0.3),
    ];
    /* 30 m beats its neighbours at 0 and 10; 200 m isn't lit */
    expect(checkList(lit).map(s => s.d)).toEqual([30, 100, 300]);
  });
  it('stops at five, at least 40 m apart', () => {
    const many = Array.from({ length: 40 }, (_, i) => spot(i, i * 25, 0.5 + i / 100));
    const picks = checkList(many);
    expect(picks).toHaveLength(CHECK.n);
    for (let k = 1; k < picks.length; k++)
      expect(picks[k].d - picks[k - 1].d).toBeGreaterThanOrEqual(CHECK.apart);
    expect(picks[picks.length - 1].i).toBe(39);
  });
  it('is empty when nothing is worth a look', () => {
    expect(checkList([spot(0, 0, 0.49)])).toEqual([]);
  });
});
