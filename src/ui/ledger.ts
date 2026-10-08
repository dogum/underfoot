/**
 * The evidence ledger: what each source said, how many bits it moved the
 * answer, its reasoning, and a weight slider per source plus one for N_eff.
 */
import { STATE } from '../app/state';
import { $, el } from '../core/dom';
import { clamp, fmt } from '../core/math';
import type { Fused } from '../core/types';
import { UI, reFuse, render } from './console';
import { weightsTag } from './refit';

export function renderLedger(r: { fused: Fused }) {
  const led = r.fused.ledger || [],
    w = $('#ledger');
  w.textContent = '';
  const who = el('div', 'lwho');
  who.append(weightsTag());
  w.append(who);
  const tRow = el('div', 'lrow' + (UI.open.has('tau') ? ' open' : '')),
    tLed = el('span', 'led cool'),
    tBox = el('div'),
    tHead = el('div', 'lhead');
  tHead.append(
    el('span', 'car', '▸'),
    el('span', 'nm', 'Overlap between sources'),
    el('span', 'bits nil mono', `N_eff ${fmt(STATE.neff, 1)} → τ ${fmt(r.fused.tau ?? 1, 2)}`),
  );
  tHead.onclick = () => {
    UI.open.has('tau') ? UI.open.delete('tau') : UI.open.add('tau');
    render();
  };
  tBox.append(
    tHead,
    el(
      'div',
      'lnote',
      `The sources overlap — OSM, three NLCD rasters and the photo all partly see the same trees. Their summed evidence is divided by τ = active weight (${fmt(r.fused.wsum ?? 0, 2)}) ÷ the number of genuinely independent voices you think they amount to. Lower N_eff = more sceptical.`,
    ),
  );
  const tw = el('div', 'wt'),
    ts = el('input');
  ts.type = 'range';
  ts.min = '1';
  ts.max = '8';
  ts.step = '0.25';
  ts.value = String(STATE.neff);
  ts.setAttribute('aria-label', 'Effective independent sources');
  ts.oninput = () => {
    STATE.neff = +ts.value;
    reFuse();
  };
  tw.append(el('span', 'lbl', 'N_eff'), ts, el('span', null, fmt(STATE.neff, 2)));
  tBox.append(tw);
  tRow.append(tLed, tBox);
  w.append(tRow);
  const maxAbs = Math.max(0.6, ...led.map(l => Math.abs(l.bits)));
  for (const l of led) {
    const row = el('div', 'lrow' + (UI.open.has(l.id) ? ' open' : ''));
    const ledCls =
      l.status === 'wait'
        ? 'wait'
        : l.status === 'ok'
          ? Math.abs(l.bits) > 0.05
            ? 'ok'
            : ''
          : l.status === 'err'
            ? 'err'
            : '';
    const box = el('div'),
      head = el('div', 'lhead');
    head.append(
      el('span', 'car', '▸'),
      el('span', 'nm', l.n),
      el(
        'span',
        'bits mono ' + (l.status !== 'ok' ? 'nil' : l.bits > 0.05 ? 'pos' : l.bits < -0.05 ? 'neg' : 'nil'),
        l.status === 'wait'
          ? '· · ·'
          : l.status !== 'ok'
            ? '—'
            : (l.bits > 0 ? '+' : '') + fmt(l.bits, 2) + ' b',
      ),
      el(
        'span',
        'st',
        l.status === 'wait'
          ? 'in flight'
          : l.status === 'na'
            ? 'not here'
            : l.status === 'err'
              ? 'error'
              : '',
      ),
    );
    head.onclick = () => {
      UI.open.has(l.id) ? UI.open.delete(l.id) : UI.open.add(l.id);
      render();
    };
    box.append(head);
    const bar = el('div', 'lbar'),
      fill = el('div', 'fill');
    bar.append(el('div', 'mid'));
    const frac = clamp(Math.abs(l.bits) / maxAbs, 0, 1) * 50;
    if (l.bits >= 0) {
      fill.style.left = '50%';
      fill.style.background = 'var(--good)';
    } else {
      fill.style.right = '50%';
      fill.style.background = 'var(--bad)';
    }
    fill.style.width = frac + '%';
    bar.append(fill);
    box.append(bar);
    box.append(el('div', 'lnote', (l.note || l.d) + (UI.open.has(l.id) ? '\n— ' + l.d : '')));
    if (l.status === 'ok' || l.status === 'wait') {
      const wt = el('div', 'wt'),
        sl = el('input');
      sl.type = 'range';
      sl.min = '0';
      sl.max = '2';
      sl.step = '0.05';
      sl.value = String(l.wbase);
      sl.setAttribute('aria-label', `Weight for ${l.n}`);
      sl.oninput = () => {
        STATE.weights[l.id] = +sl.value;
        reFuse();
      };
      wt.append(el('span', 'lbl', 'w'), sl, el('span', null, fmt(l.wbase, 2)));
      box.append(wt);
    }
    row.append(el('span', 'led ' + ledCls), box);
    w.append(row);
  }
}
