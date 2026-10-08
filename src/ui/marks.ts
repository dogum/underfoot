/**
 * Marks, in the readout: right / wrong / not sure under every answer, what's
 * really there and how you know, and the Marks menu in the topbar (io/marks).
 * The editor's state lives here, so the verdict can re-render under it.
 */
import { render } from './console';
import { selectStation } from '../app/actions';
import { closeMenus, keepOnScreen } from './menus';
import { openRefit } from './refit';
import { STATE } from '../app/state';
import { CLASSES, COL, NAME, SOURCES, VERSION } from '../core/classes';
import { $, el, toast } from '../core/dom';
import { SITE_URL } from '../core/project';
import { download } from '../io/export';
import { hashFor } from '../io/hash';
import {
  HOW,
  deleteMark,
  keepParts,
  kept,
  markTitle,
  marks,
  marksCSV,
  marksGeoJSON,
  marksSummary,
  marksVersion,
  nearestMark,
  newMarkId,
  saveMark,
  type How,
  type Mark,
  type Verdict,
} from '../io/marks';
import type { ClassKey, Station, StationResult } from '../core/types';

/* the mark being made or edited, for the station at `key` */
interface Draft {
  key: string;
  verdict: Verdict;
  truth: ClassKey | null;
  how: How | null;
  /** set when editing a saved mark */
  id?: string;
  t?: number;
}
let draft: Draft | null = null;
/** a mark to open in the editor once its sounding is on screen (Marks ▸ edit) */
let editOnOpen: string | null = null;

const keyOf = (s: { lat: number; lon: number }) => s.lat.toFixed(6) + ',' + s.lon.toFixed(6);
const say = (k: ClassKey) => NAME[k].split(' /')[0].toLowerCase();
const A: Partial<Record<ClassKey, string>> = { building: 'a building', path: 'a path', rail: 'a railway' };
const thing = (k: ClassKey) => A[k] || say(k);
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const TICK: Record<Verdict, string> = { right: '✓', wrong: '✗', unsure: '?' };

/* the mark at a station, cached per station until marks change */
let cache = new WeakMap<Station, Mark | null>(),
  cacheAt = -1;
export function markAt(s: Station): Mark | null {
  if (cacheAt !== marksVersion()) {
    cache = new WeakMap();
    cacheAt = marksVersion();
  }
  if (!cache.has(s)) cache.set(s, nearestMark(marks(), s.lat, s.lon));
  return cache.get(s)!;
}

/** start a mark (or edit one) at station i */
export function startMark(i: number, verdict: Verdict) {
  const r = STATE.results[i];
  if (!r || !r.view) return;
  draft = { key: keyOf(r.station), verdict, truth: verdict === 'right' ? r.view.top : null, how: null };
  render();
  document.querySelector('#verdict .mark')?.scrollIntoView({ block: 'nearest' });
}
function editMark(m: Mark) {
  draft = { key: keyOf(m), verdict: m.verdict, truth: m.truth, how: m.how, id: m.id, t: m.t };
  render();
}

async function save(r: StationResult, d: Draft) {
  const f = r.view!,
    i = STATE.results.indexOf(r),
    st = r.station,
    path = STATE.mode === 'path';
  const m: Mark = {
    id: d.id || newMarkId(),
    t: d.t || Date.now(),
    ...(d.id ? { edited: Date.now() } : {}),
    lat: st.lat,
    lon: st.lon,
    verdict: d.verdict,
    call: f.top,
    p: f.topP,
    truth: d.verdict === 'right' ? f.top : d.verdict === 'wrong' ? d.truth : null,
    how: d.how,
    parts: keepParts(r.parts || {}),
    prior: STATE.priorName,
    place:
      (r.sh.nom && r.sh.nom.display_name && r.sh.nom.display_name.split(',').slice(0, 2).join(',').trim()) ||
      null,
    link: hashFor() + (path ? `&at=${Math.round(st.d)}` : ''),
    station: i + 1,
    d: path ? Math.round(st.d * 10) / 10 : null,
    v: VERSION,
  };
  draft = null;
  await saveMark(m);
  toast(kept ? 'Mark saved in this browser' : 'Marked, but this browser won’t keep it after you leave');
  render();
}

