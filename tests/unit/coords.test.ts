import { describe, it, expect } from 'vitest';
import { parseLatLon, parseCoordText } from '../../src/io/coords';

const near = (p: { lat: number; lon: number } | null, lat: number, lon: number) => {
  expect(p).not.toBeNull();
  expect(p!.lat).toBeCloseTo(lat, 3);
  expect(p!.lon).toBeCloseTo(lon, 3);
};

describe('parseLatLon reads the ways people write coordinates', () => {
  it('decimal pair', () => near(parseLatLon('37.7486, -119.5868'), 37.7486, -119.5868));
  it('hemisphere after', () => near(parseLatLon('37.7486 N, 119.5868 W'), 37.7486, -119.5868));
  it('hemisphere before', () => near(parseLatLon('N 37.7486 W 119.5868'), 37.7486, -119.5868));
  it('hemisphere before, no spaces', () => near(parseLatLon('N37.7486, W119.5868'), 37.7486, -119.5868));
  it('southern / eastern', () => near(parseLatLon('S 33.8568 E 151.2153'), -33.8568, 151.2153));
  it('degrees minutes seconds', () => near(parseLatLon(`37°44'55.0"N 119°35'12.5"W`), 37.74861, -119.58681));
  it('DMS, hemisphere first', () => near(parseLatLon(`S33°51'24" E151°12'55"`), -33.85667, 151.21528));
  it('DMS with spaces only', () => near(parseLatLon('37 44 55.0 N 119 35 12.5 W'), 37.74861, -119.58681));
  it('signed decimals', () => near(parseLatLon('-33.8568 151.2153'), -33.8568, 151.2153));
  it('a tabbed row with elevation', () => near(parseLatLon('37.7486\t-119.5868\t1222'), 37.7486, -119.5868));
  it('a row with a timestamp', () => near(parseLatLon('37.74,-119.59,2026-01-01T10:00:00Z'), 37.74, -119.59));
  it('a labelled row', () =>
    near(parseLatLon('gallery 37.7486 -119.5868 12.5 2026-01-01'), 37.7486, -119.5868));
  it('rejects text', () => expect(parseLatLon('garbage')).toBeNull());
  it('rejects out-of-range values', () => expect(parseLatLon('95.1, 200.2')).toBeNull());
  it('splits a pasted list, skipping comments and blanks', () => {
    expect(parseCoordText('# my walk\n37.74,-119.59\n\n37.75,-119.58; 37.76,-119.57')).toHaveLength(3);
  });
});
