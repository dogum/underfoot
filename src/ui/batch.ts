/**
 * Batch points on screen (app/batch): the Batch card with progress, the
 * table least sure first, CSV and GeoJSON out; and the bar that brings a
 * batch back after a point is opened or the tab was closed.
 */
import { discardBatch, openRow, pauseBatch, resumeBatch, savedBatch } from '../app/batch';
import type { BatchState } from '../app/batch';
import { STATE } from '../app/state';
import { COL, NAME } from '../core/classes';
import { $, el } from '../core/dom';
import { leastSureFirst } from '../engine/batch';
import { batchCSV, batchGeoJSON } from '../io/batch';
import { download } from '../io/export';

/** rows shown before "Show all" */
const FIRST = 100;
let showAll = false,
  drawn = '';

const say = (k: string) => NAME[k as keyof typeof NAME].split(' /')[0].toLowerCase();
const pct = (p: number) => Math.round(p * 100) + '%';
const read = (B: BatchState) => B.rows.filter(Boolean).length;
function took(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
const base = (B: BatchState) => B.name.replace(/\.[^.]+$/, '') || 'batch';

function status(B: BatchState): string {
  const n = B.pts.length,
    k = read(B);
  if (B.status === 'done') return `${n} points · all read in ${took(B.ms)}`;
  if (B.status === 'paused') return `${n} points · ${k} read · paused`;
  return `${n} points · reading ${Math.min(k + (B.groups[B.next]?.length ?? 0), n)} of ${n}`;
}

export function renderBatch() {
  const box = $('#batchCard');
  if (!box) return;
  const B = STATE.batch;
  box.hidden = STATE.mode !== 'batch' || !B;
  $('#panels').classList.toggle('batch', !box.hidden);
  if (box.hidden || !B) return;
  /* the table changes only when a group lands, or the focus or view moves: not on every tick */
  const sig = `${B.name}|${B.next}|${B.status}|${B.focus}|${showAll}|${read(B)}`;
  if (sig === drawn && box.childElementCount) return;
  drawn = sig;
  box.textContent = '';
  const h = el('header');
  h.append(el('span', 'lbl', 'Batch'), el('span', 'rule'), el('span', 'hint', B.name));
  box.append(h);
  const n = B.pts.length,
    k = read(B);
  box.append(el('div', 'bstat mono', status(B)));
  const bar = el('div', 'bbar'),
    fill = el('i');
  fill.style.width = `${(100 * k) / n}%`;
  bar.append(fill);
  box.append(bar);
  if (B.dropped)
    box.append(
      el(
        'p',
        'help',
        `The file had ${B.dropped.toLocaleString('en-US')} more points; a batch reads ${n.toLocaleString('en-US')}.`,
      ),
    );

  const acts = el('div', 'bacts');
  const btn = (t: string, f: () => void, title: string) => {
    const b = el('button', 'btn', t);
    b.title = title;
    b.onclick = f;
    acts.append(b);
    return b;
  };
  btn(
    'CSV',
    () => download(`${base(B)}-underfoot.csv`, batchCSV(B.pts, B.rows, B.cols), 'text/csv'),
    'Every point with its call, in the file’s order',
  );
  btn(
    'GeoJSON',
    () =>
      download(
        `${base(B)}-underfoot.geojson`,
        JSON.stringify(batchGeoJSON(B.pts, B.rows)),
        'application/geo+json',
      ),
    'Every point as a feature with its call',
  );
  if (B.status === 'reading')
    btn('Resume later', pauseBatch, 'Stop after this group; it’s kept in this browser');
  else if (B.status === 'paused') btn('Resume', () => resumeBatch(B), 'Read the rest');
  btn('Put away', discardBatch, 'Forget this batch, here and in this browser');
  box.append(acts);

  if (!k) {
    box.append(
      el('p', 'help', 'Points nearby are read together, up to 40 at a time. The least sure come to the top.'),
    );
    return;
  }
  box.append(
    el(
      'p',
      'help',
      'Least sure first. Open a point for its full answer, with the place name; the batch waits while you look.',
    ),
  );
  const order = leastSureFirst(B.rows).filter(i => B.rows[i]),
    shown = showAll ? order : order.slice(0, FIRST);
  const tbl = el('table', 'btbl'),
    th = el('tr');
  for (const t of ['#', 'Point', 'Call', 'Then', 'Src']) th.append(el('th', t === 'Src' ? 'wide' : null, t));
  tbl.append(th);
  shown.forEach((i, rank) => {
    const r = B.rows[i]!,
      p = B.pts[i],
      tr = el('tr');
    tr.dataset.i = String(i);
    if (B.focus === i) tr.classList.add('on');
    const call = el('td', 'call'),
      dot = el('i');
    dot.style.background = COL[r.call];
    call.append(dot, document.createTextNode(`${say(r.call)} ${pct(r.p)}`));
    const pt = el('td', 'pt');
    pt.append(
      el('b', null, p.name ?? `Point ${i + 1}`),
      el('span', null, `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`),
    );
    tr.append(el('td', 'n', rank + 1), pt, call, el('td', 'then', say(r.then)), el('td', 'n wide', r.src));
    tr.title = `Open ${p.name ?? `point ${i + 1}`}: its full answer, with the place name`;
    tr.tabIndex = 0;
    tr.onclick = () => openRow(i);
    tr.onkeydown = e => {
      if (e.key === 'Enter') openRow(i);
    };
    tbl.append(tr);
  });
  box.append(tbl);
  if (order.length > FIRST) {
    const more = el(
      'button',
      'btn more',
      showAll ? `Show the least sure ${FIRST}` : `Show all ${order.length}`,
    );
    more.onclick = () => {
      showAll = !showAll;
      renderBatch();
    };
    box.append(more);
  }
  if (B.focus != null) box.querySelector(`tr[data-i="${B.focus}"]`)?.scrollIntoView({ block: 'nearest' });
}

/** outside batch mode: a way back to the batch that's open, or to the one kept from last time */
export function renderBatchBar() {
  const bar = $('#batchBar');
  if (!bar) return;
  const B = STATE.batch || savedBatch();
  bar.hidden = !B || STATE.mode === 'batch';
  if (bar.hidden || !B) return;
  bar.textContent = '';
  const k = read(B),
    n = B.pts.length;
  bar.append(
    el(
      'span',
      'mono',
      B.status === 'done'
        ? `Batch: ${n} points, all read`
        : `Batch: ${k} of ${n} read${STATE.batch ? '' : ', kept from last time'}`,
    ),
  );
  const go = el(
    'button',
    'btn pri',
    B.status === 'done' ? 'Back to the batch' : STATE.batch ? 'Back to the batch' : 'Resume',
  );
  go.onclick = () => resumeBatch(B);
  const away = el('button', 'btn', 'Put away');
  away.onclick = discardBatch;
  bar.append(go, away);
}
