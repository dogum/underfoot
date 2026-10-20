import { vertsChanged } from '../app/actions';
import { STATE, drawn } from '../app/state';
import { $ } from '../core/dom';
import { merc } from '../core/geo';
import { clamp } from '../core/math';
import { draw } from './draw';
import { evPos, finishDrawing, hitVertex, onCancel, onDown, onMove, onUp, onWheel } from './interact';
import { flashLock, isLocked } from './lock';
import { settleInset } from '../ui/sheet';
import type { LatLon } from '../core/types';
import type { TileKey } from '../data/imagery';

/** a screen position, px from the map's top-left */
export type XY = [number, number];
/** a press on the map: where it started, the view then, how far it has moved, and what it grabbed */
export interface MapDrag {
  sx: number;
  sy: number;
  lat: number;
  lon: number;
  moved: number;
  kind: 'pan' | 'vertex';
  idx: number;
  /** the line's old answers were dropped when the vertex started to move */
  inv?: boolean;
}
/** two fingers down: their distance and the zoom then, their midpoint and where it was on the ground */
export interface MapPinch {
  d0: number;
  z0: number;
  m0: XY;
  ll: LatLon;
}

/* ==========================================================================
 * MAP — hand-rolled canvas slippy map. It draws the engine's own geometry
 * (field map, the OSM lines and footprints it measured against, sampling
 * radii, the GPS disc, the line of stations) in the same pass as the tiles.
 * ========================================================================*/
export const MAP = {
  lat: 37.7486,
  lon: -119.5868,
  z: 17,
  /* px of the map's foot under the phone's sheet (ui/sheet); 0 on a desktop */
  inset: 0,
  /** the basemap: sat, dark, topo, or a Wayback release as wb:<release> (ui/years) */
  src: 'sat' as TileKey,
  rings: false,
  vectors: true,
  field: true,
  W: 0,
  H: 0,
  dpr: 1,
  cv: null as HTMLCanvasElement | null,
  g: null as CanvasRenderingContext2D | null,
  raf: 0,
  drag: null as MapDrag | null,
  /** pointers down, by id */
  ptrs: new Map<number, XY>(),
  pinch: null as MapPinch | null,
  /** a touch long-press on a vertex, and when one last deleted a vertex (so the context menu it raises is ignored) */
  lp: undefined as ReturnType<typeof setTimeout> | undefined,
  lpAt: 0,
  cursor: null as LatLon | null,
  brush: null as LatLon | null,
  fieldCv: null as HTMLCanvasElement | null,
  fieldDirty: true,
  drawing: false,
  locked: false,
  peek: null as LatLon | null,
};
export const DRAG_PX = 6,
  HIT = 14;

export function mapInit() {
  MAP.cv = $<HTMLCanvasElement>('#map');
  MAP.g = MAP.cv.getContext('2d');
  new ResizeObserver(mapResize).observe($('#stage'));
  mapResize();
  const c = MAP.cv;
  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', onUp);
  c.addEventListener('pointercancel', onCancel);
  c.addEventListener('pointerleave', () => {
    MAP.cursor = null;
    if (!MAP.peek) $('#cursorRead').classList.add('hidden');
    mapDraw();
  });
  c.addEventListener('wheel', onWheel, { passive: false });
  c.addEventListener('dblclick', e => {
    e.preventDefault();
    if (drawn() && MAP.drawing) {
      finishDrawing();
      return;
    }
    if (STATE.mode === 'point' || isLocked()) zoomAt(evPos(e), 1);
  });
  c.addEventListener('contextmenu', e => {
    // right-click a vertex to delete it (touch: long-press, below)
    clearTimeout(MAP.lp);
    if (Date.now() - (MAP.lpAt || 0) < 1500) {
      e.preventDefault();
      return;
    }
    if (isLocked()) {
      e.preventDefault();
      if (hitVertex(evPos(e)[0], evPos(e)[1]) >= 0) flashLock();
      return;
    }
    const [x, y] = evPos(e),
      v = hitVertex(x, y);
    if (v >= 0 && drawn()) {
      e.preventDefault();
      MAP.lpAt = Date.now();
      MAP.drag = null;
      STATE.verts.splice(v, 1);
      vertsChanged();
    }
  });
}
export function mapResize() {
  const r = $('#stage').getBoundingClientRect();
  MAP.dpr = Math.min(2, devicePixelRatio || 1);
  MAP.W = Math.max(1, r.width);
  MAP.H = Math.max(1, r.height);
  MAP.cv!.width = Math.round(MAP.W * MAP.dpr);
  MAP.cv!.height = Math.round(MAP.H * MAP.dpr);
  mapDraw();
}
/** world pixels at zoom z */
export const world = (lat: number, lon: number, z: number): XY => [
  merc.x(lon, z) * 256,
  merc.y(lat, z) * 256,
];
export function toScreen(lat: number, lon: number): XY {
  const z = MAP.z,
    [wx, wy] = world(lat, lon, z),
    [cx, cy] = world(MAP.lat, MAP.lon, z);
  return [wx - cx + MAP.W / 2, wy - cy + MAP.H / 2];
}
export function toLatLon(sx: number, sy: number): LatLon {
  const z = MAP.z,
    [cx, cy] = world(MAP.lat, MAP.lon, z);
  return { lat: merc.lat((sy - MAP.H / 2 + cy) / 256, z), lon: merc.lon((sx - MAP.W / 2 + cx) / 256, z) };
}
export function mapDraw() {
  if (MAP.raf) return;
  MAP.raf = requestAnimationFrame(() => {
    MAP.raf = 0;
    draw();
  });
}
export function updateScale() {
  const mpp = merc.mpp(MAP.lat, MAP.z);
  let best = 1;
  for (const t of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000])
    if (t / mpp <= 120) best = t;
  $('#scaleBar').style.width = best / mpp + 'px';
  $('#scaleTxt').textContent = best >= 1000 ? best / 1000 + ' km' : best + ' m';
}
export function zoomAt([x, y]: number[], dz: number) {
  const before = toLatLon(x, y);
  MAP.z = clamp(MAP.z + dz, 2, 20);
  const after = toLatLon(x, y);
  MAP.lat += before.lat - after.lat;
  MAP.lon += before.lon - after.lon;
  mapDraw();
}
export function fitTo(points: LatLon[], pad = 0.3) {
  if (!points.length) return;
  settleInset();
  if (points.length === 1) {
    MAP.z = Math.max(MAP.z, 17.5);
    centreOn(points[0].lat, points[0].lon);
    return;
  }
  let n = -90,
    s = 90,
    e = -180,
    w = 180;
  for (const p of points) {
    n = Math.max(n, p.lat);
    s = Math.min(s, p.lat);
    e = Math.max(e, p.lon);
    w = Math.min(w, p.lon);
  }
  const H = MAP.H - MAP.inset;
  let z = 19;
  while (z > 2) {
    const [x0, y0] = world(n, w, z),
      [x1, y1] = world(s, e, z);
    if (Math.abs(x1 - x0) < MAP.W * (1 - pad) && Math.abs(y1 - y0) < H * (1 - pad)) break;
    z -= 0.25;
  }
  MAP.z = z;
  centreOn((n + s) / 2, (e + w) / 2);
}
/** put a point in the middle of the part of the map the phone's sheet doesn't cover */
function centreOn(lat: number, lon: number) {
  const [, y] = world(lat, lon, MAP.z);
  MAP.lat = merc.lat((y + MAP.inset / 2) / 256, MAP.z);
  MAP.lon = lon;
  mapDraw();
}
