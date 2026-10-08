// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Imagery: basemap tile sources, a tile cache, pixel rasters for the classifier,
 * Esri's no-imagery placeholder test, and per-photo metadata (date, resolution).
 */
import { merc } from '../core/geo';
import { DAY, cachedFetch, jget } from './http';

/* ---------------------------------------------------------------- tiles */
export const TILE_SRC = {
  sat: {
    u: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    max: 19,
    at: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  dark: {
    u: (z, x, y) => `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
    max: 20,
    at: '© <a href="https://carto.com/attributions">CARTO</a>',
  },
  topo: {
    u: (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
    max: 17,
    at: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
};
/* failed tiles are retried after a pause instead of being remembered as
   holes forever (a v2 bug: one dropped request left a permanent gap) */
export const _tiles = new Map();
export function loadTile(src, z, x, y) {
  const n = 1 << z;
  if (y < 0 || y >= n) return { im: null, p: Promise.resolve(null) };
  x = ((x % n) + n) % n;
  const key = `${src}/${z}/${x}/${y}`;
  const hit = _tiles.get(key);
  if (hit && !(hit.fail && Date.now() - hit.fail > 15000)) return hit;
  const ent = { im: null, fail: 0, p: null };
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
export async function imageryRaster(lat, lon, halfPx, zs = [18, 17, 16]) {
  for (const z of zs) {
    const gx = merc.x(lon, z) * 256,
      gy = merc.y(lat, z) * 256;
    const x0 = Math.round(gx - halfPx),
      y0 = Math.round(gy - halfPx),
      W = halfPx * 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = W;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W - 1) / 256); tx++)
      for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + W - 1) / 256); ty++)
        jobs.push(loadTile('sat', z, tx, ty).p.then(im => ({ im, tx, ty })));
    const got = await Promise.all(jobs);
    if (got.some(t => !t.im)) continue;
    for (const t of got) g.drawImage(t.im, t.tx * 256 - x0, t.ty * 256 - y0);
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
export function isNoDataPlate(img) {
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
/* acquisition date, resolution and stated accuracy of the photo under a point */
export function imageryMeta(lat, lon) {
  const q = 0.01,
    la = (Math.round(lat / q) * q).toFixed(2),
    lo = (Math.round(lon / q) * q).toFixed(2);
  return cachedFetch(`imeta:${la}:${lo}`, 30 * DAY, async () => {
    const u =
      'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify' +
      `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1` +
      `&mapExtent=${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}&imageDisplay=400,400,96&returnGeometry=false&f=json`;
    const j = await jget(u, { timeout: 15000 });
    for (const r of j.results || []) {
      const a = r.attributes || {};
      const lo_ = +a.MinMapLevel || 0,
        hi_ = +a.MaxMapLevel || 0,
        d = String(a['DATE (YYYYMMDD)'] || '');
      if (lo_ <= 18 && 18 <= hi_ && /^\d{8}$/.test(d))
        return {
          date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          res: parseFloat(a['RESOLUTION (M)']) || null,
          acc: parseFloat(a['ACCURACY (M)']) || null,
          src: a.SOURCE_INFO || a.SOURCE || null,
        };
    }
    return { date: null };
  });
}
