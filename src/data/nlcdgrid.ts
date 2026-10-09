/**
 * NLCD around a station, pixel by pixel (M5): the four rasters the app reads
 * one pixel at a time for a sounding (data/nlcd), read for a whole field map
 * instead, so each 2 m cell takes the land cover, canopy, imperviousness and
 * descriptor under it rather than the station's. MRLC's web coverage service
 * returns every pixel in a box in one small request per raster, keyless and
 * CORS-open, in latitude and longitude. Cached for 60 days, like the pixel.
 */
import { DAY, cachedFetch, jget } from './http';
import { rasterAt, rasterOf } from './cog';
import type { Raster } from './cog';
import { IMPD_NAME, NLCD_NAME } from './nlcd';

export const WCS_URL = 'https://www.mrlc.gov/geoserver/mrlc_display/ows';
export const GRID_LAYERS = {
  code: 'NLCD_2021_Land_Cover_L48',
  canopy: 'nlcd_tcc_conus_2021_v2021-4',
  imperv: 'NLCD_2021_Impervious_L48',
  desc: 'NLCD_2021_Impervious_descriptor_L48',
} as const;
export type NlcdGrids = Record<keyof typeof GRID_LAYERS, Raster | null>;

const EPSG4326 = 'http://www.opengis.net/def/crs/EPSG/0/4326';
export const gridUrl = (layer: string, w: number, s: number, e: number, n: number) =>
  `${WCS_URL}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=mrlc_display__${layer}` +
  `&subset=Long(${w.toFixed(6)},${e.toFixed(6)})&subset=Lat(${s.toFixed(6)},${n.toFixed(6)})` +
  `&subsettingCrs=${EPSG4326}&outputCrs=${EPSG4326}&format=image/tiff`;

/** the four rasters over a box `half` metres either side of a point; a raster that can't be read is null */
export async function nlcdGrids(lat: number, lon: number, half: number): Promise<NlcdGrids> {
  const dy = half / 111320,
    dx = half / (111320 * Math.cos((lat * Math.PI) / 180));
  const [w, s, e, n] = [lon - dx, lat - dy, lon + dx, lat + dy];
  const read = async (layer: string): Promise<Raster | null> => {
    try {
      return await cachedFetch(
        `nlcdgrid:${layer}:${lat.toFixed(4)},${lon.toFixed(4)},${half}`,
        60 * DAY,
        async () =>
          rasterOf((await jget(gridUrl(layer, w, s, e, n), { as: 'buf', timeout: 15000 })) as ArrayBuffer),
      );
    } catch {
      return null;
    }
  };
  const keys = Object.keys(GRID_LAYERS) as (keyof typeof GRID_LAYERS)[];
  const got = await Promise.all(keys.map(k => read(GRID_LAYERS[k])));
  return Object.fromEntries(keys.map((k, i) => [k, got[i]])) as NlcdGrids;
}

/** what the four rasters say at a point, as the station's NLCD facts read it (data/nlcd) */
export function nlcdAt(g: NlcdGrids, lat: number, lon: number) {
  const v = (r: Raster | null) => (r ? rasterAt(r, lon, lat) : null),
    pct = (x: number | null) => (x == null || x > 100 ? null : x),
    code = v(g.code),
    desc = v(g.desc);
  const c = code != null && (NLCD_NAME as Record<number, string>)[code] ? code : null,
    d = desc == null || desc > 29 ? null : desc;
  return {
    code: c,
    name: c == null ? null : (NLCD_NAME as Record<number, string>)[c],
    canopy: pct(v(g.canopy)),
    imperv: pct(v(g.imperv)),
    desc: d,
    descName: d == null ? null : ((IMPD_NAME as Record<number, string>)[d] ?? null),
  };
}
