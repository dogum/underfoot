// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * User actions that change what is being sounded: vertices, mode, station
 * selection, and the hint line under the map.
 */
import { startField } from './field';
import { liveOn, stopHere } from './live';
import { recompute, runSounding } from './sound';
import { askGaz } from './gaz';
import { STATE, drawn } from './state';
import { deriveStations } from './stations';
import { $, TOUCH, toast } from '../core/dom';
import { clamp, fmt } from '../core/math';
import { ACRE, MAX_TILES, TILE, ringArea } from '../engine/area';
import { areaPlan } from './area';
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
export function setVerts(
  pts,
  {
    fit = true,
    mode,
    live = false,
  }: { fit?: boolean; mode?: 'point' | 'path' | 'area'; live?: boolean } = {},
) {
  if (!pts.length) {
    toast('No usable coordinates found.');
    return;
  }
  /* a link, a file, pasted coordinates or a recent sounding replaces what Here was reading */
  if (!live && liveOn()) stopHere();
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
/* match lines that follow a mapped path or road (engine/follow), or not:
   off is for a transect that runs beside a trail on purpose */
export function setFollow(on) {
  if (STATE.follow === on) return;
  STATE.follow = on;
  render();
  if (STATE.mode === 'path' && STATE.verts.length > 1) vertsChanged(true);
}
export function syncModeButtons() {
  $('#mPoint').setAttribute('aria-pressed', String(STATE.mode === 'point'));
  $('#mPath').setAttribute('aria-pressed', String(STATE.mode === 'path'));
  $('#mArea').setAttribute('aria-pressed', String(STATE.mode === 'area'));
}
export function setMode(m) {
  if (STATE.mode === m) return;
  if (isLocked()) {
    flashLock();
    toast(`Locked. ${TOUCH ? 'Tap' : 'Press K or'} the lock to switch between point, path and area.`);
    return;
  }
  if (liveOn()) stopHere();
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
        drawn() ? `${tap.toLowerCase()} a station to inspect it` : null,
        TOUCH ? 'tap a spot to peek' : 'hover to read the field',
      ]
        .filter(Boolean)
        .join(' · ') + ` <button data-act="unlock" title="Edit again (K)">Unlock</button>`;
  } else if (STATE.mode === 'area') {
    if (!STATE.verts.length) t = `${tap} to start an outline — the lot inside it is read cell by cell`;
    else if (MAP.drawing)
      t =
        (TOUCH
          ? `Tap to add corners${STATE.verts.length < 3 ? ' (three or more)' : ''}`
          : `Click to add corners${STATE.verts.length < 3 ? ' (three or more)' : ''} · <kbd>Enter</kbd> or double-click to close`) +
        ` <button data-act="undo" title="Remove the last corner (⌫)">Undo</button><button class="go" data-act="done" title="Close the outline (Enter)">Done</button>`;
    else if (tooBig())
      t = `This outline is ${fmt(ringArea(areaPlan(STATE.verts)!.ring) / ACRE, 0)} acres; area mode reads up to about ${fmt((MAX_TILES * TILE * TILE * 0.8) / ACRE, 0)} at a time. Draw a smaller one.`;
    else
      t = TOUCH
        ? 'Drag a ◆ to reshape · long-press one to delete it · tap the map to add a corner'
        : 'Drag a ◆ corner to reshape · right-click one to delete it · click the map to add a corner';
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
  if (!drawn() || !STATE.verts.length) return;
  if (isLocked()) {
    flashLock();
    return;
  }
  STATE.verts.pop();
  if (!STATE.verts.length) MAP.drawing = false;
  vertsChanged();
}
/** an outline with more tiles than area mode reads at once */
function tooBig() {
  const plan = areaPlan(STATE.verts);
  return !!plan && plan.centres.length > MAX_TILES;
}
