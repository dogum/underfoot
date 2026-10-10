/* Batch points: reading a file's points (io/points), grouping nearby points
 * to share requests and ordering the table (engine/batch), and the exports
 * (io/batch). */
import { describe, it, expect } from 'vitest';
import { readCSV, readGeoJSON, splitCSV } from '../../src/io/points';
import { BATCH, groupPoints, hilbert, leastSureFirst } from '../../src/engine/batch';
import type { BatchRow } from '../../src/engine/batch';
import { batchCSV, batchGeoJSON } from '../../src/io/batch';
import type { FilePoint } from '../../src/io/points';
import { todayUrl } from '../../src/data/today';
import { waitFor } from '../../src/data/pace';

describe('points from a file', () => {
  it('a CSV keeps its name column and every other column, quoted fields and all', () => {
    const f = readCSV(
      'site,latitude,longitude,notes\nGallery,37.74856,-119.58683,"village, by the store"\nMeadow,37.745,-119.589,',
    );
    expect(f.kind).toBe('either');
    expect(f.cols).toEqual(['notes']);
    expect(f.pts).toEqual([
      { lat: 37.74856, lon: -119.58683, name: 'Gallery', props: { notes: 'village, by the store' } },
      { lat: 37.745, lon: -119.589, name: 'Meadow', props: {} },
    ]);
  });
  it('a CSV reads semicolons and tabs, columns in either order, and skips rows it can’t place', () => {
    expect(readCSV('lon;lat\n-119.58;37.74\nx;y\n-119.581;37.741').pts.map(p => [p.lat, p.lon])).toEqual([
      [37.74, -119.58],
      [37.741, -119.581],
    ]);
    expect(readCSV('id\tlat\tlng\nA\t51.5\t-0.16').pts[0]).toMatchObject({
      name: 'A',
      lat: 51.5,
      lon: -0.16,
    });
    expect(splitCSV('"a ""b""",c', ',')).toEqual(['a "b"', 'c']);
  });
  it('a CSV with no header takes one coordinate per line, in any format the paste box takes', () => {
    expect(readCSV('37.7486, -119.5868\n37°44\'40"N 119°35\'20"W').pts).toHaveLength(2);
  });
  it('GeoJSON points are separate points with their properties; a line is a line', () => {
    const pts = readGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.1657, 51.5073] },
          properties: { name: 'Hyde Park', kind: 'park', n: 3 },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'MultiPoint',
            coordinates: [
              [1, 2],
              [3, 4],
            ],
          },
          properties: { id: 'P' },
        },
      ],
    });
    expect(pts.kind).toBe('points');
    expect(pts.cols).toEqual(['kind', 'n']);
    expect(pts.pts.map(p => p.name)).toEqual(['Hyde Park', 'P 1', 'P 2']);
    expect(pts.pts[0].props).toEqual({ kind: 'park', n: '3' });
    const line = readGeoJSON({
      type: 'LineString',
      coordinates: [
        [-119.58, 37.74],
        [-119.59, 37.745],
      ],
    } as never);
    expect(line.kind).toBe('line');
    expect(line.pts).toHaveLength(2);
  });
});

