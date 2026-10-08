// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Elevation: USGS 3DEP 1 m in the US, Open-Meteo's ~90 m DEM elsewhere.
 */
import { jget, pool } from './http';

/* ------------------------------------------------------------ elevation */
/* USGS 3DEP getSamples takes a whole multipoint in one POST — 1 m bare-earth
   elevation for every rosette of every station, plus a dense profile, in one
   or two round trips. Outside the US, or where it has no data, Open-Meteo. */
export async function dep3(points) {
  const out = new Array(points.length).fill(null);
  const chunks = [];
  for (let i = 0; i < points.length; i += 200) chunks.push(i);
  await pool(chunks, 3, async i => {
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
      if (Number.isFinite(v) && v > -1000) out[i + s.locationId] = { z: v, res: s.resolution };
    }
  });
  return out;
}
export async function openMeteo(points) {
  const out = new Array(points.length).fill(null);
  const chunks = [];
  for (let i = 0; i < points.length; i += 40) chunks.push(i);
  await pool(chunks, 3, async i => {
    const ch = points.slice(i, i + 40);
    const u =
      'https://api.open-meteo.com/v1/elevation?latitude=' +
      ch.map(p => p.lat.toFixed(5)).join(',') +
      '&longitude=' +
      ch.map(p => p.lon.toFixed(5)).join(',');
    try {
      const j = await jget(u, { timeout: 16000 });
      (j.elevation || []).forEach((v, k) => {
        if (v != null && Number.isFinite(+v)) out[i + k] = +v;
      });
    } catch (e) {}
  });
  return out;
}
