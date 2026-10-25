/**
 * A spot's history: the distinct captures in Esri's archive (data/wayback),
 * each one's picture around the point scored with the imagery classifier,
 * smoothed across the years (engine/years). Shared by the app's time machine
 * (app/years) and the headless reader.
 */
import { forgetFailed, imageryRaster, isNoDataPlate } from '../data/imagery';
import type { ImageryRaster } from '../data/imagery';
import { pool } from '../data/http';
import { WB_Z, captureMeta, changedReleases, releases } from '../data/wayback';
import type { CaptureMeta, Release } from '../data/wayback';
import { imgFeatures, imgProbs } from '../engine/imagery-model';
import { readYears } from '../engine/years';
import type { Capture, Years } from '../engine/years';

/** half-width of the patch read per capture: the point and four patches 12 px off it */
export const HALF = 40;
const OFF: [number, number][] = [
  [0, 0],
  [-12, 0],
  [12, 0],
  [0, -12],
  [0, 12],
];

export interface HistoryHooks {
  /** still wanted; once false, nothing more is asked */
  live?: () => boolean;
  /** the walk is done: tile maps asked, and distinct captures found */
  found?: (asked: number, found: number) => void;
  /** one more capture's picture has been read (or given up on) */
  read?: () => void;
}
export interface History {
  /** tile maps asked to find the captures */
  asked: number;
  /** distinct captures found, and read */
  found: number;
  /** the history; no captures when none could be read */
  h: Years;
  /** each read capture's picture around the point, HALF px either side, in h.caps order */
  pictures: ImageryRaster[];
}

/** probabilities for one capture's picture: the classifier at the point and four patches around it, averaged */
function capProbs(d: Uint8ClampedArray, W: number): number[] {
  const sum = new Array(9).fill(0);
  for (const [dy, dx] of OFF)
    imgProbs(imgFeatures(d, W, HALF + dx, HALF + dy).v).forEach((p, c) => (sum[c] += p));
  return sum.map(v => v / OFF.length);
}

/** read a spot's history; null if `live` turned false on the way */
export async function readHistory(
  lat: number,
  lon: number,
  hooks: HistoryHooks = {},
): Promise<History | null> {
  const live = hooks.live ?? (() => true);
  const all = await releases();
  if (!live()) return null;
  /* each changed release's capture is asked for as soon as the walk finds it */
  const asking = new Map<number, Promise<CaptureMeta | null>>();
  const { rels, asked } = await changedReleases(
    lat,
    lon,
    all,
    r =>
      asking.set(
        r.id,
        captureMeta(r, lat, lon).catch(() => null),
      ),
    live,
  );
  if (!live()) return null;
  /* a capture republished in a later release is read once, from the newest */
  const metas = await Promise.all(rels.map(r => asking.get(r.id)!));
  if (!live()) return null;
  const byDate = new Map<string, { rel: Release; src?: string | null; res?: number | null }>();
  rels.forEach((r, k) => {
    const m = metas[k];
    if (m && m.date && !byDate.has(m.date)) byDate.set(m.date, { rel: r, src: m.src, res: m.res });
  });
  const dates = [...byDate.keys()].sort();
  hooks.found?.(asked, dates.length);
  const read = await pool(
    dates,
    3,
    async (date: string) => {
      if (!live()) return null;
      const c = byDate.get(date)!,
        key = `wb:${c.rel.id}` as const;
      let R = await imageryRaster(lat, lon, HALF, [WB_Z], key);
      /* a tile that didn't load is asked once more before the capture is left out */
      if (!R && live()) {
        forgetFailed(key);
        await new Promise(z => setTimeout(z, 800));
        R = await imageryRaster(lat, lon, HALF, [WB_Z], key);
      }
      if (live()) hooks.read?.();
      if (!R || isNoDataPlate(R.data)) return null;
      const cap: Capture = { date, rel: c.rel.id, src: c.src, res: c.res, p: capProbs(R.data.data, R.W) };
      return { cap, R };
    },
    live,
  );
  if (!live()) return null;
  const ok = read.filter(Boolean) as { cap: Capture; R: ImageryRaster }[];
  return {
    asked,
    found: dates.length,
    h: readYears(ok.map(o => o.cap)),
    pictures: ok.map(o => o.R),
  };
}
