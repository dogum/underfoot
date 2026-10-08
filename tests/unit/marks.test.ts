/* Marks (io/marks): what a mark keeps, how one is found again, and what a refit may learn from. */
import { describe, it, expect } from 'vitest';
import { K } from '../../src/core/classes';
import {
  fitMarks,
  keepParts,
  markTitle,
  marksCSV,
  marksGeoJSON,
  marksSummary,
  nearestMark,
  type Mark,
} from '../../src/io/marks';
import type { ClassKey, Parts } from '../../src/core/types';

const ll = (k: ClassKey, v = 1.23456789) => Float64Array.from(K, c => (c === k ? v : -v / 11));
const parts: Parts = {
  contain: { ll: ll('grass'), status: 'ok', note: 'OSM says <b>meadow</b>' },
  cover: { ll: ll('wetland'), status: 'ok', wmul: 1 },
  image: { ll: ll('grass'), status: 'ok', wmul: 0.6 },
  prox: { ll: ll('path'), status: 'ok', exact: { cls: 'path', p: 0.93 } },
  gaz: { ll: new Float64Array(K.length), status: 'na' },
};
const mk = (over: Partial<Mark>): Mark => ({
  id: 'a',
  t: Date.UTC(2026, 9, 8, 9, 30),
  lat: 37.745046,
  lon: -119.589358,
  verdict: 'wrong',
  call: 'grass',
  p: 0.58,
  truth: 'wetland',
  how: 'here',
  parts: keepParts(parts),
  prior: 'probed',
  place: "Cook's Meadow Trail, Yosemite Lodge",
  link: '#m=path&s=auto&v=1,2;3,4&at=458',
  station: 30,
  d: 458,
  v: '1.1.1',
  ...over,
});

describe('a mark keeps the readings', () => {
  const kept = keepParts(parts);
  it('every source, its status and log-likelihoods to 4 places, without the prose', () => {
    expect(Object.keys(kept)).toEqual(['contain', 'cover', 'image', 'prox', 'gaz']);
    expect(kept.contain!.ll[K.indexOf('grass')]).toBe(1.2346);
    expect(kept.contain!.note).toBeUndefined();
    expect(kept.gaz!.status).toBe('na');
  });
  it('a weight multiplier only when it moves, and exact terms', () => {
    expect(kept.cover!.wmul).toBeUndefined();
    expect(kept.image!.wmul).toBe(0.6);
    expect(kept.prox!.exact).toEqual({ cls: 'path', p: 0.93 });
  });
});

describe('finding and using marks', () => {
  const list = [
    mk({ id: 'w' }),
    mk({ id: 'r', verdict: 'right', call: 'forest', truth: 'forest', lat: 37.746, lon: -119.588 }),
    mk({ id: 'u', verdict: 'unsure', truth: null, lat: 37.7, lon: -119.5 }),
  ];
  it('a station within 2 m is the marked spot; 3 m away is not', () => {
    expect(nearestMark(list, 37.745046 + 1.5 / 111320, -119.589358)?.id).toBe('w');
    expect(nearestMark(list, 37.745046 + 3 / 111320, -119.589358)).toBeNull();
  });
  it('a refit learns from right and wrong marks, not from not-sure ones', () => {
    const f = fitMarks(list);
    expect(f.map(m => m.truth)).toEqual(['wetland', 'forest']);
    expect(f[0].parts.cover!.status).toBe('ok');
  });
  it('says what each mark is', () => {
    expect(list.map(markTitle)).toEqual(['Grass → wetland', 'Forest', 'Not sure: grass']);
    expect(marksSummary(list)).toBe('3 marks · 1 right, 1 wrong, 1 not sure');
  });
});

describe('exports', () => {
  const list = [mk({}), mk({ id: 'p', verdict: 'right', truth: 'grass', d: null, link: '#m=point&v=1,2' })];
  it('CSV: one row a mark, quoted where it must be, links on the public site', () => {
    const rows = marksCSV(list, 'https://site/').trim().split('\n');
    expect(rows[0]).toBe('made,lat,lon,verdict,call,p_call,truth,how,place,station,distance_m,link');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain(
      `wrong,grass,0.5800,wetland,here,"Cook's Meadow Trail, Yosemite Lodge",30,458.0,`,
    );
    expect(rows[1].endsWith('"https://site/#m=path&s=auto&v=1,2;3,4&at=458"')).toBe(true);
    expect(rows[2]).toContain(',30,,"https://site/#m=point&v=1,2"');
  });
  it('GeoJSON: points with the readings by class', () => {
    const g = marksGeoJSON(list, 'https://site/') as any;
    expect(g.type).toBe('FeatureCollection');
    expect(g.features[0].geometry.coordinates).toEqual([-119.589358, 37.745046]);
    const p = g.features[0].properties;
    expect([p.verdict, p.call, p.truth, p.how]).toEqual(['wrong', 'grass', 'wetland', 'here']);
    expect(p.readings.contain.ll.grass).toBe(1.2346);
    expect(p.readings.prox.exact.cls).toBe('path');
    expect(JSON.parse(JSON.stringify(g)).features).toHaveLength(2);
  });
});
