/* The places-abroad fixture (scripts/validate-spots.mjs): well formed, so a
 * typo in a label can't quietly score as a miss. */
import { describe, it, expect } from 'vitest';
import FIX from '../fixtures/spots/abroad.json';
import { K } from '../../src/core/classes';

describe('places abroad', () => {
  const spots = FIX.spots;
  it('has 36 places, six per continent', () => {
    expect(spots).toHaveLength(36);
    const by = new Map<string, number>();
    for (const s of spots) by.set(s.region, (by.get(s.region) || 0) + 1);
    expect([...by.values()]).toEqual([6, 6, 6, 6, 6, 6]);
  });
  it('labels every place with known classes, best first, and no repeats', () => {
    for (const s of spots) {
      expect(s.truth.length).toBeGreaterThan(0);
      for (const t of s.truth) expect(K).toContain(t);
      expect(new Set(s.truth).size).toBe(s.truth.length);
    }
  });
  it('keeps every place outside the lower 48 and apart from the others', () => {
    const conus = (s: { lat: number; lon: number }) =>
      s.lat > 24.5 && s.lat < 49.4 && s.lon > -125 && s.lon < -66.9;
    for (const s of spots) expect(conus(s)).toBe(false);
    expect(new Set(spots.map(s => `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`)).size).toBe(36);
  });
});
