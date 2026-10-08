// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The lock: freeze a sounding so stray clicks only pan, zoom, pick stations and peek.
 */
import { hint } from '../app/actions';
import { STATE } from '../app/state';
import { $, TOUCH, toast } from '../core/dom';
import { finishDrawing, readCursor } from './interact';
import { MAP, mapDraw } from './map';

/* ---- lock: protect a finished analysis from stray clicks ----------------- */
export function isLocked() {
  return MAP.locked && STATE.verts.length > 0;
}
export function syncLock() {
  const on = isLocked(),
    b = $('#lockBtn');
  b.setAttribute('aria-pressed', String(MAP.locked));
  $('#lockTxt').textContent = MAP.locked ? 'Locked' : 'Unlocked';
  $('#lockShackle').setAttribute(
    'd',
    MAP.locked ? 'M3.5 6V4.2a2.5 2.5 0 0 1 5 0V6' : 'M3.5 6V3.2a2.5 2.5 0 0 1 5 0V3.7',
  );
  $('#stage').classList.toggle('locked', on);
  if (MAP.cv && !MAP.drag) MAP.cv.style.cursor = on ? 'grab' : 'crosshair';
}
export function setLocked(v, { quiet } = {}) {
  MAP.locked = !!v;
  try {
    localStorage.setItem('uf.lock', MAP.locked ? '1' : '0');
  } catch (e) {}
  if (MAP.locked && MAP.drawing) finishDrawing();
  clearPeek();
  syncLock();
  hint();
  mapDraw();
  if (!quiet)
    toast(
      MAP.locked
        ? TOUCH
          ? 'Locked: taps pan, zoom, pick stations and peek. Tap the lock to edit again.'
          : 'Locked: clicks pan, zoom and pick stations. K to edit again.'
        : TOUCH
          ? 'Unlocked: taps edit the probe or line.'
          : 'Unlocked: clicks edit the probe or line.',
    );
}
export function flashLock() {
  const g = $('#lockGrp');
  g.classList.remove('flash');
  void g.offsetWidth;
  g.classList.add('flash');
}
export function peekAt(x, y, ll) {
  MAP.peek = ll;
  readCursor(x, y, ll);
  mapDraw();
}
export function clearPeek() {
  if (!MAP.peek) return;
  MAP.peek = null;
  $('#cursorRead').classList.add('hidden');
  mapDraw();
}
