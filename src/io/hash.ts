// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The URL hash: a point or line you can bookmark and share.
 */
import { setVerts } from '../app/actions';
import { STATE } from '../app/state';
import { $ } from '../core/dom';
import { decodeLine, encodeLine, linkLine } from '../core/polyline';
import { parseLatLon } from './coords';

/* a line this short goes in the link as readable coordinates (v=); a longer
   one is simplified to 1 m and encoded (p=), so a GPS track keeps its shape */
export const READABLE = 12;
export function lineParam(v, max = 1500) {
  return v.length > READABLE
    ? 'p=' + encodeLine(linkLine(v, max))
    : 'v=' + v.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';');
}
/** the link for what's on screen; max caps the points of a long line */
export function hashFor(max = 1500) {
  const v = STATE.verts;
  return v.length ? `#m=${STATE.mode}&s=${STATE.spacing}&${lineParam(v, max)}` : '';
}

/* ---- URL state: a probe or a line you can bookmark ------------------------ */
export function writeHash() {
  try {
    const h = hashFor();
    history.replaceState(null, '', h || location.pathname);
  } catch (e) {}
}
export function readHash() {
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    const v = h.get('p')
      ? decodeLine(h.get('p')) || []
      : (h.get('v') || '').split(';').map(parseLatLon).filter(Boolean);
    if (!v.length) return false;
    if (h.get('s')) {
      STATE.spacing = h.get('s');
      $('#spacingSel').value = STATE.spacing;
    }
    setVerts(v, { mode: h.get('m') === 'path' && v.length > 1 ? 'path' : 'point' });
    return true;
  } catch (e) {
    return false;
  }
}
