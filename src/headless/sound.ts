/**
 * A sounding without a browser: the same readers and fusion the app uses
 * (src/sounding/), run to a deadline. Sources land when they land; at the
 * deadline whatever arrived is fused, and the ledger says which sources are
 * still out. An area then reads each tile's field map and sums it; a signal
 * ends either early, the same way. Call useNode() (headless/node) first when
 * running under Node.
 */
import BUNDLED from '../../model/weights.json';
import { PRIOR } from '../core/classes';
import { positional } from '../engine/field';
import { finishPosterior } from '../engine/fuse';
import { defaultFit } from '../engine/refit';
import { newArea } from '../sounding/area';
import type { AreaTiles } from '../sounding/area';
import { readField, readTiles } from '../sounding/field';
import { finishRun, fuseStations } from '../sounding/fuse';
import { layLine, lineFeatures } from '../sounding/line';
import { readCover, readGaz, readImagery, readMap, readPhotoDates } from '../sounding/read';
import { QUIET, freshResults, fuseOpt } from '../sounding/run';
import type { Run } from '../sounding/run';
import { stationsFor } from '../sounding/stations';
import { readTerrain } from '../sounding/terrain';
import { readPass, readSoils, readToday, readWorld } from '../sounding/whole';
import type { LatLon, Mode, SourceId, WeightsFile } from '../core/types';

export interface SoundRequest {
  mode: Mode;
  /** the point, the line's vertices in order, an area's outline, or a batch's points */
  verts: LatLon[];
  /** 'auto' (up to 48 stations, plus crossings), metres as a string, or '0' for the vertices */
  spacing?: string;
  /** match stretches that follow a mapped path or road; default true */
  follow?: boolean;
  /** smooth the cover classes along a line; default true */
  smooth?: boolean;
  /** ask the gazetteer about the first station (one request a second); default true, never in a batch */
  gaz?: boolean;
  /** a point's GPS spread, m (σ): the answer becomes the field map averaged under that disc; 0 takes the coordinate as exact */
  gps?: number;
  /** fuse what has arrived by then, ms; default 30,000 */
  deadlineMs?: number;
  /** stop asking: what has arrived is fused, as at the deadline */
  signal?: AbortSignal;
  /** an area's tiles: called as each one lands */
  landed?: (read: number, of: number) => void;
}
export interface Sounding {
  run: Run;
  /** every source answered before the deadline */
  complete: boolean;
  ms: number;
  /** the weights used, as the app's ledger names them */
  weights: { version: number; label: string };
  /** the GPS disc asked for, and whether the answer is its average (not on a station moved onto a followed path) */
  gps: { m: number; applied: boolean };
  /** an area's tiles and their sum; null for any other mode, or an outline too big to read */
  area: AreaTiles | null;
}

const community = BUNDLED as WeightsFile;
/** the weights the app starts from: the published community weights over the defaults (version 0 is the defaults) */
export function baseline() {
  const d = defaultFit();
  return {
    weights: { ...d.weights, ...community.weights } as Record<SourceId, number>,
    neff: community.neff || d.neff,
    version: community.version,
    label: community.version ? `community v${community.version}` : 'defaults v0',
  };
}

export function newRun(req: SoundRequest): Run {
  const b = baseline();
  return {
    runId: 1,
    mode: req.mode,
    verts: req.verts.map(p => ({ lat: p.lat, lon: p.lon })),
    spacing: req.spacing ?? 'auto',
    follow: req.follow ?? true,
    smooth: req.smooth ?? true,
    stations: [],
    results: [],
    sel: 0,
    crossings: [],
    stretches: [],
    profile: null,
    osmFeats: null,
    structs: null,
    checks: [],
    going: null,
    weights: b.weights,
    neff: b.neff,
  };
}

/** read a point or a line, as the app would, and fuse what arrived by the deadline */
export async function sound(req: SoundRequest): Promise<Sounding> {
  const t0 = Date.now(),
    run = newRun(req),
    id = run.runId,
    deadline = req.deadlineMs ?? 30000,
    stop = req.signal;
  let st = stationsFor(run),
    early = null;
  if (run.mode === 'path' && run.verts.length > 1) {
    early = lineFeatures(st, () => !stop?.aborted);
    st = layLine(run, st, await early);
  }
  run.stations = st;
  const gaz = run.mode !== 'batch' && (req.gaz ?? true);
  run.results = freshResults(st, gaz ? run.sel : null);
  /* stopped while the line's map was read: no other reader is begun */
  const all = Promise.allSettled(
    stop?.aborted
      ? []
      : [
          readMap(run, st, id, QUIET, early),
          readImagery(run, st, id, QUIET),
          readPhotoDates(run, st, id, QUIET),
          readTerrain(run, st, id, QUIET),
          readToday(run, st, id, QUIET),
          readPass(run, st, id, QUIET),
          readSoils(run, st, id, QUIET),
          gaz && st.length ? readGaz(run, run.sel, id, QUIET) : null,
          (() => {
            const cover = readCover(run, st, id, QUIET);
            return Promise.all([cover, readWorld(run, st, id, QUIET, cover)]);
          })(),
        ],
  );
  const left = () => Math.max(0, deadline - (Date.now() - t0));
  let open = true;
  const live = () => open && !stop?.aborted;
  let complete = await before(
    all.then(() => true),
    left(),
    false,
    stop,
  );
  /* a GPS disc averages the field map around the point, read once its own sources are in */
  const gps = run.mode === 'point' ? (req.gps ?? 0) : 0,
    r = run.results[0];
  let field = null;
  if (gps > 0 && r && !r.station.f && live()) {
    field = await before(readField(r, fuseOpt(run), live), left(), null, stop);
    if (!field) complete = false;
  }
  /* an area: every tile's field map, summed into acres (engine/area) */
  const area = run.mode === 'area' ? newArea(run.verts) : null;
  if (area && live()) {
    const n = () => area.tiles.filter(Boolean).length;
    const done = readTiles(run, area, live, () => req.landed?.(n(), area.tiles.length));
    if (
      !(await before(
        done.then(() => true),
        left(),
        false,
        stop,
      ))
    )
      complete = false;
  }
  /* replies after the deadline belong to no one: they find a newer run and are dropped */
  open = false;
  run.runId++;
  fuseStations(run);
  const pp = field && positional(field, gps);
  if (pp) {
    r.view = finishPosterior(pp, {
      parts: r.parts,
      tau: r.fused!.tau,
      wsum: r.fused!.wsum,
      W: run.weights,
      prior: PRIOR,
    });
    r.mode = 'gps';
  }
  finishRun(run);
  const b = baseline();
  return {
    run,
    complete,
    ms: Date.now() - t0,
    weights: { version: b.version, label: b.label },
    gps: { m: gps, applied: !!pp },
    area,
  };
}

/** p's value if it settles within ms and before the signal, else `late` */
async function before<T, L>(p: Promise<T>, ms: number, late: L, stop?: AbortSignal): Promise<T | L> {
  if (stop?.aborted) return late;
  let timer: ReturnType<typeof setTimeout> | undefined, quit: (() => void) | undefined;
  const v = await Promise.race([
    p,
    new Promise<L>(z => {
      timer = setTimeout(() => z(late), ms);
      quit = () => z(late);
      stop?.addEventListener('abort', quit, { once: true });
    }),
  ]);
  clearTimeout(timer);
  if (quit) stop?.removeEventListener('abort', quit);
  return v;
}
