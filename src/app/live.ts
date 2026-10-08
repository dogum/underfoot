/**
 * Here: follow the phone's position, read the ground under it as it moves, and
 * record the walk if asked. The rules (when a fix is read, which fixes go with
 * the newest one) are in engine/live; this is the geolocation watch and the
 * glue to the sounding.
 */
import { setVerts } from './actions';
import { STATE } from './state';
import { toast } from '../core/dom';
import { haversine } from '../core/geo';
import { pool } from '../data/http';
import { ofmTile, tilesFor } from '../data/openfreemap';
import { followLines, type FollowStretch } from '../engine/follow';
import { LIVE, recentWindow, recordStep, shouldRead, trackLength, usable, type Fix } from '../engine/live';
import { pushHistory } from '../io/history';
import { flashLock, isLocked } from '../map/lock';
import { MAP, mapDraw, toScreen } from '../map/map';
import { render } from '../ui/console';
import { renderLive } from '../ui/live';
import type { LatLon, Station, TileFeature } from '../core/types';

export interface LiveState {
  on: boolean;
  /** recording the walk as a line */
  rec: boolean;
  /** recent fixes, newest last, for the trail on the map and the window behind the newest */
  fixes: Fix[];
  /** the newest fix, and the last one read */
  last: Fix | null;
  read: Fix | null;
  /** the recording so far, and when it started (ms) */
  track: LatLon[];
  started: number;
  /** why there's no reading: the page may not use location, or the phone has no fix yet */
  err: 'denied' | 'unavailable' | null;
  watch: number | null;
  /** when the gazetteer was last asked (ms): at most once a minute while walking */
  gazAt: number;
}
export const liveOn = () => STATE.live.on;

/** the gazetteer may be asked for this live reading (one request a minute, at most) */
export function gazAllowed(): boolean {
  if (!STATE.live.on) return true;
  if (Date.now() - STATE.live.gazAt < 60_000) return false;
  STATE.live.gazAt = Date.now();
  return true;
}

export function startHere() {
  if (isLocked()) {
    flashLock();
    toast('Locked. Unlock to follow your position.');
    return;
  }
  const L = STATE.live;
  if (!('geolocation' in navigator)) {
    L.err = 'unavailable';
    renderLive();
    return;
  }
  Object.assign(L, {
    on: true,
    rec: false,
    fixes: [],
    last: null,
    read: null,
    track: [],
    err: null,
    gazAt: 0,
  });
  L.watch = navigator.geolocation.watchPosition(onFix, onError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 30_000,
  });
  startTicker();
  render();
}

/** turn Here off. Stop on a recording keeps the walk as a line; anything else just ends it */
export function stopHere(keepRecording = false) {
  const L = STATE.live;
  if (!L.on) return;
  if (L.watch != null) navigator.geolocation.clearWatch(L.watch);
  const track = keepRecording && L.rec ? L.track.slice() : null;
  Object.assign(L, { on: false, rec: false, watch: null });
  stopTicker();
  /* the last reading stays, at the nearest of the usual GPS steps */
  if (STATE.gps > 0)
    STATE.gps = [3, 5, 10].reduce((a, b) => (Math.abs(b - STATE.gps) < Math.abs(a - STATE.gps) ? b : a));
  if (track && track.length > 1) setVerts(track, { mode: 'path' });
  else {
    if (STATE.results.some(r => r && r.view)) pushHistory();
    render();
    mapDraw();
  }
}

export function toggleRec() {
  const L = STATE.live;
  if (!L.on) return;
  if (L.rec) return stopHere(true);
  L.rec = true;
  L.started = Date.now();
  L.track = L.last && usable(L.last) ? [{ lat: L.last.lat, lon: L.last.lon }] : [];
  renderLive();
  mapDraw();
}

function onFix(pos: GeolocationPosition) {
  const L = STATE.live;
  if (!L.on) return;
  const f: Fix = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    acc: Math.max(1, pos.coords.accuracy || LIVE.maxAcc + 1),
    t: pos.timestamp || Date.now(),
  };
  L.err = null;
  L.last = f;
  L.fixes.push(f);
  if (L.fixes.length > LIVE.keep) L.fixes.shift();
  if (L.rec && recordStep(L.track, f)) L.track.push({ lat: f.lat, lon: f.lon });
  if (shouldRead(L.read, f)) read(f);
  else {
    renderLive();
    mapDraw();
  }
}

function read(f: Fix) {
  const first = !STATE.live.read;
  STATE.live.read = f;
  STATE.gps = Math.round(f.acc);
  setVerts([{ lat: f.lat, lon: f.lon }], { mode: 'point', fit: false, live: true });
  /* keep the walker in view: centre on the first fix, then only when it nears the edge */
  if (first) {
    MAP.lat = f.lat;
    MAP.lon = f.lon;
    MAP.z = Math.max(MAP.z, 17.5);
  } else {
    const [x, y] = toScreen(f.lat, f.lon);
    if (x < MAP.W * 0.2 || x > MAP.W * 0.8 || y < MAP.H * 0.2 || y > MAP.H * 0.8) {
      MAP.lat = f.lat;
      MAP.lon = f.lon;
    }
  }
  mapDraw();
}

function onError(e: GeolocationPositionError) {
  const L = STATE.live;
  if (e.code === e.PERMISSION_DENIED) {
    stopHere();
    L.err = 'denied';
  } else L.err = 'unavailable'; // keep watching: a fix may still come
  renderLive();
}

/* the status says how old the fix is; a ticker keeps that honest */
let ticker: ReturnType<typeof setInterval> | undefined;
function startTicker() {
  stopTicker();
  ticker = setInterval(renderLive, 1000);
}
function stopTicker() {
  clearInterval(ticker);
}

/**
 * In a live point sounding: read the newest fix with the last 200 m of fixes
 * behind it, and if that stretch follows a mapped path or road, move the
 * station onto it. A live track's end is "now", so it costs nothing to end on
 * a trail (engine/follow openEnd).
 */
export async function liveMatch(st: Station): Promise<{ st: Station; stretches: FollowStretch[] }> {
  const w = recentWindow(STATE.live.fixes);
  if (!STATE.follow || w.length < 2 || haversine(w[w.length - 1], st) > 1) return { st, stretches: [] };
  let feats: TileFeature[];
  try {
    const dec = await pool(tilesFor(w, 200), 4, ([x, y]: number[]) => ofmTile(x, y));
    if (dec.some((d: unknown) => !d)) return { st, stretches: [] };
    feats = dec.flatMap((d: { feats: TileFeature[] }) => d.feats);
  } catch {
    return { st, stretches: [] };
  }
  const fol = followLines(w, feats, { openEnd: true }),
    L = trackLength(w),
    k = fol.at(L),
    sp = k >= 0 ? fol.snap(st, L) : null;
  if (!sp) return { st, stretches: fol.stretches };
  return {
    st: {
      ...st,
      lat: sp.lat,
      lon: sp.lon,
      raw: { lat: st.lat, lon: st.lon },
      f: { k, cls: fol.stretches[k].cls, off: sp.off },
    },
    stretches: fol.stretches,
  };
}
