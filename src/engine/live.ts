/**
 * Here: the rules for reading the ground under a moving phone. Pure; the
 * geolocation watch in app/live.ts feeds it fixes.
 *
 * A phone reports a fix every second or so, each with its own accuracy. Reading
 * every one would flicker and hammer the data services, so a fix is read only
 * when it has moved farther than its own accuracy from the last one read. The
 * newest fix is read together with the last 200 m of fixes behind it, so that
 * on a trail the matcher (engine/follow) can say which trail.
 */
import { haversine } from '../core/geo';
import type { LatLon } from '../core/types';

export interface Fix extends LatLon {
  /** the fix's own reported accuracy, metres */
  acc: number;
  /** when it was taken, ms since the epoch */
  t: number;
}
export const LIVE = {
  /** m of recent fixes read with the newest one */
  window: 200,
  /** m: a fix worse than this isn't read at all */
  maxAcc: 50,
  /** ms: a fix older than this greys the status */
  stale: 30_000,
  /** m: however good the fix, moving less than this doesn't re-read */
  minMove: 3,
  /** fixes kept for the trail on the map */
  keep: 400,
};

export const usable = (f: Fix) => f.acc <= LIVE.maxAcc;

/** read this fix? Only if it's usable and has moved farther than its accuracy from the last one read */
export function shouldRead(last: Fix | null | undefined, fix: Fix): boolean {
  if (!usable(fix)) return false;
  if (!last) return true;
  return haversine(last, fix) > Math.max(LIVE.minMove, fix.acc);
}

/** the newest usable fixes, back as far as `m` metres of track */
export function recentWindow(fixes: Fix[], m = LIVE.window): Fix[] {
  const good = fixes.filter(usable),
    out: Fix[] = [];
  let len = 0;
  for (let i = good.length - 1; i >= 0; i--) {
    if (out.length) len += haversine(out[0], good[i]);
    out.unshift(good[i]);
    if (len >= m) break;
  }
  return out;
}

/** keep this fix in a recording? Only usable fixes that moved at least 3 m, or half their accuracy */
export function recordStep(track: LatLon[], fix: Fix): boolean {
  if (!usable(fix)) return false;
  const last = track[track.length - 1];
  return !last || haversine(last, fix) >= Math.max(LIVE.minMove, fix.acc / 2);
}

/** metres along a track */
export function trackLength(track: LatLon[]): number {
  let s = 0;
  for (let i = 1; i < track.length; i++) s += haversine(track[i - 1], track[i]);
  return s;
}
