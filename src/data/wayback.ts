/**
 * Esri's World Imagery Wayback: every release of World Imagery since February
 * 2014, keyless and CORS-open. For a spot, which releases really changed its
 * tile, and when each of those pictures was taken.
 *
 * Most releases reuse the tile underneath. A release's tile map says which
 * release a tile really comes from ("select"), so asking the newest release,
 * then the release just before the one it names, and so on, walks back
 * through only the releases that changed the tile: about a dozen requests
 * instead of 197. Each of those has its own metadata service with the capture
 * date, source resolution and provider at the point; its layer 5 ("60cm
 * Resolution Metadata", in every release from 2014 on) is the one shown at
 * z18. Releases are immutable, so tile maps and metadata are cached for a year.
 */
import { merc } from '../core/geo';
import { DAY, cachedFetch, jget } from './http';

const CONFIG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const TILEMAP = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap';
/** the calibration zoom of the imagery classifier */
export const WB_Z = 18;

export interface Release {
  id: number;
  /** publication date, YYYY-MM-DD (not when the pictures were taken) */
  date: string;
  /** the release's metadata MapServer */
  meta: string;
}
export interface CaptureMeta {
  /** acquisition date at the point, YYYY-MM-DD; null when the release has none at z18 */
  date: string | null;
  /** source resolution, metres per pixel */
  res?: number | null;
  /** who captured it: "Maxar", "Microsoft" */
  src?: string | null;
}

type Json = Record<string, unknown>;
/** the release list, newest first, from waybackconfig.json */
export function parseReleases(j: Record<string, Json>): Release[] {
  const out: Release[] = [];
  for (const [k, v] of Object.entries(j || {})) {
    const d = /(\d{4}-\d\d-\d\d)/.exec(String(v?.itemTitle || ''));
    if (d && v.metadataLayerUrl) out.push({ id: +k, date: d[1], meta: String(v.metadataLayerUrl) });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
}
/** the release a tile really comes from, per a release's tile map; null when it has no tile there */
export function parseTilemap(j: { data?: number[]; select?: number[] } | null, rel: number): number | null {
  if (!j || !j.data || !j.data[0]) return null;
  return j.select && j.select[0] ? j.select[0] : rel;
}
/** the z18 capture's date, resolution and provider from a release's metadata (a query's features or an identify's results) */
export function parseCaptureMeta(
  j: { results?: { attributes?: Json }[]; features?: { attributes?: Json }[] } | null,
): CaptureMeta {
  for (const r of j?.features || j?.results || []) {
    const a = r.attributes || {};
    const lo = Number(a.MinMapLevel) || 0,
      hi = Number(a.MaxMapLevel) || 0,
      d = String(a.SRC_DATE || '');
    if (lo <= WB_Z && WB_Z <= hi && /^\d{8}$/.test(d)) {
      const res = parseFloat(String(a.SRC_RES)),
        src = String(a.NICE_DESC || '').trim();
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        res: Number.isFinite(res) && res > 0 ? res : null,
        src: src && src !== 'Null' ? src : null,
      };
    }
  }
  return { date: null };
}

export function releases(): Promise<Release[]> {
  return cachedFetch('wb:releases', DAY, async () => parseReleases(await jget(CONFIG, { timeout: 15000 })));
}
function tileFrom(rel: number, x: number, y: number): Promise<number | null> {
  return cachedFetch(`wb:tm:${rel}/${WB_Z}/${y}/${x}`, 365 * DAY, async () => {
    /* cached as an object so "no tile here" (null) is remembered too */
    const j = await jget(`${TILEMAP}/${rel}/${WB_Z}/${y}/${x}`, { timeout: 15000 });
    return { src: parseTilemap(j, rel) };
  }).then((v: { src: number | null }) => v.src);
}

/**
 * The releases that changed the z18 tile under a point, newest first, and how
 * many tile maps it took to find them. `found` hears of each one as it's
 * found, so its metadata can be asked for while the walk goes on.
 */
export async function changedReleases(
  lat: number,
  lon: number,
  all: Release[],
  found?: (r: Release) => void,
): Promise<{ rels: Release[]; asked: number }> {
  const x = Math.floor(merc.x(lon, WB_Z)),
    y = Math.floor(merc.y(lat, WB_Z)),
    at = new Map(all.map((r, i) => [r.id, i])),
    rels: Release[] = [];
  let i = 0,
    asked = 0;
  while (i < all.length && asked < 60) {
    const src = await tileFrom(all[i].id, x, y);
    asked++;
    const k = src == null ? undefined : at.get(src);
    if (k == null) break;
    rels.push(all[k]);
    found?.(all[k]);
    i = k + 1;
  }
  return { rels, asked };
}

/** what a release's metadata says about the picture under a point */
export function captureMeta(rel: Release, lat: number, lon: number): Promise<CaptureMeta> {
  const la = lat.toFixed(4),
    lo = lon.toFixed(4);
  return cachedFetch(`wb:md:${rel.id}:${la}:${lo}`, 365 * DAY, async () => {
    const u =
      `${rel.meta}/5/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      '&outFields=SRC_DATE,SRC_RES,NICE_DESC,MinMapLevel,MaxMapLevel&returnGeometry=false&f=json';
    return parseCaptureMeta(await jget(u, { timeout: 15000 }));
  });
}
