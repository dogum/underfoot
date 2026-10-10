/**
 * Batch points: up to 1,000 separate points from a file, read in groups of
 * nearby points (engine/batch) through the same sounding as a line's stations
 * (app/sound), one group at a time so each service sees a steady pace. Every
 * finished group is kept in this browser (IndexedDB), so a closed tab resumes
 * where it stopped. The gazetteer is asked only for a point you open.
 */
import { setVerts, syncModeButtons } from './actions';
import { recompute, runSounding } from './sound';
import { STATE } from './state';
import { IDB } from '../data/http';
import { BATCH, groupPoints } from '../engine/batch';
import type { BatchRow } from '../engine/batch';
import { K } from '../core/classes';
import type { ClassKey, StationResult } from '../core/types';
import type { FilePoint } from '../io/points';
import { MAP, fitTo } from '../map/map';
import { render } from '../ui/console';

export interface BatchState {
  /** the file it came from */
  name: string;
  pts: FilePoint[];
  /** the file's other columns, in its order */
  cols: string[];
  /** points read together (engine/batch groupPoints) */
  groups: number[][];
  rows: (BatchRow | null)[];
  /** the next group to read */
  next: number;
  status: 'reading' | 'paused' | 'done';
  /** points in the file beyond the most a batch reads, left out */
  dropped: number;
  /** time spent reading, ms (not counting time paused or closed) */
  ms: number;
  /** sources that didn't answer, summed over the points read, and by source */
  missing: number;
  missingBy?: Record<string, number>;
  /** the point the table and map have in focus */
  focus: number | null;
}

const KEY = 'batch';
/** the batch as it was when the tab closed, until it's resumed or put away */
let saved: BatchState | null = null;
let looping = false;

export function savedBatch() {
  return saved;
}
function save(B: BatchState) {
  void IDB.put(KEY, { ...B, focus: null });
}
/** look in this browser for a batch left unfinished or unexported; called once at start */
export async function loadSavedBatch() {
  const b = (await IDB.get(KEY, 0)) as BatchState | null;
  if (b && Array.isArray(b.pts) && Array.isArray(b.rows)) {
    saved = { ...b, status: b.status === 'done' ? 'done' : 'paused', focus: null };
    render();
  }
}

/** a sounding's answer as the row the batch keeps */
export function rowOf(r: StationResult | undefined): BatchRow | null {
  const v = r?.view;
  if (!v) return null;
  const led = v.ledger || [];
  return {
    call: v.top as ClassKey,
    p: v.topP,
    then: K[v.order[1]],
    pThen: v.p[v.order[1]],
    src: led.filter(l => l.status === 'ok' || l.status === 'quiet').length,
    doubt: r?.doubt?.score ?? 0,
  };
}

/** begin a batch from a file's points */
export function startBatch(name: string, pts: FilePoint[], cols: string[]) {
  const keep = pts.slice(0, BATCH.max);
  const B: BatchState = {
    name,
    pts: keep,
    cols,
    groups: groupPoints(keep),
    rows: keep.map(() => null),
    next: 0,
    status: 'reading',
    dropped: pts.length - keep.length,
    ms: 0,
    missing: 0,
    focus: null,
  };
  saved = null;
  enter(B);
  fitTo(keep);
  save(B);
  void readGroups(B);
}

/** show a batch (the one open, or the one kept from last time) and read on if it isn't finished */
export function resumeBatch(B: BatchState | null = STATE.batch || saved) {
  if (!B) return;
  saved = null;
  if (B.status !== 'done') B.status = 'reading';
  enter(B);
  if (STATE.batch === B && STATE.mode === 'batch') fitTo(B.pts);
  void readGroups(B);
}
function enter(B: BatchState) {
  STATE.batch = B;
  STATE.mode = 'batch';
  STATE.verts = [];
  STATE.stations = [];
  STATE.results = [];
  STATE.field = null;
  STATE.sel = 0;
  MAP.drawing = false;
  syncModeButtons();
  render();
}

/** stop after the group being read; what's read so far is kept */
export function pauseBatch() {
  const B = STATE.batch;
  if (!B || B.status !== 'reading') return;
  B.status = 'paused';
  save(B);
  render();
}
/** forget the batch, here and in this browser */
export function discardBatch() {
  STATE.batch = null;
  saved = null;
  void IDB.put(KEY, null);
  if (STATE.mode === 'batch') {
    STATE.mode = 'point';
    STATE.stations = [];
    STATE.results = [];
    syncModeButtons();
  }
  render();
}

/** open one point as an ordinary sounding (the gazetteer included); the batch waits */
export function openRow(i: number) {
  const B = STATE.batch;
  if (!B) return;
  if (B.status === 'reading') B.status = 'paused';
  save(B);
  const p = B.pts[i];
  setVerts([{ lat: p.lat, lon: p.lon }], { mode: 'point' });
}

async function readGroups(B: BatchState) {
  if (looping) return;
  looping = true;
  try {
    while (
      B.next < B.groups.length &&
      B.status === 'reading' &&
      STATE.batch === B &&
      STATE.mode === 'batch'
    ) {
      const g = B.groups[B.next],
        t0 = Date.now();
      STATE.verts = g.map(i => ({ lat: B.pts[i].lat, lon: B.pts[i].lon }));
      STATE.sel = 0;
      await runSounding();
      /* a mode switch, a new file or a link takes over the sounding: this group is read again on resume */
      if (STATE.batch !== B || STATE.mode !== 'batch' || STATE.results.length !== g.length) break;
      /* the last source to land is fused on the next frame: fuse now, so each row is the final answer */
      recompute();
      g.forEach((i, k) => {
        const r = STATE.results[k];
        B.rows[i] = rowOf(r);
        for (const l of r?.view?.ledger || [])
          if (l.status === 'wait' || l.status === 'err') {
            B.missing++;
            B.missingBy = { ...B.missingBy, [l.id]: (B.missingBy?.[l.id] || 0) + 1 };
          }
      });
      B.ms += Date.now() - t0;
      B.next++;
      save(B);
      render();
    }
    if (B.next >= B.groups.length && STATE.batch === B) {
      B.status = 'done';
      save(B);
      render();
    } else if (B.status === 'reading' && (STATE.batch !== B || STATE.mode !== 'batch')) {
      /* something else took the sounding over: the batch waits to be resumed */
      B.status = 'paused';
      save(B);
    }
  } finally {
    looping = false;
    /* the last group's points were only ever the sounding's; the batch's are its own */
    if (STATE.mode === 'batch' && STATE.batch === B && B.status !== 'reading') {
      STATE.verts = [];
      STATE.stations = [];
      STATE.results = [];
      render();
    }
  }
}
