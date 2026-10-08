// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The URL hash: a point or line you can bookmark and share.
 */
import { setVerts } from '../app/actions';
import { STATE } from '../app/state';
import { along, cumLen } from '../app/stations';
import { $ } from '../core/dom';
import { parseLatLon } from './coords';

/* ---- URL state: a probe or a line you can bookmark ------------------------ */
export function writeHash() {
  try {
    let v = STATE.verts;
    if (!v.length) {
      history.replaceState(null, '', location.pathname);
      return;
    }
    if (v.length > 80) {
      const cum = cumLen(v);
      v = Array.from({ length: 80 }, (_, k) => along(v, cum, (cum.at(-1) * k) / 79));
    }
    const s =
      `#m=${STATE.mode}&s=${STATE.spacing}${STATE.follow ? '' : '&f=0'}&v=` +
      v.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';');
    history.replaceState(null, '', s);
  } catch (e) {}
}
export function readHash() {
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    const v = (h.get('v') || '').split(';').map(parseLatLon).filter(Boolean);
    if (!v.length) return false;
    STATE.follow = h.get('f') !== '0';
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
