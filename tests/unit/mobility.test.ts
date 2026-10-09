/* Go / slow / no-go (engine/mobility, data/soils): the presets on known
 * ground, the factors that slow or stop each, and a line summed. */
import { describe, it, expect } from 'vitest';
import { CIX, K } from '../../src/core/classes';
import { rateLine, rateStation, tobler } from '../../src/engine/mobility';
import type { GoingIn } from '../../src/engine/mobility';
import { drainsPoorly, parseSoils, soilQuery } from '../../src/data/soils';
import type { ClassKey } from '../../src/core/types';

const on = (mix: Partial<Record<ClassKey, number>>, o: Partial<GoingIn> = {}): GoingIn => {
  const p = new Array(K.length).fill(0);
  for (const [k, v] of Object.entries(mix)) p[CIX[k as ClassKey]] = v;
  return { p, grade: 0, slope: 0, rough: 0.05, canopy: null, wet: false, tread: null, cross: null, ...o };
};

describe("Tobler's hiking function", () => {
  it('is 1 on the level, fastest on a slight descent, 0.70 up a 10% grade', () => {
    expect(tobler(0)).toBeCloseTo(1, 9);
    expect(tobler(-0.05)).toBeCloseTo(Math.exp(0.175), 9);
    expect(tobler(0.1)).toBeCloseTo(Math.exp(-0.35), 9);
    expect(tobler(0.1)).toBeLessThan(tobler(-0.1));
  });
});

describe('a station', () => {
  it('a level road: each preset at its speed on good ground', () => {
    const road = on({ paved: 1 });
    expect(rateStation(road, 'foot')).toMatchObject({ v: 3.75, band: 'go', nogo: 0 });
    expect(rateStation(road, 'atv').v).toBeCloseTo(30, 9);
    expect(rateStation(road, 'truck').v).toBeCloseTo(50, 9);
  });
  it('forest: a walker gets through, an ATV slowly, a truck not at all', () => {
    const wood = on({ forest: 1 });
    expect(rateStation(wood, 'foot')).toMatchObject({ v: 2.25, band: 'go' });
    expect(rateStation(wood, 'atv')).toMatchObject({ v: 6, band: 'slow' });
    expect(rateStation(wood, 'truck')).toMatchObject({ v: 0, band: 'nogo', why: ['forest (100%)'] });
  });
  it('averages by time: half road, half marsh is slow, not medium', () => {
    const v = rateStation(on({ paved: 0.5, wetland: 0.5 }), 'foot').v;
    expect(v).toBeCloseTo(0.75 / (0.5 / 5 + 0.5 / (5 * 0.35)), 9);
    expect(v).toBeLessThan((0.75 * (5 + 5 * 0.35)) / 2);
  });
  it('keeps the chance of a no-go apart: 30% water is a warning, 60% stops it', () => {
    expect(rateStation(on({ grass: 0.7, water: 0.3 }), 'foot')).toMatchObject({ band: 'slow', nogo: 0.3 });
    expect(rateStation(on({ grass: 0.4, water: 0.6 }), 'foot').band).toBe('nogo');
  });
  it('a stream is forded; a river with no bridge stops you', () => {
    const stream = rateStation(
      on({ water: 1 }, { cross: { cls: 'water', what: 'stream (intermittent)' } }),
      'foot',
    );
    expect(stream).toMatchObject({ v: 1.5, band: 'slow', why: ['fording a stream'] });
    const river = rateStation(on({ water: 1 }, { cross: { cls: 'water', what: 'river' } }), 'foot');
    expect(river).toMatchObject({ band: 'nogo', why: ['the river, no bridge (100%)'] });
  });
  it('a climb slows a walker by Tobler, and too steep stops a vehicle off a tread', () => {
    expect(rateStation(on({ grass: 1 }, { grade: 0.2 }), 'foot').why).toEqual(['a 20% climb']);
    expect(rateStation(on({ grass: 1 }, { slope: 30 }), 'atv')).toMatchObject({
      band: 'nogo',
      why: ['too steep (30°) (100%)'],
    });
    expect(rateStation(on({ grass: 1 }, { slope: 30 }), 'foot').band).toBe('go');
  });
  it('on a built tread only its own grade counts, however steep the ground beside it', () => {
    expect(rateStation(on({ paved: 1 }, { slope: 35, grade: 0.06 }), 'truck').band).not.toBe('nogo');
  });
  it('on a mapped path, the cliff beside it doesn’t count, even where the answer doubts the tread', () => {
    const ledge = on({ path: 0.45, bare: 0.35, scrub: 0.2 }, { slope: 51, grade: 0.15, tread: 'path' });
    expect(rateStation(ledge, 'foot').band).not.toBe('nogo');
    expect(rateStation({ ...ledge, tread: null }, 'foot')).toMatchObject({ band: 'nogo' });
  });
  it('the mapped path type decides for vehicles: a truck fits a track, not a footway', () => {
    expect(rateStation(on({ path: 1 }, { tread: 'track' }), 'truck')).toMatchObject({ v: 20, band: 'slow' });
    expect(rateStation(on({ path: 1 }, { tread: 'footway' }), 'truck')).toMatchObject({
      band: 'nogo',
      why: ['a footway (100%)'],
    });
    expect(rateStation(on({ path: 1 }, { tread: 'steps' }), 'foot').v).toBeCloseTo(2.25, 9);
  });
  it('slow on the ground itself names the ground', () => {
    expect(rateStation(on({ path: 0.7, paved: 0.3 }, { tread: 'cycleway' }), 'atv')).toMatchObject({
      band: 'slow',
      why: ['a cycleway'],
    });
  });
  it('wet soil that drains poorly slows vehicles off a tread, not on one', () => {
    expect(rateStation(on({ grass: 1 }, { wet: true }), 'atv').v).toBeCloseTo(30 * 0.6 * 0.5, 9);
    expect(rateStation(on({ paved: 1 }, { wet: true }), 'atv').v).toBeCloseTo(30, 9);
  });
  it('rough ground halves a vehicle; dense canopy stops a truck off a tread', () => {
    expect(rateStation(on({ grass: 1 }, { rough: 0.6 }), 'atv').why).toContain('rough ground (±0.60 m)');
    expect(rateStation(on({ grass: 1 }, { canopy: 55 }), 'truck')).toMatchObject({ band: 'nogo' });
  });
});

