/**
 * Soils (M5, go / slow / no-go): the drainage class and hydrologic soil group
 * of the main soil under each US station, from USDA's Soil Data Access
 * (keyless, CORS-open SQL over the SSURGO survey). Stations are asked in
 * batches of 50 in one query each, cached for 90 days: soil surveys change
 * slowly. Outside the US there's no survey, and go / slow / no-go uses today's
 * soil water alone.
 */
import type { LatLon, SoilFacts } from '../core/types';
import { DAY, cachedFetch, jget } from './http';

export const SDA_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
const BATCH = 50;

/** one query for a batch of points: each point's map unit, then its largest major component */
export function soilQuery(pts: LatLon[]): string {
  const at = pts
    .map(
      (p, i) =>
        `SELECT ${i} AS i, k.mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${p.lon.toFixed(6)} ${p.lat.toFixed(6)})') k`,
    )
    .join(' UNION ALL ');
  return (
    `WITH s AS (${at}) SELECT s.i, mu.muname, c.drainagecl, c.hydgrp FROM s ` +
    "JOIN mapunit mu ON mu.mukey = s.mukey JOIN component c ON c.mukey = s.mukey AND c.majcompflag = 'Yes' " +
    'ORDER BY s.i, c.comppct_r DESC'
  );
}

/** the rows as facts per point, the first (largest) component for each; null where there's none (pure) */
export function parseSoils(j: unknown, n: number): (SoilFacts | null)[] {
  const out: (SoilFacts | null)[] = new Array(n).fill(null),
    rows = (j as { Table?: unknown[][] })?.Table;
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const i = Number(r?.[0]);
    if (!Number.isInteger(i) || i < 0 || i >= n || out[i]) continue;
    out[i] = {
      unit: String(r[1] ?? ''),
      drainage: r[2] == null ? null : String(r[2]),
      group: r[3] == null ? null : String(r[3]),
    };
  }
  return out;
}

/** ground that drains poorly: a poorly drained class, or hydrologic group C or D */
export const drainsPoorly = (s: SoilFacts) => /poorly/i.test(s.drainage || '') || /[CD]/.test(s.group || '');

/** the soil under each point; null where the survey has none or couldn't be read */
export async function soilsFor(points: LatLon[]): Promise<(SoilFacts | null)[]> {
  const out: (SoilFacts | null)[] = [];
  for (let k = 0; k < points.length; k += BATCH) {
    const pts = points.slice(k, k + BATCH),
      query = soilQuery(pts);
    let j: unknown = null;
    try {
      j = await cachedFetch(
        'soil:' + pts.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';'),
        90 * DAY,
        () =>
          jget(SDA_URL, {
            method: 'POST',
            body: JSON.stringify({ query, format: 'JSON' }),
            headers: { 'Content-Type': 'application/json' },
            timeout: 20000,
          }),
      );
    } catch {}
    out.push(...parseSoils(j, pts.length));
  }
  return out;
}
