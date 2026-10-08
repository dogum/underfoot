// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The sounding run. Derive stations, launch every source at once, and fuse as
 * each one lands; nothing waits on anything it does not need. Also recompute()
 * (raw → smoothed → GPS views) and the field-map scheduler.
 */
import { STATE, fuseOpt } from './state';
import { along, cumLen, deriveStations, findCrossings, mergeCrossings, snapStations } from './stations';
import { PRIOR } from '../core/classes';
import { R2D, in3DEP, inCONUS, inUS, merc, offset } from '../core/geo';
import { clamp } from '../core/math';
import { cellLabel, dep3, openMeteo } from '../data/elevation';
import { structuresFor } from '../data/fema';
import { pool } from '../data/http';
import { imageryMeta, imageryRaster } from '../data/imagery';
import { nlcd } from '../data/nlcd';
import { nominatim } from '../data/nominatim';
import { ofmTile, tilesFor } from '../data/openfreemap';
import {
  FIELD_HALF,
  fieldFuse,
  fieldGeometry,
  fieldImageryGrid,
  fieldImageryStep,
  positional,
} from '../engine/field';
import { NO_FOLLOW, followLines } from '../engine/follow';
import { computeParts, finishPosterior, fuseParts } from '../engine/fuse';
import { buildGeo, geoAt } from '../engine/geometry';
import { imgFeatures } from '../engine/imagery-model';
import { smoothChain } from '../engine/smooth';
import { writeHash } from '../io/hash';
import { pushHistory } from '../io/history';
import { MAP } from '../map/map';
import { render } from '../ui/console';

