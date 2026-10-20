/**
 * The gazetteer as evidence (data/nominatim): the nearest named object from
 * a reverse geocode, which votes only when its own geometry covers the point.
 * Pure.
 */
import { polyD2, projector, ringContains } from '../core/geo';
import { add, centre, zeros } from '../core/math';
import type { GazFacts, LatLon, SourcePart, StationFacts } from '../core/types';

/** does the object's geometry cover the point: inside its polygon, within 6 m of its line, 4 m of its point; null when it has none */
export function gazCovers(g: GazFacts, pt: LatLon | undefined): boolean | null {
  const G = g.geojson;
  if (!G || !pt) return null;
  const P = projector(pt.lat, pt.lon),
    proj = (r: [number, number][]) => {
      const a = new Float64Array(r.length * 2);
      r.forEach(([lo, la], i) => {
        a[2 * i] = (lo - pt.lon) * P.kx;
        a[2 * i + 1] = (la - pt.lat) * P.ky;
      });
      return a;
    };
  if (G.type === 'Polygon' || G.type === 'MultiPolygon') {
    const polys: [number, number][][][] = G.type === 'Polygon' ? [G.coordinates] : G.coordinates;
    let ins = false;
    for (const pl of polys) for (const r of pl) if (ringContains(0, 0, proj(r))) ins = !ins;
    return ins;
  }
  if (G.type === 'LineString' || G.type === 'MultiLineString') {
    const ls: [number, number][][] = G.type === 'LineString' ? [G.coordinates] : G.coordinates;
    let d = Infinity;
    for (const l of ls) d = Math.min(d, Math.sqrt(polyD2(0, 0, proj(l))));
    return d < 6;
  }
  if (G.type === 'Point') {
    const [lo, la] = G.coordinates as [number, number];
    return Math.hypot((lo - pt.lon) * P.kx, (la - pt.lat) * P.ky) < 4;
  }
  return null;
}
export const GAZ_ROAD = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
]);
export const GAZ_FOOT = new Set([
  'footway',
  'path',
  'cycleway',
  'steps',
  'bridleway',
  'pedestrian',
  'track',
  'corridor',
]);
export function srcGaz(sh: StationFacts): SourcePart {
  const g = sh.nom;
  if (g === undefined)
    return {
      ll: zeros(),
      status: sh.gazAsked ? 'wait' : 'na',
      note: 'asked only for the station in focus (1 request/s policy)',
    };
  if (!g || g.error) return { ll: zeros(), status: 'na', note: 'no gazetteer match' };
  /* reverse geocoding returns the NEAREST addressable object, not the one you
     are standing in — so it only gets a vote when its geometry covers the point */
  const cover = gazCovers(g, sh.pt);
  if (cover === false)
    return {
      ll: zeros(),
      status: 'ok',
      note: `nearest named feature (${g.category}=${g.type}${g.name ? ' · ' + g.name : ''}) does not cover the point — no vote`,
    };
  const cat = g.category || '',
    ty = g.type || '',
    ll = zeros();
  if (cat === 'highway' && GAZ_ROAD.has(ty)) add(ll, { paved: 1.9, path: 0.3, forest: -0.9, water: -1.3 });
  else if (cat === 'highway' && GAZ_FOOT.has(ty)) add(ll, { path: 1.9, paved: 0.4, forest: -0.2 });
  else if (cat === 'building') add(ll, { building: 1.9, paved: 0.4, forest: -1.1, water: -1.4 });
  else if (cat === 'railway') add(ll, { rail: 2.1, paved: 0.3 });
  else if (cat === 'waterway' || ['water', 'river', 'reservoir', 'lake', 'bay'].includes(ty))
    add(ll, { water: 2.0, wetland: 0.5 });
  else if (['wood', 'forest'].includes(ty)) add(ll, { forest: 1.6, path: 0.2 });
  else if (['scrub', 'heath'].includes(ty)) add(ll, { scrub: 1.6 });
  else if (['wetland', 'marsh'].includes(ty)) add(ll, { wetland: 1.7 });
  else if (['farmland', 'orchard', 'vineyard'].includes(ty)) add(ll, { crop: 1.6 });
  else if (['park', 'grass', 'meadow', 'garden', 'pitch', 'golf_course'].includes(ty))
    add(ll, { grass: 1.4, forest: 0.3 });
  else if (['sand', 'beach', 'bare_rock'].includes(ty)) add(ll, { bare: 1.7 });
  else if (ty === 'glacier') add(ll, { snow: 1.9 });
  else if (['parking', 'apron'].includes(ty)) add(ll, { paved: 1.7 });
  else if (['residential', 'neighbourhood'].includes(ty))
    add(ll, { building: 0.5, grass: 0.5, paved: 0.5, crop: -0.9 });
  else
    return {
      ll: zeros(),
      status: 'ok',
      note: `nearest named feature is ${cat || '—'}/${ty || '—'} — no surface implication`,
    };
  return {
    ll: centre(ll),
    status: 'ok',
    note: `nearest feature: ${cat}=${ty}${g.name ? ' · ' + g.name : ''}`,
  };
}
