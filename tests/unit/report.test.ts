/* The route surface report on a made-up 100 m line: forest, a road crossing,
 * a path, then grass, over a profile that climbs 5 m and levels off. */
import { describe, it, expect } from 'vitest';
import { routeReport, type StationCall } from '../../src/engine/report';
import type { ClassKey, Station } from '../../src/core/types';

const st = (d: number, x?: ClassKey, name: string | null = null): Station => ({
  lat: 37.74,
  lon: -119.59,
  d,
  ...(x ? { x: { d, cls: x, what: x === 'paved' ? 'street' : x, name } } : {}),
});
const call = (top: ClassKey, conf = 0.8): StationCall => ({ top, topP: 0.9, conf });
const stations = [
  st(0),
  st(10),
  st(20),
  st(30),
  st(35, 'paved', 'Northside Drive'),
  st(40),
  st(50),
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
  call('grass'),
  call('grass', 0.3),
  call('grass'),
  call('grass'),
];
const profile = Array.from({ length: 101 }, (_, d) => ({ d, z: 100 + Math.min(d, 50) * 0.1 }));
const R = routeReport(stations, calls, profile);
const of = (k: ClassKey) => R.classes.find(c => c.cls === k)!;

describe('route surface report', () => {
  it('class lengths sum to the line, split at the midpoints between stations', () => {
    expect(R.length).toBe(100);
    expect(R.classes.reduce((a, c) => a + c.m, 0)).toBeCloseTo(100, 9);
    expect(of('forest').m).toBeCloseTo(32.5);
    expect(of('paved').m).toBeCloseTo(5);
    expect(of('path').m).toBeCloseTo(27.5);
    expect(of('grass').m).toBeCloseTo(35);
    expect(R.classes[0].cls).toBe('grass');
  });
  it('each class keeps its longest unbroken run', () => {
    expect(of('forest').longest).toEqual({ m: 32.5, d0: 0, d1: 32.5 });
    expect(of('grass').longest.d1).toBe(100);
  });
  it('counts crossings by what they cross, with names', () => {
    expect(R.crossings).toEqual([{ cls: 'paved', n: 1, names: ['Northside Drive'] }]);
  });
  it('climbs 5 m, descends none, steepest 10% uphill', () => {
    expect(R.climb).toBeCloseTo(5, 6);
    expect(R.descent).toBe(0);
    expect(R.steepest!.grade).toBeCloseTo(0.1, 6);
  });
  it('lists the stations under 40% confidence', () => {
    expect(R.doubtful).toEqual([{ i: 9, d: 80, top: 'grass', conf: 0.3 }]);
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
