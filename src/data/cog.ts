/**
 * Pixels from a cloud-optimised GeoTIFF by HTTP range requests: the header
 * (the first image's tags and tile tables) once per file, then only the tiles
 * the points fall in. Enough of TIFF for Sentinel-2's scene classes: classic
 * TIFF either byte order, one 8-bit band, tiled, stored raw or DEFLATE, with
 * or without the horizontal predictor. The browser decompresses
 * (DecompressionStream), so there's nothing to bundle.
 */
import { jget } from './http';

export interface CogHeader {
  width: number;
  height: number;
  tileW: number;
  tileH: number;
  offsets: number[];
  counts: number[];
  compression: number;
  predictor: number;
}

/** the first image's header, or how many bytes are needed when `buf` stops short of it */
export function parseHeader(buf: ArrayBuffer): CogHeader | { need: number } {
  const v = new DataView(buf),
    order = String.fromCharCode(v.getUint8(0), v.getUint8(1));
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF');
  const le = order === 'II';
  if (v.getUint16(2, le) !== 42) throw new Error('only classic TIFF is read');
  const ifd = v.getUint32(4, le);
  if (ifd + 2 > buf.byteLength) return { need: ifd + 2 + 12 * 64 };
  const n = v.getUint16(ifd, le);
  if (ifd + 2 + 12 * n > buf.byteLength) return { need: ifd + 2 + 12 * n };
  const tags = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + 12 * i,
      type = v.getUint16(e + 2, le),
      count = v.getUint32(e + 4, le),
      size = type === 3 ? 2 : 4;
    tags.set(v.getUint16(e, le), { type, count, at: count * size <= 4 ? e + 8 : v.getUint32(e + 8, le) });
  }
  let need = 0;
  const values = (tag: number): number[] => {
    const t = tags.get(tag);
    if (!t) return [];
    const size = t.type === 3 ? 2 : 4;
    if (t.at + t.count * size > buf.byteLength) {
      need = Math.max(need, t.at + t.count * size);
      return [];
    }
    return Array.from({ length: t.count }, (_, k) =>
      size === 2 ? v.getUint16(t.at + 2 * k, le) : v.getUint32(t.at + 4 * k, le),
    );
  };
  const one = (tag: number, dflt: number) => values(tag)[0] ?? dflt;
  const h: CogHeader = {
    width: one(256, 0),
    height: one(257, 0),
    tileW: one(322, 0),
    tileH: one(323, 0),
    offsets: values(324),
    counts: values(325),
    compression: one(259, 1),
    predictor: one(317, 1),
  };
  if (need) return { need };
  if (!h.tileW || !h.tileH || !h.offsets.length) throw new Error('not a tiled TIFF');
  if (one(258, 8) !== 8 || one(277, 1) !== 1) throw new Error('only one 8-bit band is read');
  if (![1, 8, 32946].includes(h.compression)) throw new Error(`compression ${h.compression} isn't read`);
  return h;
}

/** a tile's pixels, row by row: inflated, and the horizontal predictor undone */
export async function decodeTile(bytes: Uint8Array, h: CogHeader): Promise<Uint8Array> {
  let px = bytes;
  if (h.compression !== 1) {
    const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
    px = new Uint8Array(await new Response(s).arrayBuffer());
  }
  if (h.predictor === 2)
    for (let r = 0; r < h.tileH; r++)
      for (let c = 1, o = r * h.tileW; c < h.tileW; c++) px[o + c] = (px[o + c] + px[o + c - 1]) & 255;
  return px;
}

const range = async (url: string, from: number, to: number) =>
  new Uint8Array(
    (await jget(url, {
      headers: { Range: `bytes=${from}-${to}` },
      as: 'buf',
      timeout: 12000,
    })) as ArrayBuffer,
  );

/* a session's worth of headers and tiles; a scene never changes */
const HEADERS = new Map<string, Promise<CogHeader>>(),
  TILES = new Map<string, Promise<Uint8Array>>();
export function header(url: string): Promise<CogHeader> {
  let p = HEADERS.get(url);
  if (!p) {
    p = (async () => {
      let size = 16384;
      for (let tries = 0; tries < 3; tries++) {
        const h = parseHeader((await range(url, 0, size - 1)).buffer as ArrayBuffer);
        if (!('need' in h)) return h;
        size = h.need;
      }
      throw new Error('TIFF header too long');
    })();
    p.catch(() => HEADERS.delete(url));
    HEADERS.set(url, p);
  }
  return p;
}
function tile(url: string, h: CogHeader, i: number): Promise<Uint8Array> {
  const key = url + '#' + i;
  let p = TILES.get(key);
  if (!p) {
    p = range(url, h.offsets[i], h.offsets[i] + h.counts[i] - 1).then(b => decodeTile(b, h));
    p.catch(() => TILES.delete(key));
    TILES.set(key, p);
    if (TILES.size > 48) TILES.delete(TILES.keys().next().value!);
  }
  return p;
}

/** the value at each pixel (column, row), null outside the image; points in one tile share a request */
export async function pixels(url: string, at: { col: number; row: number }[]): Promise<(number | null)[]> {
  const h = await header(url),
    across = Math.ceil(h.width / h.tileW);
  return Promise.all(
    at.map(async ({ col, row }) => {
      if (col < 0 || row < 0 || col >= h.width || row >= h.height) return null;
      const t = await tile(url, h, Math.floor(row / h.tileH) * across + Math.floor(col / h.tileW));
      return t[(row % h.tileH) * h.tileW + (col % h.tileW)] ?? null;
    }),
  );
}
