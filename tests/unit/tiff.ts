/// <reference types="node" />
/* A tiled, DEFLATE-compressed, 8-bit GeoTIFF built byte by byte, as
 * Sentinel-2's scene classes are stored, for the reader's tests. */
import { deflateSync } from 'node:zlib';

/** a little-endian TIFF: header, one IFD, tile tables, then the tiles */
export function buildTiff(
  W: number,
  H: number,
  T: number,
  value: (col: number, row: number) => number,
  predictor = 2,
): Uint8Array {
  const tiles: Uint8Array[] = [];
  for (let tr = 0; tr < Math.ceil(H / T); tr++)
    for (let tc = 0; tc < Math.ceil(W / T); tc++) {
      const px = new Uint8Array(T * T);
      for (let r = 0; r < T; r++)
        for (let c = 0; c < T; c++) {
          const x = tc * T + c,
            y = tr * T + r;
          px[r * T + c] = x < W && y < H ? value(x, y) : 0;
        }
      if (predictor === 2)
        for (let r = 0; r < T; r++)
          for (let c = T - 1; c > 0; c--) px[r * T + c] = (px[r * T + c] - px[r * T + c - 1]) & 255;
      tiles.push(new Uint8Array(deflateSync(px)));
    }
  const tags: [number, number, number[]][] = [
    [256, 3, [W]],
    [257, 3, [H]],
    [258, 3, [8]],
    [259, 3, [8]],
    [277, 3, [1]],
    [317, 3, [predictor]],
    [322, 3, [T]],
    [323, 3, [T]],
    [324, 4, tiles.map(() => 0)],
    [325, 4, tiles.map(t => t.length)],
  ];
  const ifd = 8,
    tablesAt = ifd + 2 + 12 * tags.length + 4,
    dataAt = tablesAt + 8 * tiles.length;
  const offsets: number[] = [];
  tiles.reduce((o, t) => (offsets.push(o), o + t.length), dataAt);
  tags[8][2] = offsets;
  const size = dataAt + tiles.reduce((s, t) => s + t.length, 0),
    buf = new Uint8Array(size),
    v = new DataView(buf.buffer);
  buf.set([0x49, 0x49]);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifd, true);
  v.setUint16(ifd, tags.length, true);
  let table = tablesAt;
  tags.forEach(([tag, type, vals], i) => {
    const e = ifd + 2 + 12 * i;
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, vals.length, true);
    if (vals.length === 1) type === 3 ? v.setUint16(e + 8, vals[0], true) : v.setUint32(e + 8, vals[0], true);
    else {
      v.setUint32(e + 8, table, true);
      vals.forEach((x, k) => v.setUint32(table + 4 * k, x, true));
      table += 4 * vals.length;
    }
  });
  let o = dataAt;
  for (const t of tiles) (buf.set(t, o), (o += t.length));
  return buf;
}

/** a fetch that serves byte ranges of named files, and JSON for anything else */
export function rangeFetch(
  files: Record<string, Uint8Array>,
  json: (url: string, body: string) => unknown,
  asked: string[] = [],
) {
  return (async (url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    const r = init.headers?.Range;
    asked.push(r ? `${url} ${r}` : url);
    if (r && files[url]) {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(r)!,
        part = files[url].slice(+a, +b + 1);
      return { ok: true, status: 206, arrayBuffer: async () => part.buffer } as unknown as Response;
    }
    const j = json(url, init.body || '');
    return { ok: j != null, status: j != null ? 200 : 404, json: async () => j } as unknown as Response;
  }) as unknown as typeof fetch;
}
