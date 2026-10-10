/**
 * Terrain for a run's stations (app/sound): USGS 3DEP rosettes in one batch
 * where 3DEP covers, AWS's Terrain Tiles elsewhere (data/terrarium), stations
 * that share a tile sharing it, and Open-Meteo's ~90 m DEM for any whose tile
 * won't load. A line also gets its elevation profile.
 */
import { tick } from './sound';
import { scheduleField } from './field';
import { STATE } from './state';
import { along, cumLen } from './stations';
import { in3DEP } from '../core/geo';
import type { LatLon, Station } from '../core/types';
import { cellLabel, dep3, openMeteo } from '../data/elevation';
import type { DemSample } from '../data/elevation';
import { openSea, rosetteOk, tileElevations } from '../data/terrarium';
import { rosette, terrainFrom } from '../engine/terrain';

type Along = LatLon & { d: number };

export async function askTerrain(st: Station[], id: number) {
  const live = () => id === STATE.runId;
  const R1 = 10,
    R2 = 45,
    RT = 30,
    us = st.map(in3DEP);
  const pts: LatLon[] = [];
  st.forEach((p, i) => {
    if (us[i]) pts.push(...rosette(p, R1));
  });
  let prof: Along[] = [];
  if (st.length > 1 && STATE.verts.length > 1) {
    const v = STATE.verts,
      cum = cumLen(v),
      L: number = cum[cum.length - 1],
      n = Math.min(240, Math.max(40, Math.round(L / 2)));
    prof = Array.from({ length: n }, (_, k): Along => {
      const d = (L * k) / (n - 1);
      return { ...along(v, cum, d), d };
    });
  }
  const profUS = prof.length > 0 && prof.every(p => in3DEP(p));
  let z3: (DemSample | null)[] = [];
  try {
    if (pts.length || profUS) z3 = await dep3(pts.concat(profUS ? prof : []));
  } catch (e) {
    z3 = [];
  }
  if (!live()) return;
  let k = 0;
  const need: number[] = [];
  st.forEach((p, i) => {
    let t: ReturnType<typeof terrainFrom> = null;
    if (us[i]) {
      const z = z3.slice(k, k + 9).map(s => (s ? s.z : null));
      k += 9;
      const res = z3[k - 9]?.res;
      t = terrainFrom(z, R1, `USGS 3DEP ${res ? cellLabel(res) + ' m ' : ''}· rosette r=${R1} m`, res || 1);
    }
    if (t) STATE.results[i].sh.terr = t;
    else need.push(i);
  });
  if (profUS) {
    /* a line can cross from lidar onto the 10 m DEM: the label gives the range */
    const zp = z3.slice(k),
      rs = zp.flatMap(s => (s && s.res ? [s.res] : [])),
      lo = rs.length ? cellLabel(Math.min(...rs)) : '',
      hi = rs.length ? cellLabel(Math.max(...rs)) : '',
      src = '3DEP' + (rs.length ? ` ${lo === hi ? lo : lo + '–' + hi} m` : '');
    STATE.profile = prof.map((p, j) => ({ d: p.d, z: zp[j]?.z ?? null, src }));
  }
  if (need.length || (prof.length && !profUS)) {
    /* outside 3DEP: AWS's Terrain Tiles (mostly SRTM, 30 m), stations that share a tile sharing it;
       Open-Meteo's ~90 m DEM for any whose tile won't load */
    const tp: LatLon[] = [];
    need.forEach(i => tp.push(...rosette(st[i], RT)));
    const tz = await tileElevations(tp.concat(profUS ? [] : prof));
    if (!live()) return;
    const miss: number[] = [];
    need.forEach((i, j) => {
      const z = tz.slice(j * 9, j * 9 + 9);
      const t = rosetteOk(z)
        ? terrainFrom(z, RT, 'Terrain Tiles (mostly SRTM, ~30 m) · rosette r=30 m', 30)
        : null;
      if (!t) return miss.push(i);
      if (openSea(z as number[])) t.ocean = true;
      STATE.results[i].sh.terr = t;
    });
    let zp: (number | null)[] = prof.length && !profUS ? tz.slice(need.length * 9) : [],
      psrc = '~30 m DEM';
    if (miss.length || zp.some(v => v == null)) {
      const om: LatLon[] = [];
      miss.forEach(i => om.push(...rosette(st[i], R2)));
      const back = zp.some(v => v == null) ? prof : [];
      const omz = await openMeteo(om.concat(back));
      if (!live()) return;
      miss.forEach((i, j) => {
        const z = omz.slice(j * 9, j * 9 + 9);
        const t = terrainFrom(z, R2, 'Open-Meteo DEM (~90 m cell) · rosette r=45 m', 90);
        if (t && z.every(v => v === 0)) t.ocean = true;
        STATE.results[i].sh.terr = t || null;
      });
      if (back.length) {
        zp = omz.slice(miss.length * 9);
        psrc = '~90 m DEM';
      }
    }
    if (prof.length && !profUS) STATE.profile = prof.map((p, j) => ({ d: p.d, z: zp[j], src: psrc }));
  }
  tick();
  scheduleField();
}
