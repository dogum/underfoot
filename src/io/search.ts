// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Place search (Nominatim) with keyboard navigation; pasted coordinates go straight to a probe.
 */
import { setVerts, syncModeButtons } from '../app/actions';
import { STATE } from '../app/state';
import { $, el, esc, toast } from '../core/dom';
import { haversine } from '../core/geo';
import { clamp } from '../core/math';
import { nomSearch } from '../data/nominatim';
import { parseLatLon } from './coords';
import { MAP, fitTo } from '../map/map';
import { closeMenus } from '../ui/menus';

/* ---- search -------------------------------------------------------------- */
export let _sres = [],
  _shl = -1;
/* arrow keys walk the result list; Enter takes the highlighted result */
export function onSearchKey(e) {
  const s = $('#search'),
    m = $('#searchMenu'),
    items = [...m.querySelectorAll('button')];
  if (e.key === 'Enter') {
    e.preventDefault();
    if (m.classList.contains('on') && _shl >= 0 && _sres[_shl]) chooseResult(_sres[_shl]);
    else doSearch(s.value);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    _shl = clamp(_shl + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
    items.forEach((b, i) => b.classList.toggle('hl', i === _shl));
  } else if (e.key === 'Escape') {
    closeMenus();
    s.blur();
  }
}

export async function doSearch(q) {
  q = q.trim();
  if (!q) return;
  const ll = parseLatLon(q);
  if (ll) {
    closeMenus();
    STATE.mode = 'point';
    syncModeButtons();
    setVerts([ll], { mode: 'point' });
    return;
  }
  const m = $('#searchMenu');
  m.innerHTML = '<div class="empty">searching…</div>';
  m.classList.add('on');
  try {
    _sres = await nomSearch(q);
  } catch (e) {
    m.innerHTML = `<div class="empty">search failed — ${esc(e.message)}</div>`;
    return;
  }
  _shl = _sres.length ? 0 : -1;
  m.textContent = '';
  if (!_sres.length) {
    m.innerHTML = '<div class="empty">nothing found</div>';
    return;
  }
  _sres.forEach((r, i) => {
    const b = el('button', i === _shl ? 'hl' : '');
    b.append(
      el('b', null, r.name || r.display_name.split(',')[0]),
      el('small', null, `${r.category}/${r.type} · ${r.display_name}`),
    );
    b.onclick = () => chooseResult(r);
    m.append(b);
  });
}
export function chooseResult(r) {
  closeMenus();
  $('#search').blur();
  const bb = (r.boundingbox || []).map(Number),
    lat = +r.lat,
    lon = +r.lon;
  const diag = bb.length === 4 ? haversine({ lat: bb[0], lon: bb[2] }, { lat: bb[1], lon: bb[3] }) : 0;
  if (diag < 350) {
    MAP.lat = lat;
    MAP.lon = lon;
    MAP.z = 18;
    setVerts([{ lat, lon }], { mode: 'point', fit: false });
  } // an address or a building: probe it
  else {
    fitTo(
      [
        { lat: bb[0], lon: bb[2] },
        { lat: bb[1], lon: bb[3] },
      ],
      0.1,
    );
    toast(`${r.name || 'Place'} — click to probe inside it`);
  }
}
