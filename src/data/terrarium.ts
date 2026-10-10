/**
 * Elevation outside the US from AWS's Terrain Tiles (Mapzen's terrarium
 * encoding, keyless and CORS-open on S3): elevation = R × 256 + G + B / 256 −
 * 32768 metres. Outside the US they're mostly SRTM at 30 m. One tile at z13
 * covers about 5 km, so the stations of a line or a batch group that sit
 * together share a tile, where Open-Meteo's free tier counted every sample.
 *
 * Over open ocean a tile reads sea level, or the depth from ETOPO1, or sea
 * level with a seam of stray values; values deeper than any sea read as sea
 * level, and a rosette that spreads wider than terrain can is read as no
 * reading at all (rosetteOk), so the station falls back to Open-Meteo.
 */
import { merc } from '../core/geo';
import type { LatLon } from '../core/types';
import { DAY, cachedFetch, jget, pool } from './http';

export const DEM_Z = 13;
export const terrariumUrl = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** the deepest sea is under 11 km: below that a tile's value is a seam over open ocean */
const DEEPEST = -11000;
/** metres from a terrarium pixel's red, green and blue */
export function decode(r: number, g: number, b: number): number {
  const z = r * 256 + g + b / 256 - 32768;
  return z < DEEPEST ? 0 : z;
}
/** the elevation at fractional pixel (fx, fy) of a 256 px tile's RGBA, bilinear, clamped to the tile (pure) */
export function sampleTile(d: ArrayLike<number>, fx: number, fy: number): number {
  const x = Math.min(255, Math.max(0, fx - 0.5)),
    y = Math.min(255, Math.max(0, fy - 0.5)),
    x0 = Math.min(254, Math.floor(x)),
    y0 = Math.min(254, Math.floor(y)),
    tx = x - x0,
    ty = y - y0;
  const at = (i: number, j: number) => {
    const p = (j * 256 + i) * 4;
    return decode(d[p], d[p + 1], d[p + 2]);
  };
  return (
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x0 + 1, y0) * tx * (1 - ty) +
    at(x0, y0 + 1) * (1 - tx) * ty +
    at(x0 + 1, y0 + 1) * tx * ty
  );
}

/** a rosette's elevations could be real terrain: all there, and within 300 m of each other across 60 m */
export const rosetteOk = (z: (number | null)[]) =>
  z.every(v => v != null) && Math.max(...(z as number[])) - Math.min(...(z as number[])) <= 300;
/** open sea: sea level all round, or deeper than the lowest land on Earth (the Dead Sea's shore, −430 m) */
export const openSea = (z: number[]) => z.every(v => v === 0) || z.every(v => v <= -500);

/* decoded tiles, a few dozen at a time (a 256 px tile's pixels are 256 KB) */
const tiles = new Map<string, Promise<Uint8ClampedArray | null>>();
function tile(z: number, x: number, y: number): Promise<Uint8ClampedArray | null> {
  const k = `${z}/${x}/${y}`;
  const hit = tiles.get(k);
  if (hit) return hit;
  const p = (async () => {
    try {
      /* the PNG is kept in this browser for 90 days: tiles change only when the dataset does */
      const buf = (await cachedFetch(`dem:${k}`, 90 * DAY, () =>
        jget(terrariumUrl(z, x, y), { as: 'buf', timeout: 15000 }),
      )) as ArrayBuffer;
      /* no colour management: the pixels are numbers, not colours */
      const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }), {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, 256, 256).data;
    } catch {
      tiles.delete(k);
      return null;
    }
  })();
  tiles.set(k, p);
  if (tiles.size > 48) tiles.delete(tiles.keys().next().value!);
  return p;
}

/** the elevation at each point, null where its tile couldn't be read */
export async function tileElevations(points: LatLon[], z = DEM_Z): Promise<(number | null)[]> {
  const at = points.map(p => {
      const X = merc.x(p.lon, z),
        Y = merc.y(p.lat, z),
        x = Math.floor(X),
        y = Math.floor(Y);
      return { x, y, fx: (X - x) * 256, fy: (Y - y) * 256 };
    }),
    keys = [...new Set(at.map(a => `${a.x}/${a.y}`))];
  const got = new Map<string, Uint8ClampedArray | null>();
  await pool(keys, 4, async (k: string) => {
    const [x, y] = k.split('/').map(Number);
    got.set(k, await tile(z, x, y));
  });
  return at.map(a => {
    const d = got.get(`${a.x}/${a.y}`);
    return d ? sampleTile(d, a.fx, a.fy) : null;
  });
}