describe('a line', () => {
  const r = (band: 'go' | 'slow' | 'nogo', v: number, why: string[] = []) => ({
    band,
    v,
    nogo: band === 'nogo' ? 1 : 0,
    why,
  });
  it('sums time over the usable stretches and merges a blocked run', () => {
    const B = [0, 100, 200, 300, 400];
    const l = rateLine(
      B,
      [
        r('go', 5),
        r('nogo', 0, ['the river, no bridge (100%)']),
        r('nogo', 0, ['water (90%)']),
        r('go', 2.5),
      ],
      'foot',
    );
    expect(l.usable).toBe(200);
    expect(l.hours).toBeCloseTo(0.1 / 5 + 0.1 / 2.5, 12);
    expect(l.smg).toBeCloseTo(0.2 / l.hours, 12);
    expect(l.blocked).toEqual([{ d0: 100, d1: 300, why: 'the river, no bridge' }]);
    expect(l.counts).toEqual({ go: 2, slow: 0, nogo: 2 });
  });
});

describe('soils', () => {
  it('asks for every point in one query, numbered in order', () => {
    const q = soilQuery([
      { lat: 37.7486, lon: -119.5868 },
      { lat: 37.7425, lon: -119.5652 },
    ]);
    expect(q).toContain("point(-119.586800 37.748600)') k UNION ALL SELECT 1 AS i");
    expect(q).toContain("c.majcompflag = 'Yes'");
  });
  it('keeps the largest component per point, and nothing where there are no rows', () => {
    const s = parseSoils(
      {
        Table: [
          ['0', 'Happyisles complex', 'Well drained', 'A'],
          ['0', 'Happyisles complex', 'Somewhat poorly drained', 'C'],
          ['2', 'Water-Riverwash complex', null, 'D'],
        ],
      },
      3,
    );
    expect(s[0]).toEqual({ unit: 'Happyisles complex', drainage: 'Well drained', group: 'A' });
    expect(s[1]).toBeNull();
    expect(s[2]).toEqual({ unit: 'Water-Riverwash complex', drainage: null, group: 'D' });
    expect(parseSoils({}, 2)).toEqual([null, null]);
  });
  it('drains poorly: a poorly drained class, or group C or D', () => {
    expect(drainsPoorly({ unit: '', drainage: 'Somewhat poorly drained', group: 'A' })).toBe(true);
    expect(drainsPoorly({ unit: '', drainage: 'Well drained', group: 'B/D' })).toBe(true);
    expect(drainsPoorly({ unit: '', drainage: 'Well drained', group: 'A' })).toBe(false);
  });
});