describe('grouping and order', () => {
  /* three clusters far apart, shuffled, and one lone point */
  const near = (lat: number, lon: number, n: number) =>
    Array.from({ length: n }, (_, k) => ({
      lat: lat + (k % 7) * 0.003,
      lon: lon + Math.floor(k / 7) * 0.003,
    }));
  const pts = [
    ...near(37.74, -119.59, 55),
    ...near(51.5, -0.16, 12),
    ...near(-33.9, 151.2, 30),
    { lat: 0, lon: 0 },
  ];
  for (let i = pts.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  const G = groupPoints(pts);
  it('every point is in exactly one group', () => {
    expect(G.flat().sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
  });
  it('no group passes 40 points or spreads wider than 0.2°', () => {
    for (const g of G) {
      expect(g.length).toBeLessThanOrEqual(BATCH.group);
      const la = g.map(i => pts[i].lat),
        lo = g.map(i => pts[i].lon);
      expect(Math.max(...la) - Math.min(...la)).toBeLessThanOrEqual(BATCH.span);
      expect(Math.max(...lo) - Math.min(...lo)).toBeLessThanOrEqual(BATCH.span);
    }
  });
  it('neighbours are read together: 98 points in 5 groups, not scattered', () => {
    expect(G).toHaveLength(5);
  });
  it('nearby points sit close along the Hilbert curve', () => {
    const a = hilbert({ lat: 37.74, lon: -119.59 }),
      b = hilbert({ lat: 37.741, lon: -119.591 }),
      c = hilbert({ lat: -33.9, lon: 151.2 });
    expect(Math.abs(a - b)).toBeLessThan(Math.abs(a - c));
  });
  it('the table puts the least sure first and points not read yet last', () => {
    const row = (p: number): BatchRow => ({
      call: 'grass',
      p,
      then: 'forest',
      pThen: 1 - p,
      src: 9,
      doubt: 0,
    });
    expect(leastSureFirst([row(0.9), null, row(0.4), row(0.6), null])).toEqual([2, 3, 0, 1, 4]);
  });
});

describe('exports', () => {
  const pts: FilePoint[] = [
      { lat: 37.74856, lon: -119.58683, name: 'Gallery', props: { notes: 'village, by the store' } },
      { lat: 37.745, lon: -119.589, name: 'Meadow "east"', props: {} },
    ],
    rows: (BatchRow | null)[] = [
      { call: 'building', p: 0.9412, then: 'grass', pThen: 0.031, src: 9, doubt: 0.12 },
      null,
    ];
  it('CSV: the file’s name and columns, then the answers, quoted where they need it', () => {
    expect(batchCSV(pts, rows, ['notes']).split('\n')).toEqual([
      'name,notes,lat,lon,call,p,then,p_then,sources,doubt',
      'Gallery,"village, by the store",37.74856,-119.58683,building,0.941,grass,0.031,9,0.12',
      '"Meadow ""east""",,37.745,-119.589,,,,,,',
      '',
    ]);
  });
  it('GeoJSON: a point feature each, properties carried, unread answers null', () => {
    const g = batchGeoJSON(pts, rows);
    expect(g.features).toHaveLength(2);
    expect(g.features[0].geometry.coordinates).toEqual([-119.58683, 37.74856]);
    expect(g.features[0].properties).toEqual({
      name: 'Gallery',
      notes: 'village, by the store',
      call: 'building',
      p: 0.941,
      then: 'grass',
      p_then: 0.031,
      sources: 9,
      doubt: 0.12,
    });
    expect(g.features[1].properties.call).toBeNull();
  });
});

describe('weather for many squares at once', () => {
  it('one request carries every square', () => {
    const u = todayUrl([
      { lat: 37.7486, lon: -119.5868 },
      { lat: 51.5073, lon: -0.1657 },
    ]);
    expect(u).toContain('latitude=37.75,51.51');
    expect(u).toContain('longitude=-119.59,-0.17');
    expect(todayUrl({ lat: 37.7486, lon: -119.5868 })).toBe(todayUrl([{ lat: 37.7486, lon: -119.5868 }]));
  });
});

describe('pacing Open-Meteo', () => {
  it('a request goes at once while the minute has room, and waits for the oldest calls to age out when it hasn’t', () => {
    const now = 1e9;
    expect(waitFor(40, now, [[now - 30e3, 400]])).toBe(0);
    /* 480 used in the last minute: 40 more must wait until the 400 from 30 s ago are a minute old */
    expect(
      waitFor(40, now, [
        [now - 30e3, 400],
        [now - 5e3, 80],
      ]),
    ).toBe(30e3 + 50);
    /* the hour's margin holds too: 4,480 over the hour, none in the last minute */
    expect(waitFor(40, now, [[now - 3000e3, 4480]])).toBe(600e3 + 50);
  });
});
