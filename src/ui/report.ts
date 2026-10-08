/**
 * The route surface report, as a card above the transect: what the line runs
 * over by length, what it crosses, its climb, the longest stretch of each
 * call, and the stations it's unsure about (engine/report). Open on a tall
 * screen; elsewhere one line and the bar until tapped, so the map keeps its
 * room. The choice is remembered on the device.
 */
import { selectStation } from '../app/actions';
import { STATE } from '../app/state';
import { COL, NAME } from '../core/classes';
import { $, TOUCH, el } from '../core/dom';
import { fmt } from '../core/math';
import { currentReport } from '../io/export';
import type { ClassKey } from '../core/types';
import type { RouteReport } from '../engine/report';

const dist = (m: number) => (m >= 1000 ? fmt(m / 1000, 2) + ' km' : Math.round(m) + ' m');
const short = (k: ClassKey) => NAME[k].split(/[ /]/)[0].toLowerCase();
const CROSSED: Partial<Record<ClassKey, [string, string]>> = {
  paved: ['road', 'roads'],
  path: ['path', 'paths'],
  rail: ['railway', 'railways'],
  water: ['stream or river', 'streams and rivers'],
  building: ['building', 'buildings'],
};

function isOpen(): boolean {
  try {
    const v = localStorage.getItem('uf.report');
    if (v != null) return v === '1';
  } catch {}
  return !TOUCH && innerHeight >= 1000;
}
function setOpen(on: boolean) {
  try {
    localStorage.setItem('uf.report', on ? '1' : '0');
  } catch {}
  renderReport();
}

export function crossingsText(r: RouteReport): string {
  return r.crossings.map(c => `${c.n} ${(CROSSED[c.cls] || [c.cls, c.cls])[c.n === 1 ? 0 : 1]}`).join(' · ');
}

export function renderReport() {
  const box = $('#report');
  if (!box) return;
  /* the card appears with the transect, before anything has been read, so the
     map moves once when a line is drawn rather than again when answers land */
  const r = STATE.mode === 'path' && STATE.stations.length > 1 ? currentReport() : null;
  box.hidden = !r;
  if (!r) return;
  const open = isOpen(),
    n = r.crossings.reduce((a, c) => a + c.n, 0),
    reading = !r.classes.length;
  box.textContent = '';
  box.className = open ? 'open' : '';

  const head = el('button', 'rhead');
  head.setAttribute('aria-expanded', String(open));
  head.title = open ? 'Fold the route report' : 'Open the route report';
  head.append(
    el('span', 'lbl', 'Route'),
    el(
      'span',
      'mono',
      reading
        ? `${dist(r.length)} · reading the line…`
        : open
          ? `${dist(r.length)} · ${r.classes.length} kinds of ground${r.pending > 1 ? ` · ${dist(r.pending)} still reading` : ''}`
          : [
              dist(r.length),
              ...r.classes.slice(0, 3).map(c => `${short(c.cls)} ${Math.round(c.share * 100)}%`),
              `${n} crossing${n === 1 ? '' : 's'}`,
            ].join(' · '),
    ),
    el('span', 'car', open ? '▴' : '▾'),
  );
  head.onclick = () => setOpen(!open);
  box.append(head);

  const bar = el('div', 'rbar');
  for (const c of r.classes) {
    const i = el('i');
    i.style.flex = String(c.m);
    i.style.background = COL[c.cls];
    i.title = `${NAME[c.cls]} ${dist(c.m)}`;
    bar.append(i);
  }
  box.append(bar);
  if (!open) return;

  const leg = el('div', 'rleg');
  if (reading) leg.append(el('span', null, ' '));
  for (const c of r.classes) {
    const s = el('span'),
      b = el('b');
    b.style.background = COL[c.cls];
    s.append(
      b,
      document.createTextNode(NAME[c.cls] + ' '),
      el('em', null, `${dist(c.m)} · ${Math.round(c.share * 100)}%`),
    );
    leg.append(s);
  }
  box.append(leg);

  const grid = el('div', 'rgrid'),
    col = (k: string, v: string, small: string | HTMLElement) => {
      const d = el('div');
      const t = typeof small === 'string' ? el('small', 'one', small) : small;
      if (typeof small === 'string') t.title = small;
      d.append(el('span', 'lbl', k), el('b', null, v), t);
      grid.append(d);
    };
  if (reading) {
    for (const k of ['Crosses', 'Elevation', 'Longest stretch', 'Unsure']) col(k, '…', ' ');
    box.append(grid);
    return;
  }
  col('Crosses', crossingsText(r) || 'nothing mapped', r.crossings.flatMap(c => c.names).join(', '));
  const st = r.steepest;
  col(
    'Elevation',
    r.climb == null ? 'pending' : `+${Math.round(r.climb)} m · −${Math.round(r.descent ?? 0)} m`,
    st
      ? `steepest ${Math.round(Math.abs(st.grade) * 100)}% ${st.grade > 0 ? 'up' : 'down'}, ${Math.round(st.d0)}–${Math.round(st.d1)} m`
      : '',
  );
  col(
    'Longest stretch',
    r.classes
      .slice()
      .sort((a, b) => b.longest.m - a.longest.m)
      .slice(0, 3)
      .map(c => `${short(c.cls)} ${dist(c.longest.m)}`)
      .join(' · '),
    'unbroken runs of one call',
  );
  const unsure = el('small');
  if (!r.doubtful.length) unsure.textContent = 'no station under 40% confidence';
  else
    for (const x of r.doubtful.slice(0, 8)) {
      const b = el('button', 'rdoubt', `#${x.i + 1} ${short(x.top)} ${Math.round(x.conf * 100)}`);
      b.title = `Station ${x.i + 1}, ${Math.round(x.d)} m along: ${NAME[x.top]}, confidence ${Math.round(x.conf * 100)}`;
      b.onclick = () => selectStation(x.i);
      unsure.append(b);
    }
  col('Unsure', r.doubtful.length ? String(r.doubtful.length) : 'none', unsure);
  box.append(grid);
}
