// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
import { vertsChanged } from '../app/actions';
import { STATE, drawn } from '../app/state';
import { $ } from '../core/dom';
import { merc } from '../core/geo';
import { clamp } from '../core/math';
import { draw } from './draw';
import { evPos, finishDrawing, hitVertex, onCancel, onDown, onMove, onUp, onWheel } from './interact';
import { flashLock, isLocked } from './lock';

/* ==========================================================================
 * MAP — hand-rolled canvas slippy map. It draws the engine's own geometry
 * (field map, the OSM lines and footprints it measured against, sampling
 * radii, the GPS disc, the line of stations) in the same pass as the tiles.
 * ========================================================================*/
export const MAP = {
  lat: 37.7486,
  lon: -119.5868,
  z: 17,
  src: 'sat',
  rings: false,
  vectors: true,
  field: true,
  W: 0,
  H: 0,
  dpr: 1,
  cv: null as HTMLCanvasElement | null,
  g: null as CanvasRenderingContext2D | null,
  raf: 0,
  drag: null,
  ptrs: new Map(),
  pinch: null,
  cursor: null as { lat: number; lon: number } | null,
  brush: null as { lat: number; lon: number } | null,
  fieldCv: null as HTMLCanvasElement | null,
  fieldDirty: true,
  drawing: false,
  locked: false,
  peek: null as { lat: number; lon: number } | null,
};
export const DRAG_PX = 6,
  HIT = 14;

export function mapInit() {
  MAP.cv = $('#map');
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
  MAP.cv.width = Math.round(MAP.W * MAP.dpr);
  MAP.cv.height = Math.round(MAP.H * MAP.dpr);
  mapDraw();
}
export const world = (lat, lon, z) => [merc.x(lon, z) * 256, merc.y(lat, z) * 256];
export function toScreen(lat, lon) {
  const z = MAP.z,
    [wx, wy] = world(lat, lon, z),
    [cx, cy] = world(MAP.lat, MAP.lon, z);
  return [wx - cx + MAP.W / 2, wy - cy + MAP.H / 2];
}
export function toLatLon(sx, sy) {
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
export function zoomAt([x, y], dz) {
  const before = toLatLon(x, y);
  MAP.z = clamp(MAP.z + dz, 2, 20);
  const after = toLatLon(x, y);
  MAP.lat += before.lat - after.lat;
  MAP.lon += before.lon - after.lon;
  mapDraw();
}
export function fitTo(points, pad = 0.3) {
  if (!points.length) return;
  if (points.length === 1) {
    MAP.lat = points[0].lat;
    MAP.lon = points[0].lon;
    MAP.z = Math.max(MAP.z, 17.5);
    mapDraw();
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
  MAP.lat = (n + s) / 2;
  MAP.lon = (e + w) / 2;
  let z = 19;
  while (z > 3) {
    const [x0, y0] = world(n, w, z),
      [x1, y1] = world(s, e, z);
    if (Math.abs(x1 - x0) < MAP.W * (1 - pad) && Math.abs(y1 - y0) < MAP.H * (1 - pad)) break;
    z -= 0.25;
  }
  MAP.z = z;
  mapDraw();
}