/** the mark row under the answer: the question, the editor, or the saved mark */
export function markBox(r: StationResult): HTMLElement | null {
  const f = r.view;
  if (!f) return null;
  const st = r.station,
    saved = markAt(st);
  if (saved && editOnOpen === saved.id) {
    editOnOpen = null;
    draft = {
      key: keyOf(st),
      verdict: saved.verdict,
      truth: saved.truth,
      how: saved.how,
      id: saved.id,
      t: saved.t,
    };
  }
  const box = el('div', 'mark'),
    d = draft && draft.key === keyOf(st) ? draft : null;

  if (!d && saved) {
    const line = el('div', 'saved');
    line.append(el('span', 't ' + saved.verdict, TICK[saved.verdict]));
    const txt = el('span', 'x');
    if (saved.verdict === 'wrong' && saved.truth) {
      txt.append(`Called ${say(saved.call)}, really `, el('b', null, say(saved.truth)));
    } else
      txt.append(
        saved.verdict === 'right' ? `${NAME[saved.call]}, right` : `Not sure it's ${thing(saved.call)}`,
      );
    if (saved.how) txt.append(` · ${HOW[saved.how]}`);
    const ed = el('button', 'lnk', 'edit');
    ed.onclick = () => editMark(saved);
    line.append(txt, el('small', null, day(saved.t)), ed);
    box.append(line);
    return box;
  }

  const q = el('div', 'q'),
    ask = el('span');
  ask.append('Is it ', el('b', null, thing(f.top)), ' here?');
  q.append(ask);
  const vs = el('div', 'vs');
  for (const v of ['right', 'wrong', 'unsure'] as Verdict[]) {
    const b = el(
      'button',
      'v ' + v + (d && d.verdict === v ? ' on' : ''),
      `${TICK[v]} ${v === 'unsure' ? 'not sure' : v}`,
    );
    b.setAttribute('aria-pressed', String(!!d && d.verdict === v));
    b.onclick = () => {
      if (d) {
        d.verdict = v;
        d.truth = v === 'right' ? f.top : v === 'wrong' && d.truth === f.top ? null : d.truth;
        render();
      } else startMark(STATE.results.indexOf(r), v);
    };
    vs.append(b);
  }
  q.append(vs);
  box.append(q);
  if (!d) return box;

  if (d.verdict === 'wrong') {
    box.append(el('div', 'lbl', "What's really here"));
    const grid = el('div', 'grid');
    for (const c of CLASSES) {
      if (c.k === f.top) continue;
      const b = el('button', 'cl' + (d.truth === c.k ? ' on' : '')),
        sw = el('i');
      sw.style.background = COL[c.k];
      b.append(sw, document.createTextNode(c.n));
      b.setAttribute('aria-pressed', String(d.truth === c.k));
      b.onclick = () => {
        d.truth = c.k;
        render();
      };
      grid.append(b);
    }
    box.append(grid);
  }
  box.append(el('div', 'lbl', 'How do you know'));
  const chips = el('div', 'chips');
  for (const [k, label] of Object.entries(HOW) as [How, string][]) {
    const b = el('button', 'chip' + (d.how === k ? ' on' : ''), label);
    b.setAttribute('aria-pressed', String(d.how === k));
    b.onclick = () => {
      d.how = d.how === k ? null : k;
      render();
    };
    chips.append(b);
  }
  box.append(chips);

  const ledger = r.fused?.ledger || [],
    waiting = ledger.filter(l => l.status === 'wait').length,
    heard = ledger.filter(l => l.status === 'ok').length;
  const foot = el('div', 'foot');
  foot.append(
    el(
      'small',
      null,
      waiting
        ? `Waiting for ${waiting} source${waiting > 1 ? 's' : ''} to report`
        : `Kept in this browser · with ${heard} of ${SOURCES.length} sources' readings`,
    ),
  );
  if (d.id) {
    const del = el('button', 'btn', 'Delete');
    del.onclick = async () => {
      draft = null;
      await deleteMark(d.id!);
      toast('Mark deleted');
      render();
    };
    foot.append(del);
  }
  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = () => {
    draft = null;
    render();
  };
  const ok = el('button', 'btn pri', 'Save mark');
  ok.disabled = !!waiting || (d.verdict === 'wrong' && !d.truth);
  ok.onclick = () => save(r, d);
  foot.append(cancel, ok);
  box.append(foot);
  return box;
}

