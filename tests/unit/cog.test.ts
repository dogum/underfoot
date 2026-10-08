/// <reference types="node" />
/* Reading pixels from a cloud-optimised GeoTIFF (data/cog): a 7 × 6 image in
 * 4 × 4 tiles, DEFLATE with the horizontal predictor like Sentinel-2's scene
 * classes, built here byte by byte and served by range requests. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { decodeTile, parseHeader, pixels } from '../../src/data/cog';
import { buildTiff as tiff } from './tiff';

const W = 7,
  H = 6,
  T = 4;
const value = (c: number, r: number) => (r * 16 + c * 3 + 1) & 255;
const buildTiff = (predictor: number) => tiff(W, H, T, value, predictor);

describe('a tiled, compressed GeoTIFF', () => {
  const tif = buildTiff(2);
  it('reads its size, tiles and compression from the header', () => {
    const h = parseHeader(tif.buffer as ArrayBuffer);
    expect(h).toMatchObject({ width: 7, height: 6, tileW: 4, tileH: 4, compression: 8, predictor: 2 });
    expect('offsets' in h && h.offsets).toHaveLength(4);
  });
  it('asks for more bytes when the header is cut short', () => {
    expect(parseHeader(tif.slice(0, 20).buffer as ArrayBuffer)).toEqual({ need: expect.any(Number) });
  });
  it('inflates a tile and undoes the predictor', async () => {
    const h = parseHeader(tif.buffer as ArrayBuffer) as Exclude<
      ReturnType<typeof parseHeader>,
      { need: number }
    >;
    const t = await decodeTile(tif.slice(h.offsets[3], h.offsets[3] + h.counts[3]), h);
    expect(t[1 * 4 + 2]).toBe(value(6, 5));
  });
});

describe('pixels by range request', () => {
  const tif = buildTiff(2),
    orig = globalThis.fetch,
    asked: string[] = [];
  beforeAll(() => {
    globalThis.fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range)!;
      asked.push(init.headers.Range);
      const part = tif.slice(+a, +b + 1);
      return { ok: true, status: 206, arrayBuffer: async () => part.buffer } as unknown as Response;
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = orig;
  });
  it('reads every pixel right, in every tile, and nothing outside', async () => {
    const at = [] as { col: number; row: number }[];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) at.push({ col: c, row: r });
    const got = await pixels('https://example.test/scl.tif', [
      ...at,
      { col: 7, row: 0 },
      { col: -1, row: 2 },
    ]);
    expect(got.slice(0, -2)).toEqual(at.map(p => value(p.col, p.row)));
    expect(got.slice(-2)).toEqual([null, null]);
  });
  it('asks for the header once and each tile once', () => {
    expect(asked.filter(a => a.startsWith('bytes=0-'))).toHaveLength(1);
    expect(asked).toHaveLength(1 + 4);
  });
});
