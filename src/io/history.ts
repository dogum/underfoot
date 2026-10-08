// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Recent soundings, kept in this browser only.
 */
import { setVerts } from '../app/actions';
import { STATE } from '../app/state';
import { along, cumLen } from '../app/stations';
import { COL, NAME } from '../core/classes';
import { $, el } from '../core/dom';
import { closeMenus } from '../ui/menus';
import { total } from '../ui/transect';

/* ---- recent soundings (this browser only) -------------------------------- */
export function loadHist() {
  try {
    return JSON.parse(localStorage.getItem('uf.hist') || '[]');
  } catch (e) {
    return [];
  }
}
export function pushHistory() {
  const r = STATE.results[STATE.sel];
  if (!r || !r.view || !STATE.verts.length) return;
  let v = STATE.verts;
  if (v.length > 80) {
    const cum = cumLen(v);
    v = Array.from({ length: 80 }, (_, k) => along(v, cum, (cum.at(-1) * k) / 79));
  }
  const place =
    r.sh.nom && r.sh.nom.display_name ? r.sh.nom.display_name.split(',').slice(0, 2).join(',').trim() : null;
  let top = r.view.top,
    p = r.view.topP;
  if (STATE.mode === 'path') {
    const cnt = {};
    STATE.results.forEach(x => {
      if (x && x.view) cnt[x.view.top] = (cnt[x.view.top] || 0) + 1;
    });
    top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    p = cnt[top] / STATE.results.length;
  }
  const item = {
    t: Date.now(),
    m: STATE.mode,
    s: STATE.spacing,
    f: STATE.follow ? undefined : 0,
    v: v.map(q => [+q.lat.toFixed(6), +q.lon.toFixed(6)]),
    label: place || `${v[0].lat.toFixed(4)}, ${v[0].lon.toFixed(4)}`,
    top,
    p,
    len: STATE.mode === 'path' ? Math.round(total()) : 0,
  };
  const h = loadHist().filter(x => JSON.stringify(x.v) !== JSON.stringify(item.v));
  h.unshift(item);
  try {
    localStorage.setItem('uf.hist', JSON.stringify(h.slice(0, 24)));
  } catch (e) {}
}
export function showHistory() {
  const m = $('#historyMenu'),
    h = loadHist();
  m.textContent = '';
  if (!h.length)
    m.innerHTML =
      '<div class="empty">Nothing yet — soundings you finish are kept here, in this browser only.</div>';
  for (const it of h) {
    const b = el('button'),
      row = el('div', 'row'),
      sw = el('i', 'sw');
    sw.style.background = COL[it.top] || '#555';
    row.append(sw, el('b', null, it.label));
    b.append(
      row,
      el(
        'small',
        null,
        `${it.m === 'path' ? `line · ${it.len} m · mostly ${NAME[it.top]} (${Math.round(it.p * 100)}% of stations)` : `${NAME[it.top]} ${Math.round(it.p * 100)}%`} · ${new Date(it.t).toLocaleString()}`,
      ),
    );
    b.onclick = () => {
      closeMenus();
      STATE.spacing = it.s || 'auto';
      $('#spacingSel').value = STATE.spacing;
      STATE.follow = it.f !== 0;
      setVerts(
        it.v.map(([lat, lon]) => ({ lat, lon })),
        { mode: it.m },
      );
    };
    m.append(b);
  }
  m.classList.toggle('on');
}
