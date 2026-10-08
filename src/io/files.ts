// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Loading tracks: GPX, GeoJSON and CSV (column names or positions, either order).
 */
import { setVerts } from '../app/actions';
import { toast } from '../core/dom';
import { parseLatLon } from './coords';

export async function loadFile(file) {
  const txt = await file.text(),
    name = (file.name || '').toLowerCase();
  let pts = [];
  try {
    if (name.endsWith('.gpx') || /<gpx[\s>]/i.test(txt)) pts = parseGPX(txt);
    else if (name.endsWith('.json') || name.endsWith('.geojson') || /^\s*\{/.test(txt))
      pts = parseGeoJSON(JSON.parse(txt));
    else pts = parseCSV(txt);
  } catch (e) {
    toast('Could not read that file — ' + (e.message || e));
    return;
  }
  if (!pts.length) {
    toast('No coordinates found in ' + file.name);
    return;
  }
  toast(
    `${file.name}: ${pts.length} point${pts.length > 1 ? 's' : ''}${pts.length > 1 ? ' — stations spaced along the track' : ''}`,
  );
  setVerts(pts);
}
export function parseGPX(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('malformed GPX');
  let nodes = [...doc.querySelectorAll('trkpt')];
  if (!nodes.length) nodes = [...doc.querySelectorAll('rtept')];
  if (!nodes.length) nodes = [...doc.querySelectorAll('wpt')];
  return nodes
    .map(n => ({ lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon') }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}
export function parseGeoJSON(j) {
  const out = [],
    walk = g => {
      if (!g) return;
      if (g.type === 'FeatureCollection') g.features.forEach(f => walk(f.geometry));
      else if (g.type === 'Feature') walk(g.geometry);
      else if (g.type === 'Point') out.push({ lat: g.coordinates[1], lon: g.coordinates[0] });
      else if (g.type === 'MultiPoint' || g.type === 'LineString')
        g.coordinates.forEach(c => out.push({ lat: c[1], lon: c[0] }));
      else if (g.type === 'MultiLineString')
        g.coordinates.flat().forEach(c => out.push({ lat: c[1], lon: c[0] }));
    };
  walk(j);
  return out.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}
export function parseCSV(txt) {
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const split = l => l.split(/[,\t;|]/).map(s => s.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]).map(h => h.toLowerCase());
  const li = head.findIndex(h => /^(lat|latitude|y)$/.test(h)),
    oi = head.findIndex(h => /^(lon|lng|long|longitude|x)$/.test(h));
  const out = [];
  for (const l of li >= 0 && oi >= 0 ? lines.slice(1) : lines) {
    if (li >= 0 && oi >= 0) {
      const c = split(l),
        p = { lat: +c[li], lon: +c[oi] };
      if (Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90) out.push(p);
    } else {
      const p = parseLatLon(l);
      if (p) out.push(p);
    }
  }
  return out;
}
