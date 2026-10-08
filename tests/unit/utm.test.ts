/* Latitude and longitude to UTM (core/utm), against values from the textbooks. */
import { describe, it, expect } from 'vitest';
import { toUTM, zoneOf } from '../../src/core/utm';

describe('UTM', () => {
  it('on the equator at a central meridian is 500 000 E, 0 N', () => {
    const p = toUTM(0, -117, 11);
    expect(p.x).toBeCloseTo(500000, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
  it('40°N on the central meridian is 4 427 757 m north (0.9996 of the meridian arc)', () => {
    expect(toUTM(40, -117, 11).y).toBeCloseTo(4427757.2, 0);
  });
  it('the southern hemisphere starts 10 000 km north', () => {
    expect(toUTM(-1e-9, -117, 11).y).toBeCloseTo(10000000, 2);
  });
  it('Yosemite Valley in zone 11, as the Sentinel-2 tile 11SKB reads it', () => {
    const p = toUTM(37.745046, -119.589358, 11);
    expect(p.x).toBeGreaterThan(199980);
    expect(p.x).toBeLessThan(199980 + 5490 * 20);
    expect(p.y).toBeLessThan(4200000);
    expect(p.y).toBeGreaterThan(4200000 - 5490 * 20);
  });
  it('reads zones from EPSG codes', () => {
    expect(zoneOf(32611)).toEqual({ zone: 11, south: false });
    expect(zoneOf(32756)).toEqual({ zone: 56, south: true });
    expect(zoneOf(4326)).toBeNull();
  });
});
