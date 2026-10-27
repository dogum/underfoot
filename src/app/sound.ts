/**
 * The sounding run on the page. Derive stations, launch every source at once,
 * and fuse as each one lands; nothing waits on anything it does not need. The
 * readers and the fusion are shared with the headless reader (src/sounding/);
 * what's here is the page's part: the link, Here, an area's tiles, the field
 * map, Recent, and redrawing as answers land. Also recompute() (raw →
 * smoothed → GPS views).
 */
import { scheduleField, startField } from './field';
import { liveMatch } from './live';
import { askGazLive } from './gaz';
import { readArea, startArea } from './area';
import { STATE } from './state';
import { deriveStations } from './stations';
import { PRIOR } from '../core/classes';
import { clamp } from '../core/math';
import { positional } from '../engine/field';
import { finishPosterior } from '../engine/fuse';
import { finishRun, fuseStations } from '../sounding/fuse';
import { layLine, lineFeatures } from '../sounding/line';
import { readCover, readImagery, readMap, readPhotoDates } from '../sounding/read';
import { freshResults } from '../sounding/run';
import type { Hooks } from '../sounding/run';
import { readTerrain } from '../sounding/terrain';
import { readPass, readSoils, readToday, readWorld } from '../sounding/whole';
import { writeHash } from '../io/hash';
import { pushHistory } from '../io/history';
import { render } from '../ui/console';
import type { TileFeature } from '../core/types';

/* ---- the run ------------------------------------------------------------ */
export let _tickRaf = 0;
export function tick() {
  if (_tickRaf) return;
  _tickRaf = requestAnimationFrame(() => {
    _tickRaf = 0;
    recompute();
    render();
  });
}
/** the page's answer to each landing: redraw on the next frame, and re-fuse the field map */
export const HOOKS: Hooks = { tick, field: () => scheduleField() };

export async function runSounding() {
  const id = ++STATE.runId,
    live = () => id === STATE.runId;
  let st = deriveStations(),
    early: Promise<TileFeature[] | null> | null = null;
  if (STATE.mode === 'path' && STATE.verts.length > 1) {
    early = lineFeatures(st, live);
    const feats = await early;
    if (!live()) return;
    st = layLine(STATE, st, feats);
  } else if (STATE.mode === 'point' && STATE.live.on && st.length) {
    /* Here: the newest fix, read with the fixes behind it (app/live) */
    const m = await liveMatch(st[0]);
    if (!live()) return;
    st = [m.st];
    STATE.crossings = [];
    STATE.stretches = m.stretches;
  } else {
    STATE.crossings = [];
    STATE.stretches = [];
  }
  STATE.stations = st;
  STATE.field = null;
  STATE.profile = null;
  STATE.sel = clamp(STATE.sel, 0, Math.max(0, st.length - 1));
  if (STATE.at != null) {
    /* a link's at= (a check-list waypoint): the station nearest that far along */
    const at = STATE.at;
    STATE.sel = st.reduce((b, s, i) => (Math.abs(s.d - at) < Math.abs(st[b].d - at) ? i : b), 0);
    STATE.at = null;
  }
  if (!st.length) {
    STATE.results = [];
    render();
    return;
  }
  STATE.running = true;
  /* a batch's groups have no link of their own, and aren't each a Recent sounding */
  const batch = STATE.mode === 'batch';
  if (!batch) writeHash();
  STATE.results = freshResults(st, batch ? null : STATE.sel);
  if (STATE.mode === 'area') startArea(id);
  else STATE.area = null;
  recompute();
  render();

  const hooks: Hooks = { ...HOOKS, mapped: () => (batch ? undefined : startField()) };
  /* 1 · OSM geometry and US footprints; 2 · imagery and what each photo is; 3 · NLCD */
  const pGeo = readMap(STATE, st, id, hooks, early),
    pImg = readImagery(STATE, st, id, hooks),
    pMeta = readPhotoDates(STATE, st, id, hooks),
    pCov = readCover(STATE, st, id, hooks);

  /* 4 · terrain — 3DEP where it covers, Terrain Tiles elsewhere (sounding/terrain) */
  const pTer = readTerrain(STATE, st, id, hooks);

  /* 5 · gazetteer — one request a second, so only the station in focus, and in a batch only a point opened */
  const pGaz = batch ? null : askGazLive(id);

  /* 6–8 · today's weather, the newest pass and the global land cover, each
     asked once for the whole line (sounding/whole) */
  const pToday = readToday(STATE, st, id, hooks),
    pPass = readPass(STATE, st, id, hooks),
    pWorld = readWorld(STATE, st, id, hooks, pCov),
    pSoil = readSoils(STATE, st, id, hooks);

  await Promise.allSettled([pGeo, pImg, pMeta, pCov, pTer, pGaz, pToday, pPass, pWorld, pSoil]);
  /* an area: every tile's field map, summed into acres (app/area) */
  if (STATE.mode === 'area' && live()) await readArea(id);
  if (live()) {
    STATE.running = false;
    tick();
    if (!STATE.live.on && !batch) pushHistory(); // Here keeps its last reading when it stops, not every fix
  }
}
/* ---- fusion for every station, then smoothing along the line ----------- */
export function recompute() {
  fuseStations(STATE);
  const r = STATE.results[STATE.sel],
    F = STATE.field;
  /* a station moved onto a path the line follows already knows where it is:
     the GPS disc is what the matching resolved, so it isn't averaged over */
  if (r && STATE.gps > 0 && F && F.idx === STATE.sel && F.ready && !r.station.f) {
    const pp = positional(F.F, STATE.gps);
    if (pp) {
      r.view = finishPosterior(pp, {
        parts: r.parts,
        tau: r.fused!.tau,
        wsum: r.fused!.wsum,
        W: STATE.weights,
        prior: PRIOR,
      });
      r.mode = 'gps';
    }
  }
  /* how much each answer shown is worth a second look, the check list, and go / slow / no-go */
  finishRun(STATE);
}
