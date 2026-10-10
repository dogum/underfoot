/**
 * "Over the years" under the answer (app/years, engine/years): one bar
 * per distinct capture in Esri's archive, smoothed across the years, the
 * change flagged with the two captures either side of it, and a strip of the
 * pictures themselves. Tapping a picture shows that capture on the map.
 */
import { yearsStation, scheduleYears, spotKey } from '../app/years';
import { STATE } from '../app/state';
import { COL, NAME } from '../core/classes';
import { $, el } from '../core/dom';
import { YEAR_CLASSES, yearsWords, monthYear } from '../engine/years';
import type { Years } from '../engine/years';
import { MAP, mapDraw } from '../map/map';

const NS = 'http://www.w3.org/2000/svg';
const say = (i: number) => NAME[YEAR_CLASSES[i]].split(' /')[0].toLowerCase();
const topOf = (v: number[]) => v.indexOf(Math.max(...v));

const shownRel = () => (String(MAP.src).startsWith('wb:') ? +String(MAP.src).slice(3) : null);
/** the map shows this capture (its release), or today's imagery */
function setMapCapture(rel: number | null) {
  MAP.src = rel == null ? 'sat' : `wb:${rel}`;
  const cap = rel == null ? null : STATE.years?.h?.caps.find(c => c.rel === rel),
    badge = $('#capBadge');
  badge.hidden = !cap;
  if (cap) {
    badge.textContent = '';
    const back = el('button', null, 'Today');
    back.onclick = () => showCapture(null);
    badge.append(el('span', null, `Captured ${monthYear(cap.date)}`), back);
  }
  mapDraw();
}
export function showCapture(rel: number | null) {
  setMapCapture(rel);
  renderYears();
}

function bars(h: Years): SVGSVGElement {
  const n = h.caps.length,
    W = 430,
    H = 150,
    top = 6,
    base = 126,
    slot = W / n,
    bw = Math.min(36, slot * 0.7);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'histbars');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `The ground by capture: ${h.caps.map((c, t) => `${c.date.slice(0, 7)} ${say(topOf(h.g[t]))}`).join(', ')}`,
  );
  const add = (tag: string, a: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
    svg.append(e);
    return e;
  };
  h.caps.forEach((c, t) => {
    const x = slot * t + (slot - bw) / 2;
    let y = base;
    YEAR_CLASSES.forEach((k, i) => {
      const hgt = h.g[t][i] * (base - top);
      if (hgt < 0.4) return;
      y -= hgt;
      const r = add('rect', { x, y, width: bw, height: hgt, fill: COL[k] });
      const tt = document.createElementNS(NS, 'title');
      tt.textContent = `${monthYear(c.date)}: ${say(i)} ${Math.round(h.g[t][i] * 100)}%`;
      r.append(tt);
    });
    add('text', { x: slot * t + slot / 2, y: base + 16, class: 'yr', 'text-anchor': 'middle' }).textContent =
      c.date.slice(0, 4);
  });
  for (const f of h.flags) {
    const x = slot * (f.i + 1);
    add('line', { x1: x, x2: x, y1: top - 4, y2: base + 2, class: 'chg' });
  }
  return svg;
}

function strip(h: Years, thumbs: ImageData[]): HTMLElement {
  const box = el('div', 'histstrip');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'The captures: tap one to show it on the map');
  h.caps.forEach((c, t) => {
    const b = el('button', 'cap') as HTMLButtonElement,
      cv = el('canvas') as HTMLCanvasElement,
      on = MAP.src === `wb:${c.rel}`,
      own = topOf(c.p);
    cv.width = cv.height = 48;
    if (thumbs[t]) cv.getContext('2d')!.putImageData(thumbs[t], 0, 0);
    const dot = el('i');
    dot.style.background = COL[YEAR_CLASSES[topOf(h.g[t])]];
    b.append(cv, el('span', 'd', c.date.slice(0, 7)), dot);
    b.setAttribute('aria-pressed', String(on));
    b.title =
      `${monthYear(c.date)}${c.src ? ` · ${c.src}` : ''}${c.res ? ` · ${c.res} m/px` : ''}` +
      ` · on its own ${say(own)} ${Math.round(c.p[own] * 100)}% · tap to show it on the map`;
    b.onclick = () => showCapture(on ? null : c.rel);
    box.append(b);
  });
  const today = el('button', 'cap today', 'Today') as HTMLButtonElement;
  today.setAttribute('aria-pressed', String(!String(MAP.src).startsWith('wb:')));
  today.title = "Today's imagery";
  today.onclick = () => showCapture(null);
  box.append(today);
  return box;
}

export function renderYears() {
  const box = $('#years');
  if (!box) return;
  const st = yearsStation(),
    hs = STATE.years,
    mine = !!st && !!hs && hs.key === spotKey(st.lat, st.lon);
  box.hidden = !st;
  /* back to today's imagery once the capture on the map isn't one of this spot's */
  const rel = shownRel();
  if (rel != null && !(mine && hs!.h?.caps.some(c => c.rel === rel))) setMapCapture(null);
  if (!st) return;
  scheduleYears();
  box.textContent = '';
  const head = el('header');
  head.append(el('span', 'lbl', 'Over the years'), el('span', 'rule'));
  box.append(head);
  if (!mine || !hs || hs.status === 'reading') {
    const p = el('p', 'help');
    p.textContent =
      mine && hs?.found
        ? `Reading Esri's archive: ${hs.read} of ${hs.found} captures.`
        : "Reading Esri's archive of past imagery for this spot.";
    box.append(p);
    return;
  }
  if (hs.status !== 'done' || !hs.h) {
    box.append(
      el(
        'p',
        'help',
        hs.status === 'none'
          ? 'Esri has no archived z18 imagery here.'
          : `Esri's archive didn't answer (${hs.err}).`,
      ),
    );
    return;
  }
  const h = hs.h,
    caps = h.caps;
  head.append(
    el(
      'span',
      'hint',
      `${caps.length} capture${caps.length > 1 ? 's' : ''} · ${caps[0].date.slice(0, 4)}–${caps.at(-1)!.date.slice(0, 4)}`,
    ),
  );
  if (caps.length > 1) box.append(bars(h));
  const flag = el('p', 'histflag'),
    words = yearsWords(h);
  if (h.flags.length) {
    flag.append(el('b', null, 'Changed'), document.createTextNode(words.replace(/^Changed/, '')));
  } else flag.append(document.createTextNode(words));
  flag.append(el('span', 'src', ' Imagery only; the map and rasters describe today.'));
  box.append(flag, strip(h, hs.thumbs));
}
