/**
 * The map drawn into a canvas of its own, for the share card: the same tiles,
 * field map, vectors, line and stations as on screen, at a view fitted to the
 * sounding, with no buttons or hints. Satellite imagery always: its tiles can
 * be read back from a canvas, which the share card needs.
 */
import { STATE } from '../app/state';
import { clamp } from '../core/math';
import { TILE_SRC, loadTile } from '../data/imagery';
import { draw } from './draw';
import { MAP, mapDraw, world } from './map';
import type { LatLon } from '../core/types';

/** the view that fits these points in W × H, at most z max */
export function fitView(pts: LatLon[], W: number, H: number, max = 18.5) {
  const lat = pts.map(p => p.lat),
    lon = pts.map(p => p.lon),
    c = { lat: (Math.min(...lat) + Math.max(...lat)) / 2, lon: (Math.min(...lon) + Math.max(...lon)) / 2 };
  if (pts.length < 2) return { ...c, z: max };
  let z = max;
  while (z > 3) {
    const [x0, y0] = world(Math.max(...lat), Math.min(...lon), z),
      [x1, y1] = world(Math.min(...lat), Math.max(...lon), z);
    if (Math.abs(x1 - x0) < W * 0.78 && Math.abs(y1 - y0) < H * 0.78) break;
    z -= 0.25;
  }
  return { ...c, z };
}

/** wait for the satellite tiles a view needs (or give up after `ms`) */
async function tilesFor(v: { lat: number; lon: number; z: number }, W: number, H: number, ms = 8000) {
  const S = TILE_SRC.sat,
    zi = clamp(Math.round(v.z), 2, S.max),
    scale = Math.pow(2, v.z - zi),
    [cx, cy] = world(v.lat, v.lon, zi),
    wait: Promise<unknown>[] = [];
  for (let ty = Math.floor((cy - H / 2 / scale) / 256); ty <= Math.floor((cy + H / 2 / scale) / 256); ty++)
    for (let tx = Math.floor((cx - W / 2 / scale) / 256); tx <= Math.floor((cx + W / 2 / scale) / 256); tx++)
      wait.push(loadTile('sat', zi, tx, ty).p);
  await Promise.race([Promise.all(wait), new Promise(r => setTimeout(r, ms))]);
}

/** the sounding on screen drawn into a W × H canvas */
export async function snapshot(W: number, H: number): Promise<HTMLCanvasElement> {
  const pts = STATE.verts.length > 1 ? STATE.verts : STATE.stations.slice(0, 1),
    v = fitView(pts, W, H);
  await tilesFor(v, W, H);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const keep = {
    cv: MAP.cv,
    g: MAP.g,
    W: MAP.W,
    H: MAP.H,
    dpr: MAP.dpr,
    lat: MAP.lat,
    lon: MAP.lon,
    z: MAP.z,
    src: MAP.src,
    field: MAP.field,
    brush: MAP.brush,
    peek: MAP.peek,
    drawing: MAP.drawing,
    fieldDirty: MAP.fieldDirty,
  };
  /* the field map makes sense around a single point, and across an area as its mosaic */
  Object.assign(MAP, {
    cv,
    g: cv.getContext('2d'),
    W,
    H,
    dpr: 1,
    ...v,
    src: 'sat',
    field: MAP.field && (STATE.mode === 'point' || STATE.mode === 'area'),
    brush: null,
    peek: null,
    drawing: false,
  });
  try {
    draw();
  } finally {
    Object.assign(MAP, keep);
    MAP.fieldDirty = true;
    mapDraw();
  }
  return cv;
}
