/**
 * The time machine for the station in focus: find the distinct captures in
 * Esri's archive (data/wayback), read each one's picture around the point,
 * score it with the imagery classifier, and smooth across the years
 * (engine/years). Only the station on screen is read, a moment after its
 * answer settles, so dragging a probe doesn't send a burst of requests.
 */
import { STATE } from './state';
import { forgetFailed, imageryRaster, isNoDataPlate } from '../data/imagery';
import { pool } from '../data/http';
import { WB_Z, captureMeta, changedReleases, releases } from '../data/wayback';
import type { CaptureMeta, Release } from '../data/wayback';
import { readYears } from '../engine/years';
import type { Capture, Years } from '../engine/years';
import { imgFeatures, imgProbs } from '../engine/imagery-model';
import { render } from '../ui/console';

export interface YearsState {
  /** the spot it belongs to, to 1e-5° */
  key: string;
  runId: number;
  status: 'reading' | 'done' | 'none' | 'err';
  /** progress while reading: captures found, and read so far */
  found: number;
  read: number;
  /** tile maps asked to find them */
  asked: number;
  h: Years | null;
  /** a 48 px picture of each capture around the point, for the strip */
  thumbs: ImageData[];
  err?: string;
}

/** half-width of the patch read per capture: the point and four patches 12 px off it */
const HALF = 40,
  OFF: [number, number][] = [
    [0, 0],
    [-12, 0],
    [12, 0],
    [0, -12],
    [0, 12],
  ];

export const spotKey = (lat: number, lon: number) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** the station whose history is shown, or null where there's none to show */
export function yearsStation() {
  if (STATE.mode === 'area' || STATE.live.on) return null;
  const r = STATE.results[STATE.sel];
  return r && r.view ? r.station : null;
}

let timer = 0;
/** read the history for the station in focus, unless it's already read or on its way */
export function scheduleYears(delay = 900) {
  const st = yearsStation();
  if (!st) return;
  const key = spotKey(st.lat, st.lon);
  if (STATE.years && STATE.years.key === key) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const now = yearsStation();
    if (now && spotKey(now.lat, now.lon) === key && STATE.years?.key !== key) readAt(now.lat, now.lon, key);
  }, delay);
}

/** probabilities for one capture's picture: the classifier at the point and four patches around it, averaged */
function capProbs(d: Uint8ClampedArray, W: number): number[] {
  const sum = new Array(9).fill(0);
  for (const [dy, dx] of OFF)
    imgProbs(imgFeatures(d, W, HALF + dx, HALF + dy).v).forEach((p, c) => (sum[c] += p));
  return sum.map(v => v / OFF.length);
}
function thumb(d: ImageData): ImageData {
  const out = new ImageData(48, 48),
    o = HALF - 24;
  for (let y = 0; y < 48; y++)
    out.data.set(d.data.subarray(((y + o) * d.width + o) * 4, ((y + o) * d.width + o + 48) * 4), y * 48 * 4);
  return out;
}

async function readAt(lat: number, lon: number, key: string) {
  const hs: YearsState = {
    key,
    runId: STATE.runId,
    status: 'reading',
    found: 0,
    read: 0,
    asked: 0,
    h: null,
    thumbs: [],
  };
  STATE.years = hs;
  const live = () => STATE.years === hs;
  render();
  try {
    const all = await releases();
    /* each changed release's capture is asked for as soon as the walk finds it */
    const asking = new Map<number, Promise<CaptureMeta | null>>();
    const { rels, asked } = await changedReleases(lat, lon, all, r =>
      asking.set(
        r.id,
        captureMeta(r, lat, lon).catch(() => null),
      ),
    );
    if (!live()) return;
    hs.asked = asked;
    /* a capture republished in a later release is read once, from the newest */
    const metas = await Promise.all(rels.map(r => asking.get(r.id)!));
    if (!live()) return;
    const byDate = new Map<string, { rel: Release; src?: string | null; res?: number | null }>();
    rels.forEach((r, k) => {
      const m = metas[k];
      if (m && m.date && !byDate.has(m.date)) byDate.set(m.date, { rel: r, src: m.src, res: m.res });
    });
    const dates = [...byDate.keys()].sort();
    hs.found = dates.length;
    render();
    const read = await pool(dates, 3, async (date: string) => {
      const c = byDate.get(date)!,
        key = `wb:${c.rel.id}` as const;
      let R = await imageryRaster(lat, lon, HALF, [WB_Z], key);
      /* a tile that didn't load is asked once more before the capture is left out */
      if (!R) {
        forgetFailed(key);
        await new Promise(z => setTimeout(z, 800));
        R = await imageryRaster(lat, lon, HALF, [WB_Z], key);
      }
      if (live()) {
        hs.read++;
        render();
      }
      if (!R || isNoDataPlate(R.data)) return null;
      const cap: Capture = { date, rel: c.rel.id, src: c.src, res: c.res, p: capProbs(R.data.data, R.W) };
      return { cap, thumb: thumb(R.data) };
    });
    if (!live()) return;
    const ok = read.filter(Boolean) as { cap: Capture; thumb: ImageData }[];
    hs.thumbs = ok.map(o => o.thumb);
    hs.h = readYears(ok.map(o => o.cap));
    hs.status = ok.length ? 'done' : 'none';
  } catch (e) {
    if (!live()) return;
    hs.status = 'err';
    hs.err = (e as Error).message;
  }
  render();
}
