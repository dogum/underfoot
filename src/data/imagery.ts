/**
 * Imagery: basemap tile sources, a tile cache, pixel rasters for the classifier,
 * Esri's no-imagery placeholder test, and per-photo metadata (date, resolution).
 */
import { merc } from '../core/geo';
import { DAY, cachedFetch, jget } from './http';

/* ---------------------------------------------------------------- tiles */
export interface TileSource {
  u: (z: number, x: number, y: number) => string;
  /** deepest zoom the source serves; past it the nearest tile is scaled */
  max: number;
  /** drawn at this opacity */
  dim?: number;
  at: string;
}
export type TileSrcKey = 'sat' | 'dark' | 'topo';
export const TILE_SRC: Record<TileSrcKey, TileSource> = {
  sat: {
    u: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    max: 19,
    at: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  /* Esri's Dark Gray Canvas: keyless, like the imagery. CARTO's dark tiles
     started asking for an API key in October 2026. The canvas is a lighter
     grey than the app's surface, so it's drawn dimmed (dim), and it stops at
     z16, past which the nearest tile is scaled. */
  dark: {
    u: (z, x, y) =>
      `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    max: 16,
    dim: 0.5,
    at: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors',
  },
  topo: {
    u: (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
    max: 17,
    at: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
};
export interface TileEntry {
  im: HTMLImageElement | null;
  /** when the last load failed (ms), 0 if it hasn't */
  fail: number;
  p: Promise<HTMLImageElement | null>;
}
/* failed tiles are retried after a pause instead of being remembered as
   holes forever (a v2 bug: one dropped request left a permanent gap) */
export const _tiles = new Map<string, TileEntry>();
export function loadTile(src: TileSrcKey, z: number, x: number, y: number): TileEntry {
  const n = 1 << z;
  if (y < 0 || y >= n) return { im: null, fail: 0, p: Promise.resolve(null) };
  x = ((x % n) + n) % n;
  const key = `${src}/${z}/${x}/${y}`;
  const hit = _tiles.get(key);
  if (hit && !(hit.fail && Date.now() - hit.fail > 15000)) return hit;
  const ent: TileEntry = { im: null, fail: 0, p: Promise.resolve(null) };
  ent.p = new Promise(res => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      ent.im = im;
      res(im);
    };
    im.onerror = () => {
      ent.fail = Date.now();
      res(null);
    };
    im.src = TILE_SRC[src].u(z, x, y);
  });
  _tiles.set(key, ent);
  if (_tiles.size > 1200) {
    let k = 0;
    for (const kk of _tiles.keys()) {
      _tiles.delete(kk);
      if (++k > 400) break;
    }
  }
  return ent;
}

/* ---- an imagery raster centred on a coordinate, read straight off Esri's
   CORS-open tiles. z18 is the calibration zoom; shallower only where Esri
   has no z18 imagery (it serves a flat light-grey plate there). ---- */
export interface ImageryRaster {
  data: ImageData;
  z: number;
  /** top-left corner in world pixels at zoom z */
  x0: number;
  y0: number;
  /** side in pixels */
  W: number;
  /** metres per pixel */
  mpp: number;
}
export async function imageryRaster(
  lat: number,
  lon: number,
  halfPx: number,
  zs = [18, 17, 16],
): Promise<ImageryRaster | null> {
  for (const z of zs) {
    const gx = merc.x(lon, z) * 256,
      gy = merc.y(lat, z) * 256;
    const x0 = Math.round(gx - halfPx),
      y0 = Math.round(gy - halfPx),
      W = halfPx * 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = W;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const jobs = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W - 1) / 256); tx++)
      for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + W - 1) / 256); ty++)
        jobs.push(loadTile('sat', z, tx, ty).p.then(im => ({ im, tx, ty })));
    const got = await Promise.all(jobs);
    if (got.some(t => !t.im)) continue;
    for (const t of got) g.drawImage(t.im!, t.tx * 256 - x0, t.ty * 256 - y0);
    const data = g.getImageData(0, 0, W, W);
    if (isNoDataPlate(data)) continue;
    return { data, z, x0, y0, W, mpp: merc.mpp(lat, z) };
  }
  return null;
}
/* Esri's "Map data not yet available" plate is neutral grey 204 with a line of
   lettering. The lettering defeats a plain flatness test (v2 accepted these
   plates as photographs), so look for the plate's own signature instead: most
   pixels exactly neutral and within a few levels of 204. */
export function isNoDataPlate(img: { data: Uint8ClampedArray }): boolean {
  const d = img.data;
  let n = 0,
    plate = 0;
  for (let i = 0; i < d.length; i += 12) {
    n++;
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    if (Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2 && Math.abs(r - 204) <= 4) plate++;
  }
  return plate / n > 0.8;
}

/* ------------------------------------------------------------ metadata */
export interface ImageryMeta {
  /** acquisition date, YYYY-MM-DD; null when Esri has no dated photo at z18 here */
  date: string | null;
  /** source resolution, metres per pixel */
  res?: number | null;
  /** stated horizontal accuracy in metres; null when unknown */
  acc?: number | null;
  /** who captured it, e.g. "Vivid Advanced" or "Salt Lake County 2024" */
  src?: string | null;
}
/* Esri writes 99999 for an accuracy nobody stated (county orthophotos, for
   one). Stated figures are centimetres to metres (0.29 m on Miami-Dade's
   orthophotos, 8.47 m on most Vantor captures), so anything from a kilometre
   up is the placeholder or a slip, and reads as unknown. */
export const MAX_STATED_ACC = 1000;
type Attrs = Record<string, unknown>;
/* Esri spells a missing attribute "Null" */
const text = (v: unknown) => {
  const s = v == null ? '' : String(v).trim();
  return s && s !== 'Null' ? s : null;
};
const positive = (v: unknown) => {
  const x = parseFloat(String(v));
  return Number.isFinite(x) && x > 0 ? x : null;
};
/** the z18 photo's date, resolution, accuracy and source from an identify reply */
export function parseImageryMeta(j: { results?: { attributes?: Attrs }[] }): ImageryMeta {
  for (const r of j.results || []) {
    const a = r.attributes || {};
    const lo = Number(a.MinMapLevel) || 0,
      hi = Number(a.MaxMapLevel) || 0,
      d = String(a['DATE (YYYYMMDD)'] || '');
    if (lo <= 18 && 18 <= hi && /^\d{8}$/.test(d)) {
      const acc = positive(a['ACCURACY (M)']);
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        res: positive(a['RESOLUTION (M)']),
        acc: acc != null && acc < MAX_STATED_ACC ? acc : null,
        /* county orthophoto names come with the year run on: "Salt Lake County2024" */
        src: (text(a.SOURCE_INFO) || text(a.SOURCE))?.replace(/(\p{L})((?:19|20)\d\d)$/u, '$1 $2') || null,
      };
    }
  }
  return { date: null };
}
/* acquisition date, resolution and stated accuracy of the photo under a point.
   imeta2: entries cached under imeta kept Esri's 99999 accuracy placeholder. */
export function imageryMeta(lat: number, lon: number): Promise<ImageryMeta> {
  const q = 0.01,
    la = (Math.round(lat / q) * q).toFixed(2),
    lo = (Math.round(lon / q) * q).toFixed(2);
  return cachedFetch(`imeta2:${la}:${lo}`, 30 * DAY, async () => {
    const u =
      'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify' +
      `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1` +
      `&mapExtent=${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}&imageDisplay=400,400,96&returnGeometry=false&f=json`;
    return parseImageryMeta(await jget(u, { timeout: 15000 }));
  });
}
