/**
 * Points from a file, with whatever came with them: GPX, GeoJSON and CSV.
 * A file says whether it's a line (a GPX track or route, a GeoJSON line) or
 * separate points (GPX waypoints, GeoJSON points); a CSV could be either, and
 * the app asks. Names and every other column are kept, for the batch's export.
 */
import { parseLatLon } from './coords';

export interface FilePoint {
  lat: number;
  lon: number;
  /** a name or id from the file, if it had one */
  name?: string;
  /** every other column or property, as given */
  props: Record<string, string>;
}
export interface PointFile {
  pts: FilePoint[];
  /** what the file says it is; 'either' when it doesn't say (a CSV) */
  kind: 'line' | 'points' | 'either';
  /** the column names kept in props, in the file's order */
  cols: string[];
}

const ok = (p: { lat: number; lon: number }) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const NAME_COL = /^(name|id|label|title|site|point|station|code)$/i;

/** GPX: a track or route is a line; waypoints alone are separate points, with their names */
export function readGPX(txt: string): PointFile {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('malformed GPX');
  const at = (n: Element) => ({ lat: +n.getAttribute('lat')!, lon: +n.getAttribute('lon')! });
  let nodes = [...doc.querySelectorAll('trkpt')];
  if (!nodes.length) nodes = [...doc.querySelectorAll('rtept')];
  if (nodes.length)
    return { pts: nodes.map(n => ({ ...at(n), props: {} })).filter(ok), kind: 'line', cols: [] };
  const cols = ['desc', 'cmt', 'ele', 'time'];
  const pts = [...doc.querySelectorAll('wpt')]
    .map(n => {
      const props: Record<string, string> = {};
      for (const c of cols) {
        const v = n.querySelector(c)?.textContent?.trim();
        if (v) props[c] = v;
      }
      const name = n.querySelector('name')?.textContent?.trim();
      return { ...at(n), ...(name ? { name } : {}), props };
    })
    .filter(ok);
  return { pts, kind: 'points', cols: cols.filter(c => pts.some(p => p.props[c] != null)) };
}

type Geom = { type: string; coordinates?: unknown; geometries?: Geom[] };
type Feature = { type: string; geometry?: Geom; properties?: Record<string, unknown> | null };
/** GeoJSON: lines are a line; points and multipoints are separate points, with their properties */
export function readGeoJSON(j: Feature | Geom | { type: string; features?: Feature[] }): PointFile {
  const pts: FilePoint[] = [],
    line: FilePoint[] = [],
    cols: string[] = [];
  const props = (pr: Record<string, unknown> | null | undefined) => {
    const out: Record<string, string> = {};
    let name: string | undefined;
    for (const [k, v] of Object.entries(pr || {})) {
      if (v == null || typeof v === 'object') continue;
      if (!name && NAME_COL.test(k)) name = String(v);
      else {
        out[k] = String(v);
        if (!cols.includes(k)) cols.push(k);
      }
    }
    return { name, out };
  };
  const walk = (g: Geom | undefined, pr?: Record<string, unknown> | null) => {
    if (!g) return;
    const c = g.coordinates as number[] & number[][] & number[][][];
    if (g.type === 'Point' || g.type === 'MultiPoint') {
      const { name, out } = props(pr);
      (g.type === 'Point' ? [c as unknown as number[]] : (c as unknown as number[][])).forEach((q, k, all) =>
        pts.push({
          lat: q[1],
          lon: q[0],
          ...(name ? { name: all.length > 1 ? `${name} ${k + 1}` : name } : {}),
          props: out,
        }),
      );
    } else if (g.type === 'LineString')
      (c as unknown as number[][]).forEach(q => line.push({ lat: q[1], lon: q[0], props: {} }));
    else if (g.type === 'MultiLineString')
      (c as unknown as number[][][]).flat().forEach(q => line.push({ lat: q[1], lon: q[0], props: {} }));
    else if (g.type === 'GeometryCollection') g.geometries?.forEach(x => walk(x, pr));
  };
  const top = j as { type: string; features?: Feature[] };
  if (top.type === 'FeatureCollection') top.features?.forEach(f => walk(f.geometry, f.properties));
  else if (top.type === 'Feature') walk((j as Feature).geometry, (j as Feature).properties);
  else walk(j as Geom);
  return line.length
    ? { pts: line.filter(ok), kind: 'line', cols: [] }
    : { pts: pts.filter(ok), kind: 'points', cols };
}

/** one CSV line split on `sep`, with "quoted, fields" and "" for a quote */
export function splitCSV(l: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '',
    q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) {
      if (ch === '"' && l[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** CSV: columns named lat / lon (or latitude, lng, y, x…) in any order, or one coordinate per line; either a line or points */
export function readCSV(txt: string): PointFile {
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { pts: [], kind: 'either', cols: [] };
  const seps = [',', ';', '\t', '|'],
    sep = seps.reduce((a, b) => (lines[0].split(b).length > lines[0].split(a).length ? b : a));
  const head = splitCSV(lines[0], sep),
    low = head.map(h => h.toLowerCase());
  const li = low.findIndex(h => /^(lat|latitude|y)$/.test(h)),
    oi = low.findIndex(h => /^(lon|lng|long|longitude|x)$/.test(h));
  if (li < 0 || oi < 0) {
    /* no header: one coordinate per line, in any format the paste box takes */
    const pts = lines.map(l => parseLatLon(l)).filter(Boolean) as { lat: number; lon: number }[];
    return { pts: pts.map(p => ({ ...p, props: {} })), kind: 'either', cols: [] };
  }
  const ni = low.findIndex(h => NAME_COL.test(h)),
    keep = head.map((_, k) => k).filter(k => k !== li && k !== oi && k !== ni);
  const pts: FilePoint[] = [];
  for (const l of lines.slice(1)) {
    const c = splitCSV(l, sep),
      p = { lat: parseFloat(c[li]), lon: parseFloat(c[oi]) };
    if (!ok(p)) continue;
    const props: Record<string, string> = {};
    for (const k of keep) if (c[k] != null && c[k] !== '') props[head[k]] = c[k];
    pts.push({ ...p, ...(ni >= 0 && c[ni] ? { name: c[ni] } : {}), props });
  }
  return { pts, kind: 'either', cols: keep.map(k => head[k]) };
}

/** a file's points, by its name and content */
export function readPointFile(txt: string, name: string): PointFile {
  const n = name.toLowerCase();
  if (n.endsWith('.gpx') || /<gpx[\s>]/i.test(txt)) return readGPX(txt);
  if (n.endsWith('.json') || n.endsWith('.geojson') || /^\s*\{/.test(txt))
    return readGeoJSON(JSON.parse(txt));
  return readCSV(txt);
}
