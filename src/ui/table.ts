// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The table view of every station's posterior.
 */
import { STATE } from '../app/state';
import { COL, K, NAME, PRIOR } from '../core/classes';
import { $, el } from '../core/dom';
import { fmt } from '../core/math';

/* ---- table view ---------------------------------------------------------- */
export function showTable() {
  const r = STATE.results[STATE.sel],
    b = $('#tableBody');
  b.textContent = '';
  if (!r || !r.view) {
    b.append(el('p', 'help', 'Nothing sounded yet.'));
    $('#dlgTable').showModal();
    return;
  }
  const f = r.view,
    t = el('table', 'tv');
  t.innerHTML =
    '<thead><tr><th>Class</th><th class="n">Posterior</th><th class="n">Prior</th><th class="n">Δ log₂ odds</th></tr></thead>';
  const tb = el('tbody');
  for (const ci of f.order) {
    const k = K[ci],
      p = f.p[ci],
      pr = PRIOR[k],
      dlo = Math.log2(p / (1 - p)) - Math.log2(pr / (1 - pr));
    const tr = el('tr'),
      c1 = el('td', 'c'),
      sw = el('i');
    sw.style.background = COL[k];
    c1.append(sw, document.createTextNode(NAME[k]));
    tr.append(
      c1,
      el('td', 'n', (p * 100).toFixed(2) + '%'),
      el('td', 'n', (pr * 100).toFixed(1) + '%'),
      el('td', 'n', (dlo > 0 ? '+' : '') + dlo.toFixed(2)),
    );
    tb.append(tr);
  }
  t.append(tb);
  b.append(
    el(
      'p',
      'help',
      `Station ${STATE.sel + 1} · ${r.station.lat.toFixed(6)}, ${r.station.lon.toFixed(6)} · ${r.mode === 'gps' ? `averaged over ±${STATE.gps} m` : r.mode} · entropy ${fmt(f.bits, 2)} of ${fmt(Math.log2(K.length), 2)} bits`,
    ),
    t,
  );
  if (STATE.results.length > 1) {
    b.append(el('h3', 'dh', 'All stations'));
    const t2 = el('table', 'tv');
    t2.innerHTML =
      '<thead><tr><th>#</th><th class="n">m along</th><th>Call</th><th class="n">p</th><th>Runner-up</th></tr></thead>';
    const tb2 = el('tbody');
    STATE.results.forEach((x, i) => {
      if (!x || !x.view) return;
      const tr = el('tr'),
        c = el('td', 'c'),
        sw = el('i');
      sw.style.background = COL[x.view.top];
      c.append(sw, document.createTextNode(NAME[x.view.top]));
      tr.append(
        el('td', null, String(i + 1)),
        el('td', 'n', fmt(x.station.d, 0)),
        c,
        el('td', 'n', Math.round(x.view.topP * 100) + '%'),
        el('td', null, `${NAME[K[x.view.order[1]]]} ${Math.round(x.view.p[x.view.order[1]] * 100)}%`),
      );
      tb2.append(tr);
    });
    t2.append(tb2);
    b.append(t2);
  }
  $('#dlgTable').showModal();
}
