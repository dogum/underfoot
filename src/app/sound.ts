// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The sounding run. Derive stations, launch every source at once, and fuse as
 * each one lands; nothing waits on anything it does not need. Also recompute()
 * (raw → smoothed → GPS views) and the field-map scheduler.
 */
import { scheduleField, startField } from './field';
import { liveMatch } from './live';
import { askGazLive } from './gaz';
import { askPass, askSoils, askToday, askWorld } from './whole';
import { askTerrain } from './terrain';
import { rateAll } from './going';
import { readArea, startArea } from './area';
import { STATE, fuseOpt } from './state';
import { deriveStations, findCrossings, mergeCrossings, snapStations } from './stations';
import { PRIOR } from '../core/classes';
import { inCONUS, inUS } from '../core/geo';
import { clamp } from '../core/math';
import { structuresFor } from '../data/fema';
import { pool } from '../data/http';
import { imageryMeta, imageryRaster } from '../data/imagery';
import { nlcd } from '../data/nlcd';
import { ofmTile, tilesFor } from '../data/openfreemap';
import { positional } from '../engine/field';
import { NO_FOLLOW, followLines } from '../engine/follow';
import { checkList, doubtOf } from '../engine/doubt';
import { computeParts, finishPosterior, fuseParts } from '../engine/fuse';
import { buildGeo, geoAt } from '../engine/geometry';
import { imgFeatures } from '../engine/imagery-model';
import { smoothChain } from '../engine/smooth';
import { writeHash } from '../io/hash';
import { pushHistory } from '../io/history';
import { render } from '../ui/console';

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

