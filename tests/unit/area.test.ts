/* Area mode (engine/area): the outline's area, which tiles cover it, and its
 * acres summed from the tiles' cells, always to the outline's own area. */
import { describe, it, expect } from 'vitest';
import { CIX, K } from '../../src/core/classes';
import { TILE, inRing, ringArea, sumArea, tileCentres } from '../../src/engine/area';
import { FIELD_N } from '../../src/engine/field';
import type { FieldMap } from '../../src/engine/field';
import type { ClassKey } from '../../src/core/types';

type XY = [number, number];
const rect = (w: number, h: number): XY[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];
/** a tile whose every cell says the same thing */
const tile = (mix: Partial<Record<ClassKey, number>>): FieldMap => {
  const probs = new Float32Array(FIELD_N * FIELD_N * K.length);
  for (let k = 0; k < FIELD_N * FIELD_N; k++)
    for (const [c, v] of Object.entries(mix)) probs[k * K.length + CIX[c as ClassKey]] = v;
  return { N: FIELD_N, qs: [], probs };
};

describe('the outline', () => {
  it('measures its area either way round', () => {
    expect(ringArea(rect(100, 50))).toBe(5000);
    expect(ringArea(rect(100, 50).reverse())).toBe(5000);
  });
  it('knows what is inside it', () => {
    expect(inRing(50, 25, rect(100, 50))).toBe(true);
    expect(inRing(150, 25, rect(100, 50))).toBe(false);
  });
});

describe('the tiles', () => {
  it('one tile for a small lot, a grid for a larger one', () => {
    expect(tileCentres(rect(100, 100))).toEqual([[TILE / 2, TILE / 2]]);
    expect(tileCentres(rect(250, 130))).toHaveLength(6);
  });
  it('skips a tile the outline never reaches', () => {
    const L: XY[] = [
      [0, 0],
      [240, 0],
      [240, 100],
      [100, 100],
      [100, 240],
      [0, 240],
    ];
    const c = tileCentres(L);
    expect(c).toHaveLength(3);
    expect(c).not.toContainEqual([180, 180]);
  });
  it('keeps a tile a thin diagonal crosses, though no corner of either is inside the other', () => {
    const sliver: XY[] = [
      [0, 0],
      [400, 230],
      [402, 226],
    ];
    expect(tileCentres(sliver).length).toBeGreaterThanOrEqual(4);
  });
});

describe('the sums', () => {
  const lot = rect(200, 110);
  const centres = tileCentres(lot);
  it('add up to the outline exactly, by probability and by call', () => {
    const s = sumArea(
      lot,
      centres,
      centres.map(() => tile({ grass: 0.6, forest: 0.4 })),
    );
    expect(s.m2).toBe(22000);
    expect(s.byClass.reduce((a, v) => a + v, 0)).toBeCloseTo(22000, 6);
    expect(s.byClass[CIX.grass]).toBeCloseTo(13200, 2);
    expect(s.mosaic[CIX.grass]).toBeCloseTo(22000, 6);
    /* the cells alone come within a cell's width of the outline */
    expect(Math.abs(s.cells * 4 - 22000) / 22000).toBeLessThan(0.01);
  });
  it('counts only the tiles read so far, and says how many cells are still to come', () => {
    const tiles: (FieldMap | null)[] = centres.map((_, i) => (i === 0 ? tile({ water: 1 }) : null));
    const s = sumArea(lot, centres, tiles);
    expect(s.cells).toBeLessThan(s.expectedCells);
    expect(s.byClass[CIX.water]).toBeCloseTo(22000, 6);
  });
});
