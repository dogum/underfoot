/**
 * A track handed to underfoot_path as text: GPX (track or route points) or
 * GeoJSON (a LineString or MultiLineString, bare or in a Feature or a
 * FeatureCollection); and an outline handed to underfoot_area as GeoJSON.
 * Node has no DOMParser, so GPX is read by its point elements' attributes.
 * Pure.
 */
import type { LatLon } from '../core/types';

const ok = (p: LatLon) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

export function readTrack(text: string): LatLon[] {
  const t = text.trim();
  if (t.startsWith('{')) return fromGeoJSON(JSON.parse(t));
  const pts: LatLon[] = [];
  for (const tag of ['trkpt', 'rtept']) {
    for (const m of t.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))) {
      const lat = /\blat\s*=\s*["']([-+\d.eE]+)["']/.exec(m[1]),
        lon = /\blon\s*=\s*["']([-+\d.eE]+)["']/.exec(m[1]);
      if (lat && lon) pts.push({ lat: +lat[1], lon: +lon[1] });
    }
    if (pts.length) break;
  }
  return pts.filter(ok);
}

type Geom = { type: string; coordinates?: unknown; geometries?: Geom[]; geometry?: Geom; features?: Geom[] };
function fromGeoJSON(g: Geom): LatLon[] {
  const out: LatLon[] = [];
  const add = (c: unknown) => {
    for (const p of c as number[][]) out.push({ lat: +p[1], lon: +p[0] });
  };
  const walk = (x: Geom | undefined) => {
    if (!x) return;
    if (x.type === 'FeatureCollection') x.features?.forEach(walk);
    else if (x.type === 'Feature') walk(x.geometry);
    else if (x.type === 'GeometryCollection') x.geometries?.forEach(walk);
    else if (x.type === 'LineString') add(x.coordinates);
    else if (x.type === 'MultiLineString') (x.coordinates as unknown[]).forEach(add);
  };
  walk(g);
  return out.filter(ok);
}

/** an outline from GeoJSON: the first Polygon's outer ring (or a MultiPolygon's first), without its closing vertex */
export function readOutline(text: string): LatLon[] {
  let ring: number[][] | null = null;
  const walk = (x: Geom | undefined) => {
    if (!x || ring) return;
    if (x.type === 'FeatureCollection') x.features?.forEach(walk);
    else if (x.type === 'Feature') walk(x.geometry);
    else if (x.type === 'GeometryCollection') x.geometries?.forEach(walk);
    else if (x.type === 'Polygon') ring = (x.coordinates as number[][][])[0] ?? null;
    else if (x.type === 'MultiPolygon') ring = (x.coordinates as number[][][][])[0]?.[0] ?? null;
  };
  walk(JSON.parse(text.trim()));
  const out = ((ring ?? []) as number[][]).map(p => ({ lat: +p[1], lon: +p[0] })).filter(ok);
  const a = out[0],
    z = out[out.length - 1];
  if (out.length > 1 && a.lat === z.lat && a.lon === z.lon) out.pop();
  return out;
}
