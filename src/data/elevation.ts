/**
 * Elevation: USGS 3DEP in the US (1 m lidar where it has been flown, a 3 m or
 * 10 m DEM elsewhere), Open-Meteo's ~90 m DEM outside it.
 */
import type { LatLon } from '../core/types';
import { jget, pool } from './http';

export interface DemSample {
  /** metres */
  z: number;
  /** DEM cell size in metres, when the service reports it */
  res: number | null;
}

/* getSamples reports each sample's cell size in its raster's own units and
   does not say which: metres for the 1 m lidar tiles (UTM), degrees for the
   1/9″, 1/3″ and 1″ DEMs (NAD83 geographic), so the 10 m DEM comes back as
   0.0000926. No DEM cell is under a centimetre or over a hundredth of a degree
   (1.1 km), so anything below 0.01 is degrees. Converted along the meridian,
   which gives the cell's north–south side, the longer one. */
export const M_PER_DEG = 111320;
export function cellMetres(res: unknown): number | null {
  const r = Number(res);
  if (!Number.isFinite(r) || r <= 0) return null;
  return r < 0.01 ? r * M_PER_DEG : r;
}
/** a cell size for the ledger: 1, 3.4, 10, 31 */
export const cellLabel = (m: number) => String(+m.toPrecision(2));

/* ------------------------------------------------------------ elevation */
/* USGS 3DEP getSamples takes a whole multipoint in one POST: bare-earth
   elevation for every rosette of every station, plus a dense profile, in one
   or two round trips. Outside the US, or where it has no data, Open-Meteo. */
export async function dep3(points: LatLon[]): Promise<(DemSample | null)[]> {
  const out: (DemSample | null)[] = new Array(points.length).fill(null);
  const chunks: number[] = [];
  for (let i = 0; i < points.length; i += 200) chunks.push(i);
  await pool(chunks, 3, async (i: number) => {
    const ch = points.slice(i, i + 200);
    const geom = JSON.stringify({
      points: ch.map(p => [+p.lon.toFixed(7), +p.lat.toFixed(7)]),
      spatialReference: { wkid: 4326 },
    });
    const body = new URLSearchParams({
      geometry: geom,
      geometryType: 'esriGeometryMultipoint',
      returnFirstValueOnly: 'true',
      interpolation: 'RSP_BilinearInterpolation',
      f: 'json',
    });
    const j = await jget(
      'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples',
      { method: 'POST', body, timeout: 25000 },
    );
    for (const s of j.samples || []) {
      const v = parseFloat(s.value);
      if (Number.isFinite(v) && v > -1000) out[i + s.locationId] = { z: v, res: cellMetres(s.resolution) };
    }
  });
  return out;
}
export async function openMeteo(points: LatLon[]): Promise<(number | null)[]> {
  const out: (number | null)[] = new Array(points.length).fill(null);
  const chunks: number[] = [];
  for (let i = 0; i < points.length; i += 40) chunks.push(i);
  await pool(chunks, 3, async (i: number) => {
    const ch = points.slice(i, i + 40);
    const u =
      'https://api.open-meteo.com/v1/elevation?latitude=' +
      ch.map(p => p.lat.toFixed(5)).join(',') +
      '&longitude=' +
      ch.map(p => p.lon.toFixed(5)).join(',');
    try {
      const j = await jget(u, { timeout: 16000 });
      (j.elevation || []).forEach((v: unknown, k: number) => {
        if (v != null && Number.isFinite(+v)) out[i + k] = +v;
      });
    } catch (e) {}
  });
  return out;
}
