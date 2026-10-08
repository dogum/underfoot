/* Follow the trail: synthetic lines along, beside and across mapped paths and
 * roads, written in local metres. No network, runs in Node. */
import { describe, it, expect } from 'vitest';
import { CIX, PRIORS, SOURCES } from '../../src/core/classes';
import { offset } from '../../src/core/geo';
import { cumLen, findCrossings, snapStations } from '../../src/app/stations';
import { followLines } from '../../src/engine/follow';
import { computeParts, fuseParts, DEFAULT_NEFF } from '../../src/engine/fuse';
import { buildGeo, geoAt } from '../../src/engine/geometry';
import type { LatLon, TileFeature } from '../../src/core/types';

const O = { lat: 37.74, lon: -119.59 };
const at = (x: number, y: number): LatLon => offset(O, x, y);
const line = (L: string, p: Record<string, any>, pts: number[][]): TileFeature => {
  const a: number[] = [];
  for (const [x, y] of pts) {
    const q = at(x, y);
    a.push(q.lon, q.lat);
  }
  const lon = a.filter((_, i) => i % 2 === 0),
    lat = a.filter((_, i) => i % 2 === 1);
  return {
    L,
    t: 2,
    p,
    r: [Float64Array.from(a)],
    bb: [Math.min(...lon), Math.min(...lat), Math.max(...lon), Math.max(...lat)],
  };
};
/** a gently curving trail, 600 m west to east */
const trailXY = (x: number) => 25 * Math.sin(x / 90);
const TRAIL = Array.from({ length: 121 }, (_, i) => [-300 + i * 5, trailXY(-300 + i * 5)]);
const path = (pts = TRAIL) => line('transportation', { class: 'path', subclass: 'path' }, pts);
const named = (name: string, pts = TRAIL) => line('transportation_name', { class: 'path', name }, pts);
/** deterministic wobble standing in for GPS error */
const wobble = (i: number, amp: number) => amp * Math.sin(i * 1.7) * Math.cos(i * 0.31);
/** a recorded line: a fix every 6 m along the trail, `side` metres off it, with wobble */
const recorded = (side: number, amp: number, x0 = -290, x1 = 290) =>
  Array.from({ length: Math.floor((x1 - x0) / 6) + 1 }, (_, i) => {
    const x = x0 + i * 6;
    return at(x, trailXY(x) + side + wobble(i, amp));
  });
const covered = (m: ReturnType<typeof followLines>, L: number) =>
  m.stretches.reduce((a, s) => a + s.d1 - s.d0, 0) / L;

describe('a line along a mapped path follows it', () => {
  it('a GPS track wobbling ±6 m along the trail follows it end to end', () => {
    const m = followLines(recorded(0, 6), [path()]);
    expect(m.stretches).toHaveLength(1);
    expect(m.stretches[0].cls).toBe('path');
    expect(covered(m, 600)).toBeGreaterThan(0.9);
  });
  it('a track 9 m to one side, as in a gorge, still follows it', () => {
    expect(covered(followLines(recorded(9, 4), [path()]), 600)).toBeGreaterThan(0.8);
  });
  it('the last station, at the very end of the line, is on the stretch', () => {
    const v = recorded(0, 6),
      m = followLines(v, [path()]),
      L = cumLen(v).at(-1)!;
    expect(m.at((L * 47) / 47 + 1e-9)).toBe(0);
  });
  it('the stretch carries the path’s name', () => {
    const m = followLines(recorded(0, 4), [path(), named('Mist Trail')]);
    expect(m.stretches[0].name).toBe('Mist Trail');
  });
  it('a snapped point lands on the trail', () => {
    const v = recorded(0, 6),
      m = followLines(v, [path()]);
    const p = at(0, trailXY(0) + 7),
      s = m.snap(p, 290)!;
    expect(s.off).toBeGreaterThan(5);
    expect(s.off).toBeLessThan(9);
    expect(Math.abs(s.lat - at(0, trailXY(0)).lat) * 111320).toBeLessThan(1.5);
  });
  it('a hand-drawn line clicked along the trail’s bends follows it', () => {
    const v = [-290, -200, -100, 0, 100, 200, 290].map(x => at(x, trailXY(x) + 1));
    expect(covered(followLines(v, [path()]), 600)).toBeGreaterThan(0.8);
  });
});

describe('a line that only passes a mapped path does not', () => {
  it('a transect 30 m beside the trail', () => {
    expect(followLines(recorded(30, 4), [path()]).stretches).toHaveLength(0);
  });
  it('a line crossing the trail at right angles', () => {
    const v = Array.from({ length: 50 }, (_, i) => at(0, -150 + i * 6));
    expect(followLines(v, [path()]).stretches).toHaveLength(0);
  });
  it('a hand-drawn straight line 8 m beside a straight path (the demo-line case)', () => {
    const straight = path([
      [-300, 0],
      [300, 0],
    ]);
    expect(followLines([at(-280, 8), at(0, 8.5), at(280, 8)], [straight]).stretches).toHaveLength(0);
  });
  it('…but the same line drawn on the path follows it', () => {
    const straight = path([
      [-300, 0],
      [300, 0],
    ]);
    expect(followLines([at(-280, 1), at(0, 1.5), at(280, 1)], [straight]).stretches).toHaveLength(1);
  });
  it('a line that leaves the trail stops following where it leaves', () => {
    const v = [
      ...recorded(0, 3, -290, 0),
      ...Array.from({ length: 34 }, (_, i) => at(0, trailXY(0) + 6 + i * 6)),
    ];
    const m = followLines(v, [path()]);
    expect(m.stretches).toHaveLength(1);
    expect(Math.abs(m.stretches[0].d1 - 290)).toBeLessThan(30); // a few fixes of lag at a sharp turn
  });
});

