/**
 * The phone's sheet (820 px and narrower). The map fills the screen and the
 * answer sits in a sheet over it at three heights: peek (the station in focus
 * and its call), half (the answer beside the map) and full (for reading). The
 * sheet's head holds the line's strip, the station with ‹ ›, and the tabs; its
 * body is the one thing that scrolls. On a desktop the wrappers are
 * display: contents and nothing here changes the layout.
 */
import { selectStation } from '../app/actions';
import { liveOn } from '../app/live';
import { STATE } from '../app/state';
import { COL, K, NAME } from '../core/classes';
import { $, el } from '../core/dom';
import { fmt } from '../core/math';
import { DOUBT_AT } from '../engine/doubt';
import { spanBounds } from '../engine/report';
import { MAP, mapDraw, toLatLon, toScreen } from '../map/map';
import { COMPACT_H, drawCompact } from './compact';
import { markAt, markThing, marking } from './marks';
import { dragInit } from './sheetdrag';
import { stationNear, total } from './transect';

export const PHONE = '(max-width: 820px)';
export const isPhone = () => matchMedia(PHONE).matches;

export type Height = 'peek' | 'half' | 'full';
export type Tab = 'batch' | 'area' | 'answer' | 'route' | 'going' | 'years' | 'evidence';
const TABS: [Tab, string][] = [
  ['batch', 'Batch'],
  ['area', 'Area'],
  ['answer', 'Answer'],
  ['route', 'Route'],
  ['going', 'Going'],
  ['years', 'Years'],
  ['evidence', 'Evidence'],
];
export const ORDER: Height[] = ['peek', 'half', 'full'];
/** the strip's margins inside its canvas: room for the CALL label on the left */
const STRIP = { l: 34, r: 8 };

export const SHEET = {
  /* never back at full on a new visit: the map comes first */
  h: stored<Height>('uf.sheet', ['peek', 'half'], 'half'),
  /** the tab asked for, kept on the device, and the one showing (the first on offer when that one isn't) */
  want: stored<Tab>(
    'uf.tab',
    TABS.map(t => t[0]),
    'answer',
  ),
  tab: 'answer' as Tab,
  /** the sheet's height in px, as last placed */
  px: 0,
  /** what the tabs offered last time, so a new card (an area, a batch) can come forward */
  had: new Set<Tab>(),
  live: false,
  /** a finger is moving the sheet: a redraw meanwhile (a source landing, a new fix) mustn't put it back */
  dragging: false,
  /** the height before a mark's editor opened, to go back to once it's kept or cancelled */
  before: null as Height | null,
  wasMarking: false,
};

function stored<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch {}
  return fallback;
}
export function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

/* ------------------------------------------------------------------ heights */
/** the sheet's height in px at each stop, from what its head holds now */
export function heights() {
  const app = $('#app').clientHeight,
    top = $('#topbar').offsetHeight,
    dock = ($('#sheetDock') as HTMLElement | null)?.offsetHeight ?? 0,
    head = $('#sheetHead').offsetHeight,
    tabs = $('#sheetTabs').offsetHeight,
    full = Math.max(200, app - top - 56),
    peek = Math.min(full, head - tabs + dock + 2),
    /* what the person can see between the topbar and the browser's toolbar */
    seen = app - top - dock;
  return {
    peek,
    /* a little over half of what can be seen: the answer and the map side by side */
    half: Math.min(full, Math.max(peek + 140, dock + Math.round(seen * 0.62))),
    full,
    /* while a line or an outline is being drawn: the handle and the hint's Undo / Done above it */
    min: $('#sheetGrip').offsetHeight + dock,
  };
}
/** before a fit: the inset for the height the sheet is about to take (say, back up from its handle once a drawing is replaced) */
export function settleInset() {
  if (isPhone()) MAP.inset = Math.min(heights()[current()], heights().half);
}
/** the stop the sheet sits at now: the person's choice, or out of the way while drawing, or peek while walking with Here */
function current(): Height | 'min' {
  if (MAP.drawing && (STATE.mode === 'path' || STATE.mode === 'area')) return 'min';
  return SHEET.h;
}
function place(animate = true) {
  if (!isPhone() || SHEET.dragging) return;
  const sh = $('#sheet'),
    px = heights()[current()];
  $('#sheetGrip').setAttribute('aria-label', `Sheet: ${current()}. Tap to change its height`);
  $('#app').dataset.sheet = current();
  if (px === SHEET.px && sh.style.height) return;
  sh.classList.toggle('drag', !animate);
  setPx(px);
  /* the station in focus stays in view once the sheet has moved */
  setTimeout(keepInView, animate ? 300 : 0);
}
export function setPx(px: number) {
  SHEET.px = px;
  $('#sheet').style.height = px + 'px';
  document.documentElement.style.setProperty('--sheet-h', px + 'px');
  /* a fit leaves the line in view above the sheet at half height, even with the sheet all the way up */
  MAP.inset = Math.min(px, heights().half);
}
export function setHeight(h: Height) {
  SHEET.h = h;
  store('uf.sheet', h);
  place();
}

