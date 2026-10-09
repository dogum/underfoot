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
  /** where the pixels are, when the file says (GeoTIFF) */
  geo?: GeoTransform | null;
}
/** a pixel's position: x = x0 + (col + ½)·dx, y = y0 + (row + ½)·dy, in the file's CRS (dy < 0 for north-up) */
export interface GeoTransform {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}
const SIZE: Record<number, number> = { 1: 1, 3: 2, 4: 4, 12: 8 };

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
      size = SIZE[type] ?? 4;
    tags.set(v.getUint16(e, le), { type, count, at: count * size <= 4 ? e + 8 : v.getUint32(e + 8, le) });
  }
  let need = 0;
  const values = (tag: number): number[] => {
    const t = tags.get(tag);
    if (!t) return [];
    const size = SIZE[t.type] ?? 4;
    if (t.at + t.count * size > buf.byteLength) {
      need = Math.max(need, t.at + t.count * size);
      return [];
    }
    return Array.from({ length: t.count }, (_, k) =>
      t.type === 12
        ? v.getFloat64(t.at + 8 * k, le)
        : size === 2
          ? v.getUint16(t.at + 2 * k, le)
          : v.getUint32(t.at + 4 * k, le),
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
  /* GeoTIFF: a ModelTransformation, or a pixel scale and a tie point */
  const mt = values(34264),
    sc = values(33550),
    tp = values(33922);
  h.geo =
    mt.length >= 8
      ? { x0: mt[3], y0: mt[7], dx: mt[0], dy: mt[5] }
      : sc.length >= 2 && tp.length >= 6
        ? { x0: tp[3] - tp[0] * sc[0], y0: tp[4] + tp[1] * sc[1], dx: sc[0], dy: -sc[1] }
        : null;
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

/** a whole small GeoTIFF read at once (MRLC's web coverage service sends these): every pixel, row by row */
export interface Raster {
  width: number;
  height: number;
  px: Uint8Array;
  geo: GeoTransform | null;
}
export async function rasterOf(buf: ArrayBuffer): Promise<Raster> {
  const h = parseHeader(buf);
  if ('need' in h) throw new Error('TIFF cut short');
  const px = new Uint8Array(h.width * h.height),
    across = Math.ceil(h.width / h.tileW);
  for (let t = 0; t < h.offsets.length; t++) {
    const tile = await decodeTile(new Uint8Array(buf, h.offsets[t], h.counts[t]).slice(), h),
      c0 = (t % across) * h.tileW,
      r0 = Math.floor(t / across) * h.tileH;
    for (let r = 0; r < h.tileH && r0 + r < h.height; r++)
      for (let c = 0; c < h.tileW && c0 + c < h.width; c++)
        px[(r0 + r) * h.width + c0 + c] = tile[r * h.tileW + c];
  }
  return { width: h.width, height: h.height, px, geo: h.geo ?? null };
}
/** the pixel under a point in the raster's CRS, or null outside it */
export function rasterAt(r: Raster, x: number, y: number): number | null {
  if (!r.geo) return null;
  const col = Math.floor((x - r.geo.x0) / r.geo.dx),
    row = Math.floor((y - r.geo.y0) / r.geo.dy);
  return col < 0 || row < 0 || col >= r.width || row >= r.height ? null : r.px[row * r.width + col];
}
