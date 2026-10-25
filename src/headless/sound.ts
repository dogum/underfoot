/**
 * A sounding without a browser: the same readers and fusion the app uses
 * (src/sounding/), run to a deadline. Sources land when they land; at the
 * deadline whatever arrived is fused, and the ledger says which sources are
 * still out. Call useNode() (headless/node) first when running under Node.
 */
import BUNDLED from '../../model/weights.json';
import { defaultFit } from '../engine/refit';
import { finishRun, fuseStations } from '../sounding/fuse';
import { layLine, lineFeatures } from '../sounding/line';
import { readCover, readGaz, readImagery, readMap, readPhotoDates } from '../sounding/read';
import { QUIET, freshResults } from '../sounding/run';
import type { Run } from '../sounding/run';
import { stationsFor } from '../sounding/stations';
import { readTerrain } from '../sounding/terrain';
import { readPass, readSoils, readToday, readWorld } from '../sounding/whole';
import type { LatLon, SourceId, WeightsFile } from '../core/types';

export interface SoundRequest {
  mode: 'point' | 'path';
  /** the point, or the line's vertices in order */
  verts: LatLon[];
  /** 'auto' (up to 48 stations, plus crossings), metres as a string, or '0' for the vertices */
  spacing?: string;
  /** match stretches that follow a mapped path or road; default true */
  follow?: boolean;
  /** smooth the cover classes along a line; default true */
  smooth?: boolean;
  /** ask the gazetteer about the first station (one request a second); default true */
  gaz?: boolean;
  /** fuse what has arrived by then, ms; default 30,000 */
  deadlineMs?: number;
}
export interface Sounding {
  run: Run;
  /** every source answered before the deadline */
  complete: boolean;
  ms: number;
  /** the weights used, as the app's ledger names them */
  weights: { version: number; label: string };
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
    deadline = req.deadlineMs ?? 30000;
  let st = stationsFor(run),
    early = null;
  if (run.mode === 'path' && run.verts.length > 1) {
    early = lineFeatures(st);
    st = layLine(run, st, await early);
  }
  run.stations = st;
  const gaz = req.gaz ?? true;
  run.results = freshResults(st, gaz ? run.sel : null);
  const all = Promise.allSettled([
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
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const complete = await Promise.race([
    all.then(() => true),
    new Promise<boolean>(
      z => (timer = setTimeout(() => z(false), Math.max(0, deadline - (Date.now() - t0)))),
    ),
  ]);
  clearTimeout(timer);
  /* replies after the deadline belong to no one: they find a newer run and are dropped */
  run.runId++;
  fuseStations(run);
  finishRun(run);
  const b = baseline();
  return { run, complete, ms: Date.now() - t0, weights: { version: b.version, label: b.label } };
}