/** keep the station in focus on the part of the map the sheet doesn't cover */
export function keepInView() {
  if (!isPhone()) return;
  const s = STATE.stations[STATE.sel];
  if (!s || !MAP.W) return;
  /* only when it's off the map's open part, and then the least move that brings it back */
  const [, y] = toScreen(s.lat, s.lon),
    bottom = MAP.H - SHEET.px;
  if (y >= 12 && y <= bottom - 12) return;
  const want = y < 12 ? 56 : Math.max(56, bottom - 48),
    c = toLatLon(MAP.W / 2, MAP.H / 2 + (y - want));
  MAP.lat = c.lat;
  MAP.lon = c.lon;
  mapDraw();
}

/* --------------------------------------------------------------------- tabs */
function offered(): Tab[] {
  const shown = (s: string) => {
    const e = $(s);
    return !!e && !e.hidden;
  };
  const one = STATE.stations.length > 0 && STATE.mode !== 'batch';
  const has: Record<Tab, boolean> = {
    batch: STATE.mode === 'batch',
    area: shown('#areaCard'),
    answer: one,
    route: $('#transect').classList.contains('on'),
    going: one && shown('#going'),
    years: one && shown('#years'),
    evidence: one,
  };
  return TABS.map(t => t[0]).filter(t => has[t]);
}
function renderTabs() {
  const tabs = offered(),
    fresh = tabs.find(t => (t === 'batch' || t === 'area') && !SHEET.had.has(t));
  if (fresh) SHEET.want = fresh;
  SHEET.tab = tabs.includes(SHEET.want) ? SHEET.want : tabs[0] || 'answer';
  SHEET.had = new Set(tabs);
  const box = $('#sheetTabs'),
    key = tabs.join() + '|' + SHEET.tab;
  $('#sheet').dataset.tab = SHEET.tab;
  /* rebuilt only when they change, so a tap during a sounding's redraws lands on the button it began on */
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.hidden = tabs.length < 2;
  box.replaceChildren(
    ...tabs.map(t => {
      const b = el('button', null, TABS.find(x => x[0] === t)![1]);
      b.dataset.t = t;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === SHEET.tab));
      return b;
    }),
  );
}
export function pickTab(t: Tab) {
  SHEET.want = t;
  store('uf.tab', t);
  $('#sheetBody').scrollTop = 0;
  if (SHEET.h === 'peek') setHeight('half');
  syncSheet();
}