describe('roads and the sidewalks beside them', () => {
  const street = line('transportation', { class: 'minor' }, [
      [-300, 0],
      [300, 0],
    ]),
    sidewalk = line('transportation', { class: 'path', subclass: 'footway' }, [
      [-300, -7],
      [300, -7],
    ]);
  const along = (y: number) => Array.from({ length: 98 }, (_, i) => at(-290 + i * 6, y + wobble(i, 1.5)));
  it('a track down the middle of the street follows the street', () => {
    const m = followLines(along(0), [street, sidewalk]);
    expect(m.stretches.map(s => s.cls)).toEqual(['paved']);
  });
  it('a track on the sidewalk follows the sidewalk', () => {
    const m = followLines(along(-7), [street, sidewalk]);
    expect(m.stretches.map(s => s.cls)).toEqual(['path']);
  });
});

describe('fusion on a followed stretch', () => {
  const W = Object.fromEntries(SOURCES.map(s => [s.id, s.w]));
  const opt = { weights: W, neff: DEFAULT_NEFF, prior: PRIORS.probed };
  const wood = (): TileFeature => {
    const r = [
      [-300, -300],
      [300, -300],
      [300, 300],
      [-300, 300],
      [-300, -300],
    ].flatMap(([x, y]) => {
      const q = at(x, y);
      return [q.lon, q.lat];
    });
    return {
      L: 'landcover',
      t: 3,
      p: { class: 'wood' },
      r: [Float64Array.from(r)],
      bb: [-180, -90, 180, 90],
    };
  };
  const forestFacts = {
    conus: true,
    inUS: true,
    structOk: true,
    nlcd: { code: 42, name: 'Evergreen forest', canopy: 70, imperv: 0, desc: 0, descName: null },
    nom: null,
    imgWmul: 1,
  };
  const station = at(0, trailXY(0));
  const q = () => geoAt(buildGeo(station, [wood(), path()], [], 170), 0, 0, true);
  it('a trail under forest is forest when it is only passed…', () => {
    const f = fuseParts(computeParts(forestFacts, q(), null), opt);
    expect(f.top).toBe('forest');
  });
  it('…and path when the line follows it', () => {
    const g = Object.assign(q(), { follow: 'path' as const });
    const f = fuseParts(computeParts(forestFacts, g, null), opt);
    expect(f.top).toBe('path');
    expect(f.p[CIX.path]).toBeGreaterThan(0.9);
    expect(f.p[CIX.path]).toBeLessThan(0.99);
  });
});

describe('crossings along a followed stretch', () => {
  /* a track that weaves across the trail, beside a creek running parallel 12 m
     north, and over a stream the trail itself crosses at x = 100 */
  const creek = line(
      'waterway',
      { class: 'stream' },
      TRAIL.map(([x, y]) => [x, y + 12]),
    ),
    stream = line('waterway', { class: 'stream' }, [
      [100, -60],
      [100, 80],
    ]);
  const v = Array.from({ length: 97 }, (_, i) => {
    const x = -288 + i * 6;
    return at(x, trailXY(x) + 7 * Math.sin(i * 0.9) + (i === 40 ? 8 : 0));
  });
  const feats = [path(), creek, stream];
  const m = followLines(v, feats);
  it('the track follows the trail', () => expect(covered(m, 576)).toBeGreaterThan(0.9));
  const cr = findCrossings(v, feats, m);
  it('weaving across the trail it follows is not a crossing', () =>
    expect(cr.filter(c => c.cls === 'path')).toHaveLength(0));
  const atStream = cumLen(v)[65]; // the fix at x = 102
  it('wandering over the creek beside the trail is not a crossing', () =>
    expect(cr.filter(c => c.cls === 'water' && Math.abs(c.d - atStream) > 15)).toHaveLength(0));
  it('the stream the trail crosses is', () => expect(cr.filter(c => c.cls === 'water')).toHaveLength(1));
  it('without following, the weave fills the crossing budget and crowds the stream out', () => {
    const plain = findCrossings(v, feats);
    expect(plain.filter(c => c.cls === 'path').length).toBeGreaterThan(20);
    expect(plain.filter(c => c.cls === 'water')).toHaveLength(0);
  });
  it('stations on the stretch move onto the trail and say so', () => {
    const st = snapStations([{ ...v[30], d: 180 }], m);
    expect(st[0].f).toMatchObject({ cls: 'path', k: 0 });
    expect(st[0].raw).toEqual({ lat: v[30].lat, lon: v[30].lon });
  });
});
