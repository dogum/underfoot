/**
 * The per-station readers of a run: the map (OSM tiles and US footprints, then
 * each station's geometry), the imagery patch under each station and the date
 * of the photo, NLCD, and the gazetteer for the station in focus. Every
 * reply checks the run it was asked for before it writes.
 */
import { inCONUS, inUS } from '../core/geo';
import { structuresFor } from '../data/fema';
import { pool } from '../data/http';
import { imageryMeta, imageryRaster } from '../data/imagery';
import { nlcd } from '../data/nlcd';
import { nominatim } from '../data/nominatim';
import { ofmTile, tilesFor } from '../data/openfreemap';
import { buildGeo, geoAt } from '../engine/geometry';
import { imgFeatures } from '../engine/imagery-model';
import { current } from './run';
import type { Hooks, Run } from './run';
import type { ImageryMeta, NlcdFacts, Station, StructFeature, TileFeature } from '../core/types';

/** the mapped features around the stations; throws if any tile couldn't be read, or wasn't once `live` turned false */
export async function mapFeatures(st: Station[], live?: () => boolean): Promise<TileFeature[]> {
  const dec = await pool(tilesFor(st, 200), 4, ([x, y]) => ofmTile(x, y), live);
  if (dec.some(d => !d)) throw new Error(dec.every(d => !d) ? 'tile CDN unreachable' : 'some tiles failed');
  return dec.flatMap(d => d!.feats);
}

/** 1 · OSM geometry from vector tiles, and US footprints: the geometry index needs both */
export function readMap(
  run: Run,
  st: Station[],
  id: number,
  hooks: Hooks,
  early: Promise<TileFeature[] | null> | null,
): Promise<void> {
  const live = () => current(run, id);
  const pOsm = (async () => {
    try {
      if (early) {
        const f = await early;
        if (f) return f;
      }
      return await mapFeatures(st, live);
    } catch (e) {
      if (live()) run.results.forEach(r => (r.sh.osmErr = String((e as Error).message || e)));
      return [];
    }
  })();
  const pSt = (async (): Promise<StructFeature[]> => {
    const us = st.filter(inUS);
    if (!us.length) return [];
    try {
      return await structuresFor(us, 60, live);
    } catch (e) {
      if (live()) run.results.forEach(r => (r.sh.structErr = String((e as Error).message || e)));
      return [];
    }
  })();
  return Promise.all([pOsm, pSt]).then(([feats, structs]) => {
    if (!live()) return;
    run.osmFeats = feats;
    run.structs = structs;
    run.results.forEach(r => {
      r.sh.structOk = !r.sh.structErr;
      r.geo = buildGeo(r.station, feats, structs, 170);
      r.q = geoAt(r.geo, 0, 0, true);
      if (r.station.x) {
        r.q.crossing = r.station.x.cls;
        if (r.station.x.over) r.q.over = r.station.x.over;
      }
      if (r.station.f) r.q.follow = r.station.f.cls;
    });
    hooks.tick();
    hooks.mapped?.();
  });
}

/** 2 · the imagery patch under each station, for the classifier */
export function readImagery(run: Run, st: Station[], id: number, hooks: Hooks) {
  return pool(
    st,
    4,
    async (p, i) => {
      const R = await imageryRaster(p.lat, p.lon, 24);
      if (!current(run, id)) return;
      const r = run.results[i];
      if (R) {
        r.img = R;
        r.feat = imgFeatures(R.data.data, R.W, 24, 24);
        if (R.z < 18) {
          r.sh.imgWmul = 0.6;
        }
      } else r.sh.imgErr = 'no orthoimagery could be read here';
      hooks.tick();
    },
    () => current(run, id),
  );
}

/** 2 · what each photo is: its date and resolution, asked once per 0.01° cell */
export async function readPhotoDates(run: Run, st: Station[], id: number, hooks: Hooks) {
  const cells = new Map<string, number[]>();
  st.forEach((p, i) => {
    const k = Math.round(p.lat * 100) + ':' + Math.round(p.lon * 100);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(i);
  });
  await pool(
    [...cells.values()],
    3,
    async idx => {
      const p = st[idx[0]];
      let m: ImageryMeta | null = null;
      try {
        m = await imageryMeta(p.lat, p.lon);
      } catch {}
      if (!current(run, id)) return;
      for (const i of idx) {
        const sh = run.results[i].sh;
        sh.imeta = m;
        /* coarse imagery (Landsat-class, 15 m) under a z18 tile is upsampled
         mush — its texture statistics are not the ones the model learned */
        if (m && (m.res ?? 0) > 2) sh.imgWmul = Math.min(sh.imgWmul ?? 1, 0.5);
      }
      hooks.tick();
    },
    () => current(run, id),
  );
}

/** 3 · NLCD rasters, one request per station for all four */
export function readCover(run: Run, st: Station[], id: number, hooks: Hooks) {
  return pool(
    st,
    5,
    async (p, i) => {
      if (!inCONUS(p)) return;
      let v: NlcdFacts | null = null;
      try {
        v = await nlcd(p.lat, p.lon);
      } catch {
        v = null;
      }
      if (current(run, id)) {
        run.results[i].sh.nlcd = v;
        hooks.tick();
        hooks.field();
      }
    },
    () => current(run, id),
  );
}

/** the gazetteer (Nominatim) for one station: one request a second at most (data/nominatim) */
export async function readGaz(
  run: Run,
  i: number,
  id: number | null | undefined,
  hooks: Hooks,
): Promise<void> {
  const r = run.results[i];
  if (!r || r.sh.nom !== undefined) return;
  r.sh.gazAsked = true;
  hooks.tick();
  let g = null;
  try {
    g = await nominatim(r.station.lat, r.station.lon);
  } catch {
    g = null;
  }
  if (id != null && !current(run, id)) return;
  if (run.results[i] === r) {
    r.sh.nom = g;
    hooks.tick();
    hooks.field();
  }
}