/* ---------------------------------------------------------------------- bar */
let barHtml = '';
/** the station in focus: its call and percentage, and ‹ › along a line */
function renderBar() {
  const bar = $('#sheetBar'),
    n = STATE.stations.length,
    line = STATE.mode === 'path' && n > 1;
  bar.hidden = STATE.mode === 'batch';
  bar.classList.toggle('line', line);
  const r = STATE.results[STATE.sel],
    v = r?.view,
    s = STATE.stations[STATE.sel];
  let name = '',
    sub = '',
    pct = '',
    colour = 'transparent';
  if (!n) {
    name = 'No probe set';
    sub = STATE.mode === 'path' ? 'Tap the map to start a line' : 'Tap the map to read the ground there';
  } else if (!v) {
    name = 'Reading…';
    sub = 'the sources are coming in';
  } else {
    const order = K.map((k, i) => [k, v.p[i]] as const).sort((a, b) => b[1] - a[1]),
      lit = (r.doubt?.score ?? 0) >= DOUBT_AT;
    name = (s?.x ? '× ' : '') + NAME[v.top];
    colour = COL[v.top];
    pct = String(Math.round(v.topP * 100));
    const where = line
      ? `#${STATE.sel + 1} of ${n} · ${fmt(s.d, 0)} m${s.x ? ' · a crossing' : ''}`
      : ($('#readout .place')?.textContent || '').trim() ||
        `then ${NAME[order[1][0]].toLowerCase()} ${Math.round(order[1][1] * 100)}%`;
    sub =
      (lit ? '<i class="sbLit" title="Worth a look"></i>' : '') + esc((liveOn() ? 'Here · ' : '') + where);
  }
  const html =
    (line ? `<button class="sbArr" data-step="-1" aria-label="Previous station">‹</button>` : '') +
    `<div class="sbMid"><span class="sbSw" style="background:${colour}"></span>` +
    `<div class="sbNm"><b>${esc(name)}</b><span>${sub}</span></div>` +
    (pct ? `<span class="sbPc">${pct}<small>%</small></span>` : '') +
    `</div>` +
    (line ? `<button class="sbArr" data-step="1" aria-label="Next station">›</button>` : '');
  /* likewise: only when what it says has changed */
  if (barHtml !== html) {
    barHtml = html;
    bar.innerHTML = html;
  }
}
const esc = (t: string) => t.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

/* --------------------------------------------------------------------- mark */
let markHtml = '';
const TICKS = { right: '✓ Right', wrong: '✗ Wrong', unsure: '? Not sure' } as const,
  SAVED = { right: '✓ Marked right', wrong: '✗ Marked wrong', unsure: '? Marked not sure' } as const;
/** right / wrong / not sure for the station in focus, under its call: answered without leaving the map */
function renderMark() {
  const box = $('#sheetMark'),
    r = STATE.results[STATE.sel],
    v = r?.view,
    show = !!v && STATE.mode !== 'batch' && STATE.mode !== 'area';
  box.hidden = !show;
  if (!show) return;
  const saved = markAt(r.station);
  let html: string;
  if (marking())
    html = `<span class="mq">Marking this spot${liveOn() ? '; Here waits' : ''}</span><button data-m="open" class="v">Finish ›</button>`;
  else if (saved)
    html =
      `<span class="mq done ${saved.verdict}">${SAVED[saved.verdict]}` +
      (saved.verdict === 'wrong' && saved.truth ? `: really ${esc(NAME[saved.truth].toLowerCase())}` : '') +
      `</span><button data-m="edit" class="v">Edit</button>`;
  else
    html =
      `<span class="mq">Is it <b>${esc(markThing(v.top))}</b> here?</span>` +
      (['right', 'wrong', 'unsure'] as const)
        .map(k => `<button data-m="${k}" class="v ${k}">${TICKS[k]}</button>`)
        .join('');
  if (html !== markHtml) {
    markHtml = html;
    box.innerHTML = html;
  }
}

