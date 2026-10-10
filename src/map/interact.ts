// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Pointer, touch, pinch and wheel handling: probe, draw, drag, pan, zoom.
 */
import { _vt, hint, selectStation, vertsChanged } from '../app/actions';
import { STATE, drawn } from '../app/state';
import { deriveStations } from '../app/stations';
import { K, NAME } from '../core/classes';
import { $, toast } from '../core/dom';
import { merc } from '../core/geo';
import { clamp, fmt } from '../core/math';
import { fieldCellAt } from '../engine/field';
import { flashLock, isLocked, peekAt } from './lock';
import { liveOn } from '../app/live';
import { hitBatch } from './batch';
import { render } from '../ui/console';
import { DRAG_PX, HIT, MAP, mapDraw, toLatLon, toScreen, world, zoomAt } from './map';

/* ---- interaction ------------------------------------------------------- */
export function evPos(e) {
  const r = MAP.cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
/* nearest within reach, not the first found: stations sit a few px apart when zoomed out */
export function nearestHit(pts, x, y) {
  let bi = -1,
    bd = HIT;
  pts.forEach((p, i) => {
    const [px, py] = toScreen(p.lat, p.lon),
      d = Math.hypot(px - x, py - y);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return bi;
}
export function hitVertex(x, y) {
  if (!drawn() || STATE.verts.length > 60) return -1;
  return nearestHit(STATE.verts, x, y);
}
export function hitStation(x, y) {
  return nearestHit(STATE.stations, x, y);
}
export function onDown(e) {
  MAP.cv.setPointerCapture(e.pointerId);
  const [x, y] = evPos(e);
  MAP.ptrs.set(e.pointerId, [x, y]);
  if (MAP.ptrs.size === 2) {
    const [a, b] = [...MAP.ptrs.values()];
    MAP.pinch = {
      d0: Math.hypot(a[0] - b[0], a[1] - b[1]),
      z0: MAP.z,
      m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      ll: toLatLon((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
    };
    MAP.drag = null;
    clearTimeout(MAP.lp);
    return;
  }
  let kind = 'pan',
    idx = -1;
  if (held()) {
  } // locked, or Here is on: every drag pans, nothing on the line can be grabbed
  else if (drawn()) {
    idx = hitVertex(x, y);
    if (idx >= 0) kind = 'vertex';
  } else if (STATE.verts.length && hitStation(x, y) === 0) {
    kind = 'vertex';
    idx = STATE.verts.length - 1;
  }
  MAP.drag = { sx: x, sy: y, lat: MAP.lat, lon: MAP.lon, moved: 0, kind, idx };
  MAP.cv.style.cursor = 'grabbing';
  /* touch has no right-click: holding a vertex still for ~half a second deletes it */
  clearTimeout(MAP.lp);
  if (kind === 'vertex' && drawn() && e.pointerType !== 'mouse') {
    const d = MAP.drag;
    MAP.lp = setTimeout(() => {
      if (MAP.drag !== d || d.moved > DRAG_PX) return;
      MAP.drag = null;
      MAP.lpAt = Date.now();
      STATE.verts.splice(d.idx, 1);
      if (!STATE.verts.length) MAP.drawing = false;
      navigator.vibrate && navigator.vibrate(12);
      vertsChanged();
      toast('Vertex removed');
    }, 550);
  }
}
export function onMove(e) {
  const [x, y] = evPos(e),
    ll = toLatLon(x, y);
  MAP.cursor = ll;
  if (MAP.ptrs.has(e.pointerId)) MAP.ptrs.set(e.pointerId, [x, y]);
  if (MAP.pinch && MAP.ptrs.size === 2) {
    const [a, b] = [...MAP.ptrs.values()],
      d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    MAP.z = clamp(MAP.pinch.z0 + Math.log2(d / Math.max(1, MAP.pinch.d0)), 2, 20);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      now = toLatLon(m[0], m[1]);
    MAP.lat += MAP.pinch.ll.lat - now.lat;
    MAP.lon += MAP.pinch.ll.lon - now.lon;
    mapDraw();
    return;
  }
  readCursor(x, y, ll);
  const d = MAP.drag;
  if (!d) {
    MAP.cv.style.cursor = held()
      ? drawn() && hitStation(x, y) >= 0
        ? 'pointer'
        : 'grab'
      : hitVertex(x, y) >= 0 || (STATE.mode === 'point' && hitStation(x, y) === 0)
        ? 'grab'
        : drawn() && hitStation(x, y) >= 0
          ? 'pointer'
          : 'crosshair';
    if (drawn() && MAP.drawing) mapDraw();
    return;
  }
  d.moved = Math.max(d.moved, Math.hypot(x - d.sx, y - d.sy));
  if (d.moved > DRAG_PX) clearTimeout(MAP.lp);
  if (d.kind === 'vertex') {
    if (d.moved > DRAG_PX) {
      /* the old answers no longer belong to these stations: drop them (and any
         replies still in flight) the moment the line starts to move */
      if (!d.inv) {
        d.inv = true;
        STATE.runId++;
        STATE.results = [];
        STATE.field = null;
        MAP.fieldDirty = true;
        clearTimeout(_vt);
      }
      STATE.verts[d.idx] = { lat: ll.lat, lon: ll.lon };
      STATE.stations = deriveStations();
      mapDraw();
    }
    return;
  }
  const z = MAP.z,
    [cx, cy] = world(d.lat, d.lon, z);
  MAP.lat = clamp(merc.lat((cy - (y - d.sy)) / 256, z), -85, 85);
  MAP.lon = merc.lon((cx - (x - d.sx)) / 256, z);
  mapDraw();
}
/** map edits are held while the lock is on or Here is following you */
export const held = () => isLocked() || liveOn();
export function onUp(e) {
  MAP.ptrs.delete(e.pointerId);
  clearTimeout(MAP.lp);
  if (MAP.pinch) {
    if (MAP.ptrs.size < 2) MAP.pinch = null;
    MAP.drag = null;
    return;
  }
  const d = MAP.drag;
  MAP.drag = null;
  const [x, y] = evPos(e);
  MAP.cv.style.cursor = held() ? 'grab' : 'crosshair';
  if (!d) return;
  if (d.kind === 'vertex') {
    if (d.moved > DRAG_PX) {
      vertsChanged(true);
      return;
    }
    if (STATE.mode === 'point') return;
  }
  if (d.moved > DRAG_PX) return;
  /* a click. Point mode: the probe goes here. Path mode: while drawing, every
     click extends the line; once finished (double-click or Enter), a click on
     a station selects it and a click elsewhere resumes extending. */
  const ll = toLatLon(x, y);
  /* locked, or Here is reading the ground under you: a click picks a station,
     or peeks at the field there; it never moves the probe or adds to the line */
  if (held()) {
    const s = drawn() ? hitStation(x, y) : -1;
    if (s >= 0) {
      selectStation(s);
      return;
    }
    if (e.pointerType === 'mouse') isLocked() && flashLock();
    else peekAt(x, y, ll);
    return;
  }
  /* a batch: a click finds the nearest point's row; it never adds a probe */
  if (STATE.mode === 'batch') {
    const i = hitBatch(x, y, toScreen);
    if (STATE.batch) STATE.batch.focus = i >= 0 ? i : null;
    render();
    return;
  }
  if (STATE.mode === 'point') {
    STATE.verts = [ll];
    vertsChanged();
    return;
  }
  if (!MAP.drawing) {
    const s = hitStation(x, y);
    if (s >= 0) {
      selectStation(s);
      return;
    }
    if (d.kind === 'vertex') return;
  }
  MAP.drawing = true;
  STATE.verts.push(ll);
  /* where on screen each vertex was clicked: the map can shift between a
     double-click's two clicks (the transect opens under it once a line has
     two vertices), so its echo is found by where the clicks were, not by
     where the vertices are now */
  clicks.push({ x: e.clientX, y: e.clientY, n: STATE.verts.length });
  if (clicks.length > 2) clicks.shift();
  vertsChanged();
}
const clicks: { x: number; y: number; n: number }[] = [];
export function finishDrawing() {
  if (!MAP.drawing) return;
  MAP.drawing = false;
  const v = STATE.verts; // a double-click lands two clicks on one spot: drop the echo
  if (v.length > 1) {
    const [p, q] = clicks,
      clicked = q && q.n === v.length && p.n === v.length - 1,
      [a, b] = clicked
        ? [
            [q.x, q.y],
            [p.x, p.y],
          ]
        : [toScreen(v.at(-1).lat, v.at(-1).lon), toScreen(v.at(-2).lat, v.at(-2).lon)];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 6) v.pop();
  }
  clicks.length = 0;
  vertsChanged(true);
  hint();
}
export function onCancel(e) {
  clearTimeout(MAP.lp);
  MAP.ptrs.delete(e.pointerId);
  MAP.pinch = null;
  MAP.drag = null;
  MAP.cv.style.cursor = held() ? 'grab' : 'crosshair';
}
export function onWheel(e) {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  zoomAt(evPos(e), (-e.deltaY * unit) / (e.ctrlKey ? 110 : 320));
}
export function readCursor(x, y, ll) {
  const box = $('#cursorRead');
  box.classList.remove('hidden');
  let s = `${ll.lat >= 0 ? 'N' : 'S'} ${Math.abs(ll.lat).toFixed(5)}°  ${ll.lon >= 0 ? 'E' : 'W'} ${Math.abs(ll.lon).toFixed(5)}°\nz${MAP.z.toFixed(1)} · ${fmt(merc.mpp(ll.lat, MAP.z), 2)} m/px`;
  const fld = STATE.field;
  if (MAP.field && fld && fld.ready) {
    const [fx, fy] = fld.G.P.fwd(ll.lat, ll.lon),
      p = fieldCellAt(fld.F, fx, fy);
    if (p) {
      const o = [...p.keys()].sort((a, b) => p[b] - p[a]);
      s += `\nfield · ${NAME[K[o[0]]]} ${Math.round(p[o[0]] * 100)}% · ${NAME[K[o[1]]]} ${Math.round(p[o[1]] * 100)}%`;
    } else if (MAP.peek) s += '\noutside the 120 m field square';
  }
  box.textContent = s;
}
