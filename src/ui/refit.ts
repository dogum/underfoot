/**
 * Whose weights are in use, and Refit: fit the source weights and N_eff to
 * your marks (engine/refit), show how each does on marks its fit never saw,
 * and let you choose. Weights come, in order of preference, from your own
 * refit (kept on this device), the community's (app/weights), or the
 * defaults, which are community version 0. Reset puts the community's back
 * exactly.
 */
import { STATE } from '../app/state';
import { baseline, communityFile, loadCommunity } from '../app/weights';
import { REPO_URL } from '../core/project';
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
  /* a fit saved before a source existed has no weight for it: that one keeps its default */
  STATE.weights = { ...defaultFit().weights, ...f.weights };
  STATE.neff = f.neff;
}

/* the community's weights are the baseline; version 0 is the defaults */
const community = () => communityFile().version > 0;
const baseName = () => (community() ? `community v${communityFile().version}` : 'defaults');

/** whose weights are in use: the community's (or the defaults), yours (a saved fit), or adjusted by hand */
export function whose(): { k: 'defaults' | 'community' | 'yours' | 'adjusted'; n?: number } {
  const now = inUse(),
    s = savedFit();
  if (same(now, baseline()))
    return community() ? { k: 'community', n: communityFile().marks } : { k: 'defaults' };
  if (s && same(now, s)) return { k: 'yours', n: s.n };
  if (same(now, defaultFit())) return { k: 'defaults' };
  return { k: 'adjusted' };
}

/** at boot: your weights if you chose them, the community's otherwise */
export function applyWeights() {
  const s = savedFit();
  useFit(s && SOURCES.every(x => s.weights[x.id] > 0) ? s : baseline());
}

/** newer community weights from the site: used at once, unless you're using your own */
export async function refreshCommunity() {
  const was = whose().k;
  if (!(await loadCommunity())) return;
  if (was === 'defaults' || was === 'community') {
    useFit(baseline());
    reFuse();
  }
}

/** back to the community's weights (or the defaults), exactly, and forget your fit */
export function resetWeights() {
  useFit(baseline());
  keepFit(null);
  reFuse();
  toast(community() ? `Community weights v${communityFile().version}` : 'Default weights');
}

/** the ledger header's "whose weights", with Reset when they aren't the defaults */
export function weightsTag(): HTMLElement {
  const w = whose(),
    tag = el('span', 'who');
  tag.append(
    el('span', 'lbl', 'Weights'),
    el(
      'b',
      null,
      w.k === 'yours'
        ? `yours · ${w.n} marks`
        : w.k === 'community'
          ? `${baseName()} · ${(w.n ?? 0).toLocaleString('en')} marks`
          : w.k,
    ),
  );
  if (w.k === 'community') {
    const a = el('a', 'lnk', 'what moved');
    a.href = `${REPO_URL}/blob/main/docs/weights-changelog.md`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'The weights changelog: each version, what moved, on how many marks';
    tag.append(a);
  }
  if (w.k === 'yours' || w.k === 'adjusted') {
    const b = el('button', 'lnk', 'Reset');
    b.title = `Back to the ${baseName()} weights and N_eff, exactly`;
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
    const d = baseline(),
      fit = fitWeights(all, PRIOR, d),
      h = heldOut(all, PRIOR, d),
      before = community() ? `Community v${communityFile().version}` : 'Defaults',
      how = h.n <= REFIT.looMax ? 'each mark held out in turn' : `held out ${REFIT.folds} ways`;
    body.textContent = '';
    const acc = el('div', 'acc');
    for (const [k, v, cls] of [
      [before, h.defaults, ''],
      ['Fitted', h.fitted, h.fitted > h.defaults ? 'up' : h.fitted < h.defaults ? 'dn' : ''],
    ] as const) {
      const c = el('div');
      c.append(
        el('span', 'lbl', k),
        el('b', cls, `${v} of ${h.n}`),
        el('small', null, k === before ? 'right on your marks' : how),
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
      body.append(
        el('p', 'help', `No source weight moved much: your marks agree with the ${baseName()} weights.`),
      );
    const better = h.fitted > h.defaults;
    foot.append(el('small', null, 'Not-sure marks don’t count'));
    const keep = el(
        'button',
        'btn' + (better ? '' : ' pri'),
        community() ? 'Keep community weights' : 'Keep defaults',
      ),
      use = el('button', 'btn' + (better ? ' pri' : ''), 'Use my weights');
    keep.onclick = () => {
      dlg.close();
      if (whose().k === 'yours' || whose().k === 'adjusted') resetWeights();
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