/* -------------------------------------------------------------------- strip */
const sx = (d: number, W: number) => STRIP.l + (total() > 0 ? d / total() : 0) * (W - STRIP.l - STRIP.r);
/** the line in one row at the top of the sheet: drag along it to move between stations */
export function drawStrip() {
  const cv = $('#sheetStrip') as HTMLCanvasElement | null;
  if (!cv) return;
  const on = isPhone() && STATE.mode === 'path' && STATE.stations.length > 1;
  cv.hidden = !on;
  if (!on || !cv.clientWidth) return;
  const dpr = Math.min(2, devicePixelRatio || 1),
    W = cv.clientWidth;
  cv.width = Math.round(W * dpr);
  const H = cv.clientHeight || COMPACT_H;
  cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  drawCompact(g, d => sx(d, W), spanBounds(STATE.stations), null);
}
function stripPick(x: number) {
  const cv = $('#sheetStrip') as HTMLCanvasElement,
    r = cv.getBoundingClientRect(),
    f = (x - r.left - STRIP.l) / Math.max(1, r.width - STRIP.l - STRIP.r),
    i = stationNear(Math.max(0, Math.min(1, f)) * total());
  if (i != null && i !== STATE.sel) selectStation(i);
}

/* --------------------------------------------------------------------- sync */
/** bring the sheet up to date with the sounding: called after every render */
export function syncSheet() {
  if (!isPhone()) return;
  const live = liveOn();
  if (live && !SHEET.live) SHEET.h = 'peek';
  SHEET.live = live;
  /* a mark kept or cancelled: back to where the sheet was before its editor opened */
  const m = marking();
  if (SHEET.wasMarking && !m && SHEET.before) {
    SHEET.h = SHEET.before;
    SHEET.before = null;
  }
  SHEET.wasMarking = m;
  renderTabs();
  renderBar();
  renderMark();
  drawStrip();
  place();
}

/* a hint on a phone shows for a few seconds and then leaves the map alone; one
   with Undo and Done (a line or an outline being drawn) stays while it's needed */
const HINT = { timer: 0, text: '', faded: false };
export function fadeHint() {
  const h = $('#hint');
  if (!isPhone() || h.hidden || h.querySelector('[data-act=undo], [data-act=done]')) {
    clearTimeout(HINT.timer);
    Object.assign(HINT, { timer: 0, text: '', faded: false });
    return;
  }
  if (h.innerHTML !== HINT.text) {
    clearTimeout(HINT.timer);
    Object.assign(HINT, { text: h.innerHTML, faded: false });
    HINT.timer = window.setTimeout(() => {
      HINT.faded = true;
      $('#hint').hidden = true;
    }, 3500);
  } else if (HINT.faded) h.hidden = true;
}

/* --------------------------------------------------------------------- init */
export function sheetInit() {
  const sh = $('#sheet'),
    head = $('#sheetHead');
  const dock = el('i', null);
  dock.id = 'sheetDock';
  sh.append(dock);
  dragInit();
  /* the strip: press and drag along it */
  const cv = $('#sheetStrip');
  let scrub = false;
  cv.addEventListener('pointerdown', e => {
    scrub = true;
    cv.setPointerCapture(e.pointerId);
    stripPick(e.clientX);
  });
  cv.addEventListener('pointermove', e => scrub && stripPick(e.clientX));
  const stop = () => (scrub = false);
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);
  new ResizeObserver(() => drawStrip()).observe(cv);
  /* the map's basemap and overlays fold behind one button on a phone */
  const tools = $('#maptools'),
    lb = $('#layersBtn');
  const fold = (open: boolean) => {
    tools.classList.toggle('open', open);
    lb.setAttribute('aria-expanded', String(open));
  };
  lb.addEventListener('click', () => fold(!tools.classList.contains('open')));
  $('#map').addEventListener('pointerdown', () => fold(false));
  /* the credits fold to one line on a phone; a tap shows them all */
  $('#attrib').addEventListener('click', () => $('#attrib').classList.toggle('open'));
  /* turning a phone or resizing a window across the line */
  new ResizeObserver(() => place(false)).observe($('#app'));
  matchMedia(PHONE).addEventListener('change', () => {
    if (isPhone()) return syncSheet();
    sh.style.height = '';
    document.documentElement.style.removeProperty('--sheet-h');
    MAP.inset = 0;
    fold(false);
  });
}