export async function runSounding() {
  const id = ++STATE.runId,
    live = () => id === STATE.runId;
  let st = deriveStations(),
    early = null;
  if (STATE.mode === 'path' && STATE.verts.length > 1) {
    early = (async () => {
      try {
        const dec = await pool(tilesFor(st, 200), 4, ([x, y]) => ofmTile(x, y));
        return dec.some(d => !d) ? null : dec.flatMap(d => d.feats);
      } catch (e) {
        return null;
      }
    })();
    const feats = await early;
    if (!live()) return;
    STATE.stretches = [];
    if (feats) {
      const fol = STATE.follow ? followLines(STATE.verts, feats) : NO_FOLLOW;
      const cr = findCrossings(STATE.verts, feats, fol);
      st = snapStations(mergeCrossings(st, cr), fol);
      STATE.crossings = cr;
      STATE.stretches = fol.stretches;
    }
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
  STATE.results = st.map((p, i) => ({
    station: p,
    geo: null,
    q: null,
    feat: null,
    img: null,
    fused: null,
    view: null,
    sh: {
      pt: { lat: p.lat, lon: p.lon },
      conus: inCONUS(p),
      inUS: inUS(p),
      nlcd: p && inCONUS(p) ? undefined : null,
      terr: undefined,
      nom: undefined,
      gazAsked: i === STATE.sel && STATE.mode !== 'batch',
      structOk: false,
      osmErr: null,
      structErr: null,
      imgErr: null,
      imgWmul: 1,
      imeta: null,
      today: undefined,
      pass: undefined,
      world: undefined,
      soil: inUS(p) ? undefined : null,
    },
  }));
  if (STATE.mode === 'area') startArea(id);
  else STATE.area = null;
  recompute();
  render();

  /* 1 · OSM geometry from vector tiles, and US footprints — the geometry index needs both */
  const pOsm = (async () => {
    try {
      if (early) {
        const f = await early;
        if (f) return f;
      }
      const tl = tilesFor(st, 200);
      const dec = await pool(tl, 4, ([x, y]) => ofmTile(x, y));
      if (dec.some(d => !d))
        throw new Error(dec.every(d => !d) ? 'tile CDN unreachable' : 'some tiles failed');
      return dec.flatMap(d => d.feats);
    } catch (e) {
      if (live()) STATE.results.forEach(r => (r.sh.osmErr = String(e.message || e)));
      return [];
    }
  })();
  const pSt = (async () => {
    const us = st.filter(inUS);
    if (!us.length) return [];
    try {
      return await structuresFor(us, 60);
    } catch (e) {
      if (live()) STATE.results.forEach(r => (r.sh.structErr = String(e.message || e)));
      return [];
    }
  })();
  const pGeo = Promise.all([pOsm, pSt]).then(([feats, structs]) => {
    if (!live()) return;
    STATE.osmFeats = feats;
    STATE.structs = structs;
    STATE.results.forEach(r => {
      r.sh.structOk = !r.sh.structErr;
      r.geo = buildGeo(r.station, feats, structs, 170);
      r.q = geoAt(r.geo, 0, 0, true);
      if (r.station.x) {
        r.q.crossing = r.station.x.cls;
        if (r.station.x.over) r.q.over = r.station.x.over;
      }
      if (r.station.f) r.q.follow = r.station.f.cls;
    });
    tick();
    if (!batch) startField();
  });

  /* 2 · imagery: the patch under each station, and what that photo is */
  const pImg = pool(st, 4, async (p, i) => {
    const R = await imageryRaster(p.lat, p.lon, 24);
    if (!live()) return;
    const r = STATE.results[i];
    if (R) {
      r.img = R;
      r.feat = imgFeatures(R.data.data, R.W, 24, 24);
      if (R.z < 18) {
        r.sh.imgWmul = 0.6;
      }
    } else r.sh.imgErr = 'no orthoimagery could be read here';
    tick();
  });
  const pMeta = (async () => {
    const cells = new Map();
    st.forEach((p, i) => {
      const k = Math.round(p.lat * 100) + ':' + Math.round(p.lon * 100);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    });
    await pool([...cells.values()], 3, async idx => {
      const p = st[idx[0]];
      let m = null;
      try {
        m = await imageryMeta(p.lat, p.lon);
      } catch (e) {}
      if (!live()) return;
      for (const i of idx) {
        const sh = STATE.results[i].sh;
        sh.imeta = m;
        /* coarse imagery (Landsat-class, 15 m) under a z18 tile is upsampled
           mush — its texture statistics are not the ones the model learned */
        if (m && m.res > 2) sh.imgWmul = Math.min(sh.imgWmul, 0.5);
      }
      tick();
    });
  })();

  /* 3 · NLCD rasters, one request per station for all four */
  const pCov = pool(st, 5, async (p, i) => {
    if (!inCONUS(p)) return;
    let v = null;
    try {
      v = await nlcd(p.lat, p.lon);
    } catch (e) {
      v = null;
    }
    if (live()) {
      STATE.results[i].sh.nlcd = v;
      tick();
      scheduleField();
    }
  });

  /* 4 · terrain — 3DEP where it covers, Terrain Tiles elsewhere (app/terrain) */
  const pTer = askTerrain(st, id);

  /* 5 · gazetteer — one request a second, so only the station in focus, and in a batch only a point opened */
  const pGaz = batch ? null : askGazLive(id);

  /* 6–8 · today's weather, the newest pass and the global land cover, each
     asked once for the whole line (app/whole) */
  const pToday = askToday(st, id),
    pPass = askPass(st, id),
    pWorld = askWorld(st, id, pCov),
    pSoil = askSoils(st, id);

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
  const opt = fuseOpt();
  for (const r of STATE.results) {
    if (!r) continue;
    r.parts = computeParts(r.sh, r.q, r.feat);
    r.fused = fuseParts(r.parts, opt);
    r.view = r.fused;
    r.mode = 'raw';
  }
  const n = STATE.results.length;
  if (STATE.mode === 'path' && STATE.smooth && n >= 3) {
    /* crossing stations are point events — a road, a stream — so they neither
       get smoothed nor smooth their neighbours */
    const reg = STATE.results
      .map((r, i) => i)
      .filter(i => STATE.stations[i] && STATE.results[i] && STATE.results[i].fused && !STATE.stations[i].x);
    const sm = smoothChain(
      reg.map(i => STATE.results[i].fused.p),
      reg.map(i => STATE.stations[i].d),
      PRIOR,
    );
    reg.forEach((i, j) => {
      const r = STATE.results[i];
      r.view = finishPosterior(sm[j], {
        parts: r.parts,
        tau: r.fused.tau,
        wsum: r.fused.wsum,
        W: STATE.weights,
        prior: PRIOR,
      });
      r.mode = 'smoothed';
    });
    STATE.results.forEach((r, i) => {
      if (r && STATE.stations[i] && STATE.stations[i].x) r.mode = 'crossing';
    });
  }
  const r = STATE.results[STATE.sel],
    F = STATE.field;
  /* a station moved onto a path the line follows already knows where it is:
     the GPS disc is what the matching resolved, so it isn't averaged over */
  if (r && STATE.gps > 0 && F && F.idx === STATE.sel && F.ready && !r.station.f) {
    const pp = positional(F.F, STATE.gps);
    if (pp) {
      r.view = finishPosterior(pp, {
        parts: r.parts,
        tau: r.fused.tau,
        wsum: r.fused.wsum,
        W: STATE.weights,
        prior: PRIOR,
      });
      r.mode = 'gps';
    }
  }
  /* how much each answer shown is worth a second look (engine/doubt) */
  for (const r of STATE.results) if (r) r.doubt = r.view ? doubtOf(r.view) : null;
  STATE.checks =
    STATE.mode === 'path'
      ? checkList(
          STATE.results.flatMap((r, i) =>
            r && r.doubt && STATE.stations[i] ? [{ i, d: STATE.stations[i].d, score: r.doubt.score }] : [],
          ),
        ).map(s => s.i)
      : [];
  /* go / slow / no-go follows the answers (app/going) */
  STATE.going = rateAll();
}
