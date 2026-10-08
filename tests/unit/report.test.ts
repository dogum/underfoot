/* The route surface report on a made-up 100 m line: forest, a street crossing,
 * a path, then grass, over a profile that climbs 5 m and levels off. */
import { describe, it, expect } from 'vitest';
import { routeReport, spanBounds, type StationCall } from '../../src/engine/report';
import type { ClassKey, Station } from '../../src/core/types';

const st = (d: number, x?: ClassKey, name: string | null = null, w?: number): Station => ({
  lat: 37.74,
  lon: -119.59,
  d,
  ...(x ? { x: { d, cls: x, what: x === 'paved' ? 'street' : x, name, w } } : {}),
});
const call = (top: ClassKey, conf = 0.8, doubt = 0.1): StationCall => ({ top, topP: 0.9, conf, doubt });
/* forest, an 8 m street crossed at 45 m, a path, then grass */
const stations = [
  st(0),
  st(10),
  st(20),
  st(30),
  st(45, 'paved', 'Northside Drive', 4),
  st(60),
  st(70),
  st(80),
  st(90),
  st(100),
];
const calls = [
  call('forest'),
  call('forest'),
  call('forest'),
  call('forest'),
  call('paved', 0.9),
  call('path'),
  call('path'),
  call('path'),
  call('grass', 0.3, 0.7),
  call('grass'),
];
const profile = Array.from({ length: 101 }, (_, d) => ({ d, z: 100 + Math.min(d, 50) * 0.1 }));
const R = routeReport(stations, calls, profile);
const of = (k: ClassKey) => R.classes.find(c => c.cls === k)!;

describe('route surface report', () => {
  it('class lengths sum to the line', () => {
    expect(R.length).toBe(100);
    expect(R.classes.reduce((a, c) => a + c.m, 0)).toBeCloseTo(100, 9);
    expect(of('forest').m).toBeCloseTo(41);
    expect(of('path').m).toBeCloseTo(36);
    expect(of('grass').m).toBeCloseTo(15);
    expect(R.classes[0].cls).toBe('forest');
  });
  it('a crossing covers its mapped width, not the gap to its neighbours', () => {
    expect(of('paved').m).toBeCloseTo(8);
    expect(spanBounds(stations).slice(3, 7)).toEqual([25, 41, 49, 65]);
  });
  it('a crossing wider than the room it has stops at the midpoints', () => {
    const tight = [st(0), st(10), st(15, 'paved', null, 8), st(20), st(30)];
    expect(spanBounds(tight)).toEqual([0, 5, 12.5, 17.5, 25, 30]);
  });
  it('each class keeps its longest unbroken run', () => {
    expect(of('forest').longest).toEqual({ m: 41, d0: 0, d1: 41 });
    expect(of('grass').longest).toEqual({ m: 15, d0: 85, d1: 100 });
  });
  it('counts crossings by what they cross, with names', () => {
    expect(R.crossings).toEqual([{ cls: 'paved', n: 1, names: ['Northside Drive'] }]);
  });
  it('climbs 5 m, descends none, steepest 10% uphill', () => {
    expect(R.climb).toBeCloseTo(5, 6);
    expect(R.descent).toBe(0);
    expect(R.steepest!.grade).toBeCloseTo(0.1, 6);
  });
  it('lists the stations worth a look, and the check list', () => {
    expect(R.doubtful).toEqual([{ i: 8, d: 90, top: 'grass', score: 0.7 }]);
    expect(R.checks).toEqual(R.doubtful);
  });
  it('a metre of DEM noise is not climbing', () => {
    const noisy = Array.from({ length: 200 }, (_, d) => ({ d, z: 50 + 0.4 * Math.sin(d) }));
    expect(routeReport(stations, calls, noisy).climb).toBe(0);
  });
  it('without a profile there is no climb, and pending stations are counted apart', () => {
    const r = routeReport(stations, [...calls.slice(0, 6), null, ...calls.slice(7)], null);
    expect(r.climb).toBeNull();
    expect(r.steepest).toBeNull();
    expect(r.pending).toBeCloseTo(10);
    expect(r.classes.reduce((a, c) => a + c.m, 0) + r.pending).toBeCloseTo(100, 9);
  });
});
