/* Sharing marks (io/contribute): what a mark becomes when it leaves the browser, and what it never carries. */
import { describe, it, expect } from 'vitest';
import { K } from '../../src/core/classes';
import { cellOf, shareable, toRow } from '../../src/io/contribute';
import { keepParts, type Mark } from '../../src/io/marks';
import type { ClassKey } from '../../src/core/types';

const ll = (k: ClassKey) => Float64Array.from(K, c => (c === k ? 1.23456 : -0.11223));
const mark = (over: Partial<Mark> = {}): Mark => ({
  id: 'm1',
  t: Date.UTC(2026, 9, 8, 9, 30),
  lat: 37.745046,
  lon: -119.589358,
  verdict: 'wrong',
  call: 'grass',
  p: 0.5812,
  truth: 'wetland',
  how: 'here',
  parts: keepParts({
    contain: { ll: ll('grass'), status: 'ok' },
    cover: { ll: ll('wetland'), status: 'ok', wmul: 0.8 },
  }),
  prior: 'probed',
  place: "Cook's Meadow Trail, Yosemite Lodge",
  link: '#m=path&v=1,2;3,4&at=458',
  station: 30,
  d: 458,
  v: '1.2.1',
  ...over,
});

describe('the 1° cell', () => {
  it('is named by its south-west corner, like an SRTM tile', () => {
    expect(cellOf(37.745, -119.589)).toBe('N37W120');
    expect(cellOf(-33.87, 151.21)).toBe('S34E151');
    expect(cellOf(46.5005, 8.051)).toBe('N46E008');
    expect(cellOf(0.5, -0.5)).toBe('N00W001');
  });
});

describe('a shared mark', () => {
  const row = toRow(mark(), 'browser-1');
  it('carries what the fit needs', () => {
    expect(row).toMatchObject({
      id: 'm1',
      who: 'browser-1',
      month: '2026-10',
      cell: 'N37W120',
      verdict: 'wrong',
      call: 'grass',
      p_call: 0.5812,
      truth: 'wetland',
      how: 'here',
      prior: 'probed',
    });
    expect(row.readings.contain!.ll.grass).toBe(1.2346);
    expect(row.readings.cover!.wmul).toBe(0.8);
  });
  it('never the place, the link, the day or the point', () => {
    const json = JSON.stringify(row);
    expect(json).not.toMatch(/Cook|Yosemite|#m=|at=458|09:30|2026-10-08/);
    expect([row.lat, row.lon]).toEqual([null, null]);
    expect(Object.keys(row).sort()).toEqual([
      'call',
      'cell',
      'how',
      'id',
      'lat',
      'lon',
      'month',
      'p_call',
      'prior',
      'readings',
      'truth',
      'verdict',
      'version',
      'who',
    ]);
  });
  it('the point only when the person ticks the box, to about a metre', () => {
    const p = toRow(mark(), 'browser-1', true);
    expect([p.lat, p.lon]).toEqual([37.74505, -119.58936]);
  });
  it('not-sure marks and marks already shared stay behind', () => {
    const list = [mark(), mark({ id: 'u', verdict: 'unsure', truth: null }), mark({ id: 's', shared: 1 })];
    expect(shareable(list).map(m => m.id)).toEqual(['m1']);
  });
});