/* ---- the Marks menu -------------------------------------------------------- */

function openMark(m: Mark, edit = false) {
  closeMenus();
  editOnOpen = edit ? m.id : null;
  const i = STATE.stations.findIndex(s => markAt(s)?.id === m.id);
  /* already on screen: go to the station; otherwise open its link */
  if (i >= 0 && location.hash === m.link.replace(/&at=[\d.]+$/, '')) selectStation(i);
  else location.hash = m.link;
}

export function exportMarks(kind: 'geojson' | 'csv') {
  const list = marks(),
    date = new Date().toISOString().slice(0, 10);
  if (!list.length) return toast('No marks yet.');
  if (kind === 'csv') download(`underfoot-marks-${date}.csv`, marksCSV(list, SITE_URL), 'text/csv');
  else
    download(
      `underfoot-marks-${date}.geojson`,
      JSON.stringify(marksGeoJSON(list, SITE_URL), null, 1),
      'application/geo+json',
    );
}

export function showMarks() {
  const m = $('#marksMenu'),
    list = marks();
  m.textContent = '';
  if (!list.length)
    m.append(
      el(
        'div',
        'empty',
        'No marks yet. Under any answer, say whether it’s right or wrong; marks stay in this browser.',
      ),
    );
  for (const mk of list) {
    const row = el('div', 'mrow'),
      go = el('button', 'go'),
      head = el('span', 'row');
    head.append(el('span', 't ' + mk.verdict, TICK[mk.verdict]), el('b', null, markTitle(mk)));
    go.append(
      head,
      el(
        'small',
        null,
        [mk.place, mk.how ? HOW[mk.how] : null, day(mk.t), mk.d != null ? `line #${mk.station}` : null]
          .filter(Boolean)
          .join(' · '),
      ),
    );
    go.title = 'Open this sounding at the marked station';
    go.onclick = () => openMark(mk);
    const ed = el('button', 'lnk', 'edit');
    ed.onclick = () => openMark(mk, true);
    const del = el('button', 'lnk', 'delete');
    del.onclick = async e => {
      e.stopPropagation();
      if (del.dataset.sure) {
        await deleteMark(mk.id);
        showMarks();
        m.classList.add('on');
        render();
      } else {
        del.dataset.sure = '1';
        del.textContent = 'sure?';
      }
    };
    const act = el('span', 'act');
    act.append(ed, del);
    row.append(go, act);
    m.append(row);
  }
  if (list.length) {
    const foot = el('div', 'mfoot');
    foot.append(el('small', null, marksSummary(list)));
    for (const [k, label] of [
      ['geojson', 'GeoJSON'],
      ['csv', 'CSV'],
    ] as const) {
      const b = el('button', 'btn', label);
      b.title = `Export every mark as ${label}`;
      b.onclick = () => exportMarks(k);
      foot.append(b);
    }
    const fit = el('button', 'btn', 'Refit…');
    fit.title = 'Fit the source weights to your marks';
    fit.onclick = () => {
      closeMenus();
      openRefit();
    };
    foot.append(fit);
    m.append(foot);
  }
  m.classList.add('on');
  keepOnScreen(m);
}
