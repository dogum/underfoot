/**
 * Moving the phone's sheet (ui/sheet): a drag or a flick on its head, or on
 * its body while it's below full (at full the body scrolls), and a tap on the
 * handle. Also the taps on the head's buttons: ‹ ›, the tabs, and right /
 * wrong / not sure, which must not fire at the end of a drag. Until the sheet
 * has been moved once on this device, its handle pulses.
 */
import { selectStation } from '../app/actions';
import { STATE } from '../app/state';
import { $ } from '../core/dom';
import { editAt, quickMark } from './marks';
import { ORDER, SHEET, heights, pickTab, setHeight, setPx, store, type Height, type Tab } from './sheet';

const MOVED = 'uf.sheetMoved';
let dragged = false;

/** the stop a drag ends on: a flick goes one stop its way, a slow drag settles on the nearest */
function settle(v: number) {
  SHEET.dragging = false;
  const H = heights(),
    i = ORDER.indexOf(SHEET.h);
  const next: Height =
    Math.abs(v) > 0.5
      ? ORDER[Math.max(0, Math.min(2, i + (v < 0 ? 1 : -1)))]
      : ORDER.reduce((a, b) => (Math.abs(H[b] - SHEET.px) < Math.abs(H[a] - SHEET.px) ? b : a));
  SHEET.px = -1;
  moved(next);
}
/** the person moved the sheet: remember it, and the handle stops asking */
function moved(h: Height) {
  setHeight(h);
  $('#sheetGrip').classList.remove('nudge');
  store(MOVED, '1');
}
function follow(h0: number, dy: number) {
  const H = heights();
  setPx(Math.max(H.peek - 30, Math.min(H.full, h0 - dy)));
}

export function dragInit() {
  const sh = $('#sheet'),
    head = $('#sheetHead'),
    body = $('#sheetBody');
  try {
    if (localStorage.getItem(MOVED) !== '1') $('#sheetGrip').classList.add('nudge');
  } catch {}

  /* a press on the head, or on the body below full, follows the pointer on the
     window, so a quick drag that leaves the sheet still moves it, and taps on its
     buttons stay clicks. On the body the drag has to be mostly vertical: a
     sideways one is the browser's, to pan a wide table (styles/phone.css lets it
     pan the body only sideways below full; at full the body scrolls) */
  let y0: number | null = null,
    x0 = 0,
    h0 = 0,
    upright = false,
    last = { y: 0, t: 0, v: 0 };
  const move = (e: PointerEvent) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    if (!dragged && Math.abs(dy) < 5 && Math.abs(e.clientX - x0) < 5) return;
    if (!dragged) {
      if (upright && Math.abs(e.clientX - x0) > Math.abs(dy)) return release();
      dragged = true;
      SHEET.dragging = true;
      sh.classList.add('drag');
    }
    follow(h0, dy);
    const dt = Math.max(1, e.timeStamp - last.t);
    last = { y: e.clientY, t: e.timeStamp, v: (e.clientY - last.y) / dt };
  };
  const release = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', release);
    removeEventListener('pointercancel', release);
    if (y0 == null) return;
    y0 = null;
    if (dragged) settle(last.v);
    SHEET.dragging = false;
  };
  const press = (e: PointerEvent, onBody: boolean) => {
    y0 = e.clientY;
    x0 = e.clientX;
    h0 = SHEET.px;
    upright = onBody;
    dragged = false;
    last = { y: e.clientY, t: e.timeStamp, v: 0 };
    addEventListener('pointermove', move);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  };
  head.addEventListener('pointerdown', e => {
    if (!(e.target as HTMLElement).closest('#sheetStrip, .sbArr')) press(e, false);
  });
  body.addEventListener('pointerdown', e => {
    if (SHEET.h !== 'full' && e.pointerType !== 'mouse') press(e, true);
  });

  /* taps */
  $('#sheetGrip').addEventListener('click', () => {
    if (!dragged) moved(ORDER[(ORDER.indexOf(SHEET.h) + 1) % 3]);
  });
  $('#sheetBar').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('.sbArr') as HTMLElement | null;
    if (b) selectStation(STATE.sel + Number(b.dataset.step));
    else if (!dragged && SHEET.h === 'peek') moved('half');
  });
  $('#sheetTabs').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (b && !dragged) pickTab(b.dataset.t as Tab);
  });
  $('#sheetMark').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!b || dragged) return;
    const m = b.dataset.m;
    if (m === 'right' || m === 'unsure') {
      if (quickMark(m) === 'editing') toEditor();
    } else if (m === 'wrong') {
      quickMark('wrong');
      toEditor();
    } else if (m === 'edit') {
      editAt(STATE.sel);
      toEditor();
    } else toEditor();
  });
  /* a press that ends a drag mustn't also count as a tap */
  addEventListener(
    'pointerdown',
    () => {
      dragged = false;
    },
    true,
  );
}

/** the editor for a mark lives under Answer: show it, with room */
function toEditor() {
  pickTab('answer');
  if (SHEET.h !== 'full') {
    SHEET.before = SHEET.h;
    setHeight('full');
  }
  requestAnimationFrame(() => document.querySelector('#verdict .mark')?.scrollIntoView({ block: 'start' }));
}
