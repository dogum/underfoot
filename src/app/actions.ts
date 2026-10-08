// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * User actions that change what is being sounded: vertices, mode, station
 * selection, and the hint line under the map.
 */
import { askGaz, recompute, runSounding, startField } from './sound';
import { STATE } from './state';
import { deriveStations } from './stations';
import { $, TOUCH, toast } from '../core/dom';
import { clamp } from '../core/math';
import { clearPeek, flashLock, isLocked } from '../map/lock';
import { MAP, fitTo } from '../map/map';
import { render } from '../ui/console';

export let _vt = 0;
export function vertsChanged(immediate) {
  MAP.peek = null;
  STATE.runId++;
  STATE.results = [];
  STATE.field = null;
  MAP.fieldDirty = true;
  STATE.stations = deriveStations();
  if (STATE.mode === 'point') STATE.sel = 0;
  else STATE.sel = clamp(STATE.sel, 0, Math.max(0, STATE.stations.length - 1));
  render();
  clearTimeout(_vt);
  _vt = setTimeout(runSounding, immediate || STATE.mode === 'point' ? 0 : 500);
}
export function setVerts(pts, { fit = true, mode } = {}) {
  if (!pts.length) {
    toast('No usable coordinates found.');
    return;
  }
  STATE.mode = mode || (pts.length > 1 ? 'path' : 'point');
  STATE.verts = pts.map(p => ({ lat: p.lat, lon: p.lon }));
  STATE.sel = 0;
  MAP.drawing = false;
  syncModeButtons();
  if (fit) fitTo(pts);
  vertsChanged(true);
}
export function selectStation(i) {
  if (!STATE.stations.length) return;
  clearPeek();
  STATE.sel = clamp(i, 0, STATE.stations.length - 1);
  askGaz(STATE.sel, STATE.runId);
  startField();
  recompute();
  render();
}
export function syncModeButtons() {
  $('#mPoint').setAttribute('aria-pressed', String(STATE.mode === 'point'));
  $('#mPath').setAttribute('aria-pressed', String(STATE.mode === 'path'));
}
export function setMode(m) {
  if (STATE.mode === m) return;
  if (isLocked()) {
    flashLock();
    toast(`Locked. ${TOUCH ? 'Tap' : 'Press K or'} the lock to switch between point and path.`);
    return;
  }
  STATE.mode = m;
  syncModeButtons();
  if (m === 'point') {
    const s = STATE.stations[STATE.sel];
    STATE.verts = s ? [{ lat: s.lat, lon: s.lon }] : [];
    MAP.drawing = false;
  } else MAP.drawing = STATE.verts.length > 0;
  vertsChanged(true);
}
export function hint() {
  const h = $('#hint');
  let t = '';
  const tap = TOUCH ? 'Tap' : 'Click';
  if (isLocked()) {
    t =
      [
        'Locked',
        'drag to pan',
        STATE.mode === 'path' ? `${tap.toLowerCase()} a station to inspect it` : null,
        TOUCH ? 'tap a spot to peek' : 'hover to read the field',
      ]
        .filter(Boolean)
        .join(' · ') + ` <button data-act="unlock" title="Edit again (K)">Unlock</button>`;
  } else if (STATE.mode === 'path') {
    if (!STATE.verts.length) t = `${tap} to start a line — stations are spaced along it`;
    else if (MAP.drawing)
      t =
        (TOUCH
          ? 'Tap to add vertices'
          : 'Click to add vertices · <kbd>Enter</kbd> or double-click to finish') +
        ` <button data-act="undo" title="Remove the last vertex (⌫)">Undo</button><button class="go" data-act="done" title="Finish the line (Enter)">Done</button>`;
    else
      t = TOUCH
        ? 'Drag a ◆ to reshape · long-press one to delete it · tap the map to extend'
        : 'Drag a ◆ vertex to reshape · right-click one to delete it · click the map to extend';
  } else if (!STATE.verts.length) t = `${tap} anywhere to drop a probe`;
  h.innerHTML = t;
  h.hidden = !t;
}
export function undoVertex() {
  if (STATE.mode !== 'path' || !STATE.verts.length) return;
  if (isLocked()) {
    flashLock();
    return;
  }
  STATE.verts.pop();
  if (!STATE.verts.length) MAP.drawing = false;
  vertsChanged();
}
