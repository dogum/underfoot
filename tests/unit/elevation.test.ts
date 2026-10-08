/* 3DEP reports each sample's cell size in its raster's own units: metres for
 * the 1 m lidar, degrees for the 3 m and 10 m DEMs. The data layer hands the
 * engine metres either way. */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cellLabel, cellMetres, dep3 } from '../../src/data/elevation';

describe('cellMetres: 3DEP cell sizes in metres', () => {
  it('1 m lidar (UTM) stays as it is', () => expect(cellMetres(1)).toBe(1));
  it('1/3″ DEM, 0.0000926°, is about 10 m', () =>
    expect(cellMetres(0.00009259259341472414)).toBeCloseTo(10.31, 2));
  it('1/9″ DEM is about 3.4 m', () => expect(cellMetres(0.00003086419871794868)).toBeCloseTo(3.44, 2));
  it('1″ DEM is about 31 m', () => expect(cellMetres(1 / 3600)).toBeCloseTo(30.92, 2));
  it('a 90 m cell in metres stays as it is', () => expect(cellMetres(90)).toBe(90));
  it('missing or nonsense is null', () => {
    for (const v of [null, undefined, 0, -1, 'NoData', NaN]) expect(cellMetres(v)).toBeNull();
  });
  it('labels read the way the products are named', () => {
    expect([1, 3.44, 10.31, 30.92].map(cellLabel)).toEqual(['1', '3.4', '10', '31']);
  });
});

describe('dep3 stores metres', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('the Mist Trail (10 m DEM) and the Yosemite Valley floor (1 m lidar)', async () => {
    // getSamples replies captured on 2026-10-07; the request order is kept by locationId
    const reply = {
      samples: [
        { locationId: 1, value: '1222.687988281', rasterId: 33618, resolution: 1 },
        { locationId: 0, value: '1470.947387695', rasterId: 5607, resolution: 9.2592593414724135e-5 },
      ],
    };
    vi.stubGlobal('document', { querySelector: () => null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => reply })),
    );
    const out = await dep3([
      { lat: 37.7267, lon: -119.5444 },
      { lat: 37.7486, lon: -119.5868 },
    ]);
    expect(out[0]!.z).toBeCloseTo(1470.95, 2);
    expect(out[0]!.res).toBeCloseTo(10.31, 2);
    expect(out[1]).toEqual({ z: 1222.687988281, res: 1 });
  });
});
