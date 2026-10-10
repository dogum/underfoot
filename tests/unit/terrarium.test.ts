/* Elevation from AWS's Terrain Tiles (data/terrarium): the terrarium decoding,
 * sampling between pixels, and the two checks on a rosette read from them. */
import { describe, it, expect } from 'vitest';
import { decode, openSea, rosetteOk, sampleTile } from '../../src/data/terrarium';

/** a 256 px RGBA tile whose elevation is f(column, row) */
function tileOf(f: (i: number, j: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(256 * 256 * 4);
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 256; i++) {
      const v = f(i, j) + 32768,
        p = (j * 256 + i) * 4;
      d[p] = Math.floor(v / 256);
      d[p + 1] = Math.floor(v % 256);
      d[p + 2] = Math.round((v - Math.floor(v)) * 256);
      d[p + 3] = 255;
    }
  return d;
}

describe('terrain tiles', () => {
  it('decodes terrarium pixels: red × 256 + green + blue / 256 − 32768', () => {
    expect(decode(138, 157, 51)).toBeCloseTo(2717.2, 1);
    expect(decode(128, 0, 0)).toBe(0);
    expect(decode(127, 250, 0)).toBe(-6);
  });
  it('a value deeper than any sea is a seam over open ocean, and reads as sea level', () => {
    expect(decode(70, 0, 0)).toBe(0);
  });
  it('samples between pixel centres, and holds the edge pixel at the tile’s edge', () => {
    const d = tileOf((i, j) => i * 2 + j * 0.5);
    expect(sampleTile(d, 10.5, 20.5)).toBeCloseTo(30, 6);
    expect(sampleTile(d, 11, 20.5)).toBeCloseTo(31, 6);
    expect(sampleTile(d, 10.5, 21)).toBeCloseTo(30.25, 6);
    expect(sampleTile(d, 0, 0)).toBeCloseTo(0, 6);
    expect(sampleTile(d, 256, 256)).toBeCloseTo(255 * 2 + 255 * 0.5, 6);
  });
  it('a rosette is terrain only if it is all there and no wider than 300 m', () => {
    expect(rosetteOk([1200, 1190, 1210, 1205, 1195, 1200, 1201, 1199, 1203])).toBe(true);
    expect(rosetteOk([0, 0, 0, -5992, 0, 0, 0, 0, 0])).toBe(false);
    expect(rosetteOk([0, 0, null, 0, 0, 0, 0, 0, 0])).toBe(false);
  });
  it('open sea is sea level all round or deeper than any land; a polder or the Dead Sea shore is not', () => {
    expect(openSea(new Array(9).fill(0))).toBe(true);
    expect(openSea(new Array(9).fill(-4300))).toBe(true);
    expect(openSea(new Array(9).fill(-5.7))).toBe(false);
    expect(openSea(new Array(9).fill(-412))).toBe(false);
    expect(openSea([0, 0, 0, 0, 0, 0, 0, 0, 0.4])).toBe(false);
  });
});
