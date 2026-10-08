/**
 * Refit, in the readout: fit the source weights and N_eff to your marks
 * (engine/refit), show how each does on marks its fit never saw, and let you
 * choose. Your weights are kept on this device and applied at boot; Reset
 * puts the defaults back exactly.
 */
import { STATE } from '../app/state';
import { PRIOR, SOURCES } from '../core/classes';
import { $, el, toast } from '../core/dom';
import { fmt } from '../core/math';
import { REFIT, defaultFit, fitWeights, heldOut, usable, type Fit, type Weights } from '../engine/refit';
import { fitMarks, marks } from '../io/marks';
import { reFuse } from './console';

interface Saved extends Fit {
  /** marks it was fitted to, and when */
  n: number;
  t: number;
}
const KEY = 'uf.fit';
export function savedFit(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && v.weights && v.neff > 0 ? v : null;
  } catch {
    return null;
  }
}
function keepFit(f: Saved | null) {
  try {
    if (f) localStorage.setItem(KEY, JSON.stringify(f));
    else localStorage.removeItem(KEY);
  } catch {}
}

const same = (a: Fit, b: Fit) => a.neff === b.neff && SOURCES.every(s => a.weights[s.id] === b.weights[s.id]);
const inUse = (): Fit => ({ weights: { ...STATE.weights } as Weights, neff: STATE.neff });
function useFit(f: Fit) {
  STATE.weights = { ...f.weights };
  STATE.neff = f.neff;
}

/** whose weights are in use: the defaults, yours (a saved fit), or adjusted by hand */
export function whose(): { k: 'defaults' | 'yours' | 'adjusted'; n?: number } {
  const now = inUse(),
    s = savedFit();
  if (same(now, defaultFit())) return { k: 'defaults' };
  if (s && same(now, s)) return { k: 'yours', n: s.n };
  return { k: 'adjusted' };
}

/** at boot: your weights, if you chose them */
export function applySavedFit() {
  const s = savedFit();
  if (s && SOURCES.every(x => s.weights[x.id] > 0)) useFit(s);
}

/** back to the defaults, exactly, and forget the fit */
export function resetWeights() {
  useFit(defaultFit());
  keepFit(null);
  reFuse();
  toast('Default weights');
}

/** the ledger header's "whose weights", with Reset when they aren't the defaults */
export function weightsTag(): HTMLElement {
  const w = whose(),
    tag = el('span', 'who');
  tag.append(el('span', 'lbl', 'Weights'), el('b', null, w.k === 'yours' ? `yours · ${w.n} marks` : w.k));
  if (w.k !== 'defaults') {
    const b = el('button', 'lnk', 'Reset');
    b.title = 'Back to the default weights and N_eff, exactly';
    b.onclick = e => {
      e.stopPropagation();
      resetWeights();
    };
    tag.append(b);
  }
  return tag;
}

/* one "what moved" row: a bar from the default (the tick) to the fit */
function moved(name: string, from: number, to: number): HTMLElement {
  const row = el('div', 'wt'),
    bar = el('span', 'bar'),
    fill = el('i'),
    tick = el('b'),
    r = Math.max(-1, Math.min(1, Math.log(to / from)));
  fill.style.left = (r < 0 ? 50 + 50 * r : 50) + '%';
  fill.style.width = Math.abs(50 * r) + '%';
  tick.style.left = '50%';
  bar.append(fill, tick);
  row.append(
    el('span', 'nm', name),
    bar,
    el('em', to >= from ? 'up' : 'dn', `${fmt(from, 2)} → ${fmt(to, 2)}`),
  );
  return row;
}

export function openRefit() {
  const dlg = $('#dlgRefit') as HTMLDialogElement,
    body = $('#refitBody'),
    foot = $('#refitFoot'),
    all = fitMarks(marks()),
    n = usable(all).length;
  body.textContent = '';
  foot.textContent = '';
  $('#refitSub').textContent = `${marks().length} marks · ${n} to learn from`;
  const close = el('button', 'btn', 'Close');
  close.onclick = () => dlg.close();
  if (n < REFIT.minMarks) {
    body.append(
      el(
        'p',
        'help',
        `A refit learns from marks that say right or wrong where the sources made the call, not at a crossing or on a followed path. It needs ${REFIT.minMarks}; you have ${n}.`,
      ),
    );
    foot.append(close);
    dlg.showModal();
    return;
  }
  body.append(el('p', 'help', 'Fitting…'));
  dlg.showModal();
  /* let the dialog paint before the fits run (a few hundred ms) */
  setTimeout(() => {
    const fit = fitWeights(all, PRIOR),
      h = heldOut(all, PRIOR),
      d = defaultFit(),
      how = h.n <= REFIT.looMax ? 'each mark held out in turn' : `held out ${REFIT.folds} ways`;
    body.textContent = '';
    const acc = el('div', 'acc');
    for (const [k, v, cls] of [
      ['Defaults', h.defaults, ''],
      ['Fitted', h.fitted, h.fitted > h.defaults ? 'up' : h.fitted < h.defaults ? 'dn' : ''],
    ] as const) {
      const c = el('div');
      c.append(
        el('span', 'lbl', k),
        el('b', cls, `${v} of ${h.n}`),
        el('small', null, k === 'Defaults' ? 'right on your marks' : how),
      );
      acc.append(c);
    }
    body.append(acc, el('div', 'lbl', 'What moved'));
    const rows = SOURCES.map(s => ({ s, r: Math.abs(Math.log(fit.weights[s.id] / d.weights[s.id])) }))
      .filter(x => x.r >= 0.02)
      .sort((a, b) => b.r - a.r);
    for (const { s } of rows) body.append(moved(s.n, d.weights[s.id], fit.weights[s.id]));
    body.append(moved('N_eff (overlap)', d.neff, fit.neff));
    if (!rows.length)
      body.append(el('p', 'help', 'No source weight moved much: your marks agree with the defaults.'));
    const better = h.fitted > h.defaults;
    foot.append(el('small', null, 'Not-sure marks don’t count'));
    const keep = el('button', 'btn' + (better ? '' : ' pri'), 'Keep defaults'),
      use = el('button', 'btn' + (better ? ' pri' : ''), 'Use my weights');
    keep.onclick = () => {
      dlg.close();
      if (whose().k !== 'defaults') resetWeights();
    };
    use.onclick = () => {
      dlg.close();
      keepFit({ ...fit, n: h.n, t: Date.now() });
      useFit(fit);
      reFuse();
      toast(`Using weights fitted to ${h.n} marks`);
    };
    foot.append(keep, use);
    (better ? use : keep).focus();
  }, 30);
}
