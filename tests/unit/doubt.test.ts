/* Doubt: the cases docs/roadmap.md names. A Seine-quay split and seasonal
 * snow over mapped bare rock (Aletsch) light up; a reservoir and a rooftop
 * stay quiet. Synthetic scenes in local metres, evidence as each source would
 * see it. No network, runs in Node. */
import { describe, it, expect } from 'vitest';
import MEDIAN from './fixtures/class_median_feats.json';
import { PRIORS, SOURCES } from '../../src/core/classes';
import { DOUBT_AT, doubtOf } from '../../src/engine/doubt';
import { computeParts, fuseParts, DEFAULT_NEFF } from '../../src/engine/fuse';
import { buildGeo, geoAt } from '../../src/engine/geometry';
import { at, box, line } from './scene';
import type { TileFeature } from '../../src/core/types';

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
  it('a quay 3 m inside a mapped river: the map says water, the photo says stone', () => {
    const { f, d } = read(
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
    expect(f.topP).toBeLessThan(0.7);
    expect(d.score).toBeGreaterThanOrEqual(DOUBT_AT);
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
  });
});