/* ---- terrain from a rosette of elevations ------------------------------ */
export function rosette(p, r) {
  const out = [{ lat: p.lat, lon: p.lon }];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    out.push(offset(p, r * Math.sin(a), r * Math.cos(a)));
  }
  return out;
}
export function terrainFrom(z, r, src, res) {
  if (!z || z.length < 5 || z.some(v => v == null)) return null;
  const c = z[0],
    ring = z.slice(1),
    n = ring.length;
  const pts = ring.map((v, i) => {
    const a = (i * 2 * Math.PI) / n;
    return [r * Math.sin(a), r * Math.cos(a), v];
  });
  const mz = ring.reduce((a, b) => a + b, 0) / n;
  let Sxx = 0,
    Syy = 0,
    Sxy = 0,
    Sxz = 0,
    Syz = 0;
  for (const [x, y, zz] of pts) {
    Sxx += x * x;
    Syy += y * y;
    Sxy += x * y;
    Sxz += x * (zz - mz);
    Syz += y * (zz - mz);
  }
  const det = Sxx * Syy - Sxy * Sxy;
  let a = 0,
    b = 0;
  if (Math.abs(det) > 1e-9) {
    a = (Sxz * Syy - Syz * Sxy) / det;
    b = (Syz * Sxx - Sxz * Sxy) / det;
  }
  let res2 = 0;
  for (const [x, y, zz] of pts) {
    res2 += (zz - (mz + a * x + b * y)) ** 2;
  }
  return {
    slope: Math.atan(Math.hypot(a, b)) * R2D,
    rough: Math.sqrt(res2 / n),
    rel: c - mz,
    z: c,
    r,
    src,
    res,
    ocean: false,
  };
}

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
  } else {
    STATE.crossings = [];
    STATE.stretches = [];
  }
  STATE.stations = st;
  STATE.field = null;
  STATE.profile = null;
  STATE.sel = clamp(STATE.sel, 0, Math.max(0, st.length - 1));
  if (!st.length) {
    STATE.results = [];
    render();
    return;
  }
  STATE.running = true;
  writeHash();
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
      gazAsked: i === STATE.sel,
      structOk: false,
      osmErr: null,
      structErr: null,
      imgErr: null,
      imgWmul: 1,
      imeta: null,
    },
  }));
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
    startField();
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

  /* 4 · terrain — 3DEP rosettes in one batch, Open-Meteo where 3DEP is silent */
  const pTer = (async () => {
    const R1 = 10,
      R2 = 45,
      us = st.map(in3DEP);
    const pts = [];
    st.forEach((p, i) => {
      if (us[i]) pts.push(...rosette(p, R1));
    });
    let prof = [];
    if (st.length > 1 && STATE.verts.length > 1) {
      const v = STATE.verts,
        cum = cumLen(v),
        L = cum.at(-1),
        n = Math.min(240, Math.max(40, Math.round(L / 2)));
      prof = Array.from({ length: n }, (_, k) => {
        const d = (L * k) / (n - 1);
        return { ...along(v, cum, d), d };
      });
    }
    const profUS = prof.length && prof.every(p => in3DEP(p));
    let z3 = [];
    try {
      if (pts.length || profUS) z3 = await dep3(pts.concat(profUS ? prof : []));
    } catch (e) {
      z3 = [];
    }
    if (!live()) return;
    let k = 0;
    const need = [];
    st.forEach((p, i) => {
      let t = null;
      if (us[i]) {
        const z = z3.slice(k, k + 9).map(s => (s ? s.z : null));
        k += 9;
        const res = z3[k - 9] && z3[k - 9].res;
        t = terrainFrom(z, R1, `USGS 3DEP ${res ? cellLabel(res) + ' m ' : ''}· rosette r=${R1} m`, res || 1);
      }
      if (t) STATE.results[i].sh.terr = t;
      else need.push(i);
    });
    if (profUS) {
      /* a line can cross from lidar onto the 10 m DEM: the label gives the range */
      const zp = z3.slice(k),
        rs = zp.filter(s => s && s.res).map(s => s.res),
        lo = rs.length ? cellLabel(Math.min(...rs)) : '',
        hi = rs.length ? cellLabel(Math.max(...rs)) : '',
        src = '3DEP' + (rs.length ? ` ${lo === hi ? lo : lo + '–' + hi} m` : '');
      STATE.profile = prof.map((p, j) => ({ d: p.d, z: zp[j] ? zp[j].z : null, src }));
    }
    if (need.length || (prof.length && !profUS)) {
      const om = [];
      need.forEach(i => om.push(...rosette(st[i], R2)));
      const omz = await openMeteo(om.concat(profUS ? [] : prof));
      if (!live()) return;
      need.forEach((i, j) => {
        const z = omz.slice(j * 9, j * 9 + 9);
        let t = terrainFrom(z, R2, 'Open-Meteo DEM (~90 m cell) · rosette r=45 m', 90);
        if (t && z.every(v => v === 0)) t.ocean = true;
        STATE.results[i].sh.terr = t || null;
      });
      if (prof.length && !profUS) {
        const zp = omz.slice(need.length * 9);
        STATE.profile = prof.map((p, j) => ({ d: p.d, z: zp[j], src: '~90 m DEM' }));
      }
    }
    tick();
    scheduleField();
  })();

  /* 5 · gazetteer — one request a second, so only the station in focus */
  const pGaz = askGaz(STATE.sel, id);

  await Promise.allSettled([pGeo, pImg, pMeta, pCov, pTer, pGaz]);
  if (live()) {
    STATE.running = false;
    tick();
    pushHistory();
  }
}
export async function askGaz(i, id) {
  const r = STATE.results[i];
  if (!r || r.sh.nom !== undefined) return;
  r.sh.gazAsked = true;
  tick();
  let g = null;
  try {
    g = await nominatim(r.station.lat, r.station.lon);
  } catch (e) {
    g = null;
  }
  if (id != null && id !== STATE.runId) return;
  if (STATE.results[i] === r) {
    r.sh.nom = g;
    tick();
    scheduleField();
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
  if (r && STATE.gps > 0 && F && F.idx === STATE.sel && F.ready) {
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
}

/* ---- the field map for the station in focus --------------------------- */
export function startField() {
  const i = STATE.sel,
    r = STATE.results[i];
  if (!r || !r.geo) {
    STATE.field = null;
    return;
  }
  const runId = STATE.runId;
  const fld = {
    idx: i,
    runId,
    G: r.geo,
    F: fieldGeometry(r.geo, r.sh, fuseOpt()),
    FI: null,
    R: null,
    ready: false,
    imgDone: false,
  };
  STATE.field = fld;
  scheduleField(0);
  (async () => {
    const z18mpp = merc.mpp(r.station.lat, 18);
    const half = Math.ceil((FIELD_HALF + 14) / z18mpp) + 24;
    const R = await imageryRaster(r.station.lat, r.station.lon, half, [18]);
    if (STATE.field !== fld) return;
    if (!R) {
      fld.imgDone = true;
      scheduleField(0);
      return;
    }
    fld.R = R;
    fld.FI = fieldImageryGrid(R, r.geo);
    const step = () => {
      if (STATE.field !== fld) return;
      const done = fieldImageryStep(fld.FI, R, 14);
      if (done) {
        fld.imgDone = true;
        scheduleField(0);
      } else {
        if (fld.FI.next % 120 < 12) scheduleField(60);
        setTimeout(step, 0);
      }
    };
    step();
  })();
}
export let _fieldT = 0;
export function scheduleField(ms = 140) {
  clearTimeout(_fieldT);
  _fieldT = setTimeout(() => {
    const fld = STATE.field;
    if (!fld || fld.runId !== STATE.runId) return;
    const r = STATE.results[fld.idx];
    if (!r) return;
    fieldFuse(fld.F, fld.FI, r.sh, fuseOpt());
    fld.ready = true;
    MAP.fieldDirty = true;
    recompute();
    render();
  }, ms);
}
