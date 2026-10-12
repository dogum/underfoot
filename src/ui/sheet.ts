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
import { stationNear, total } from './transect';

export const PHONE = '(max-width: 820px)';
export const isPhone = () => matchMedia(PHONE).matches;

type Height = 'peek' | 'half' | 'full';
type Tab = 'batch' | 'area' | 'answer' | 'route' | 'going' | 'years' | 'evidence';
const TABS: [Tab, string][] = [
  ['batch', 'Batch'],
  ['area', 'Area'],
  ['answer', 'Answer'],
  ['route', 'Route'],
  ['going', 'Going'],
  ['years', 'Years'],
  ['evidence', 'Evidence'],
];
const ORDER: Height[] = ['peek', 'half', 'full'];
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
};

function stored<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch {}
  return fallback;
}
function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

/* ------------------------------------------------------------------ heights */
/** the sheet's height in px at each stop, from what its head holds now */
function heights() {
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
    /* six tenths of what can be seen: the answer and the map side by side */
    half: Math.min(full, Math.max(peek + 140, dock + Math.round(seen * 0.6))),
    full,
    /* while a line or an outline is being drawn: the handle and the hint's Undo / Done above it */
    min: 22 + dock,
  };
}
/** the stop the sheet sits at now: the person's choice, or out of the way while drawing, or peek while walking with Here */
function current(): Height | 'min' {
  if (MAP.drawing && (STATE.mode === 'path' || STATE.mode === 'area')) return 'min';
  return SHEET.h;
}
function place(animate = true) {
  if (!isPhone()) return;
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
function setPx(px: number) {
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
  const box = $('#sheetTabs');
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
  $('#sheet').dataset.tab = SHEET.tab;
}
function pickTab(t: Tab) {
  SHEET.want = t;
  store('uf.tab', t);
  $('#sheetBody').scrollTop = 0;
  if (SHEET.h === 'peek') setHeight('half');
  syncSheet();
}

/* ---------------------------------------------------------------------- bar */
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
  bar.innerHTML =
    (line ? `<button class="sbArr" data-step="-1" aria-label="Previous station">‹</button>` : '') +
    `<div class="sbMid"><span class="sbSw" style="background:${colour}"></span>` +
    `<div class="sbNm"><b>${esc(name)}</b><span>${sub}</span></div>` +
    (pct ? `<span class="sbPc">${pct}<small>%</small></span>` : '') +
    `</div>` +
    (line ? `<button class="sbArr" data-step="1" aria-label="Next station">›</button>` : '');
}
const esc = (t: string) => t.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

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
  cv.height = Math.round(COMPACT_H * dpr);
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, COMPACT_H);
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
  renderTabs();
  renderBar();
  drawStrip();
  place();
}

/* the lock's hint on a phone shows for a few seconds, then the lock button alone says it */
const HINT = { timer: 0, text: '', faded: false };
export function fadeHint(locked: boolean) {
  const h = $('#hint');
  if (!isPhone() || !locked) {
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
  /* the head drags the sheet; a tap on the handle steps through the heights */
  let y0: number | null = null,
    h0 = 0,
    dragged = false,
    last = { y: 0, t: 0, v: 0 };
  /* a press on the head follows the pointer on the window, so a quick drag that
     leaves the head still moves the sheet, and taps on the tabs stay plain clicks */
  const move = (e: PointerEvent) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    if (!dragged && Math.abs(dy) < 6) return;
    if (!dragged) {
      dragged = true;
      sh.classList.add('drag');
    }
    const H = heights();
    setPx(Math.max(H.peek - 30, Math.min(H.full, h0 - dy)));
    const dt = Math.max(1, e.timeStamp - last.t);
    last = { y: e.clientY, t: e.timeStamp, v: (e.clientY - last.y) / dt };
  };
  const release = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', release);
    removeEventListener('pointercancel', release);
    if (y0 == null) return;
    y0 = null;
    if (!dragged) return;
    const H = heights(),
      i = ORDER.indexOf(SHEET.h);
    /* a flick goes one stop that way; a slow drag settles on the nearest */
    const next =
      Math.abs(last.v) > 0.5
        ? ORDER[Math.max(0, Math.min(2, i + (last.v < 0 ? 1 : -1)))]
        : ORDER.reduce((a, b) => (Math.abs(H[b] - SHEET.px) < Math.abs(H[a] - SHEET.px) ? b : a));
    SHEET.px = -1;
    setHeight(next);
  };
  head.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement;
    if (t.closest('#sheetStrip, .sbArr')) return;
    y0 = e.clientY;
    h0 = SHEET.px;
    dragged = false;
    last = { y: e.clientY, t: e.timeStamp, v: 0 };
    addEventListener('pointermove', move);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  });
  $('#sheetGrip').addEventListener('click', () => {
    if (dragged) return;
    setHeight(ORDER[(ORDER.indexOf(SHEET.h) + 1) % 3]);
  });
  $('#sheetBar').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.sbArr') as HTMLElement | null;
    if (b) selectStation(STATE.sel + Number(b.dataset.step));
    else if (!dragged && SHEET.h === 'peek') setHeight('half');
  });
  $('#sheetTabs').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (b && !dragged) pickTab(b.dataset.t as Tab);
  });
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
