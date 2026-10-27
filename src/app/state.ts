/**
 * STATE: the one mutable record of what is being sounded and how — mode,
 * vertices, stations, results, weights, N_eff, prior, GPS σ, smoothing.
 */
import { PRIOR, SOURCES, usePrior } from '../core/classes';
import { DEFAULT_NEFF } from '../engine/fuse';
import type {
  Crossing,
  FuseOptions,
  LatLon,
  Mode,
  PriorName,
  SourceId,
  Station,
  StationResult,
  StructFeature,
  TileFeature,
} from '../core/types';

export { MAX_STATIONS } from '../sounding/run';
export type { Mode };
export const STATE = {
  mode: 'point' as Mode,
  verts: [] as LatLon[],
  /** station spacing: 'auto', metres as a string, or '0' for the vertices only */
  spacing: 'auto' as string,
  stations: [] as Station[],
  results: [] as StationResult[],
  sel: 0,
  /** a link's at=: once the line is read, select the station nearest this many metres along */
  at: null as number | null,
  /** the walk check list, as station indices in walking order (engine/doubt checkList) */
  checks: [] as number[],
  /** area mode's outline, tiles and acres (app/area) */
  area: null as import('./area').AreaState | null,
  /** go / slow / no-go for each station and the line (sounding/going) */
  going: null as import('../sounding/going').Going | null,
  /** batch points (app/batch): the file's points, read in groups */
  batch: null as import('./batch').BatchState | null,
  /** the time machine for the station in focus (app/years) */
  years: null as import('./years').YearsState | null,
  weights: Object.fromEntries(SOURCES.map(s => [s.id, s.w])) as Record<SourceId, number>,
  neff: DEFAULT_NEFF,
  priorName: 'probed' as PriorName,
  gps: 0,
  smooth: true,
  runId: 0,
  field: null as import('./field').FieldState | null,
  crossings: [] as Crossing[],
  /** match stretches that follow a mapped path or road (engine/follow) */
  follow: true,
  stretches: [] as import('../engine/follow').FollowStretch[],
  /** Here: the phone's position, read as it moves (app/live) */
  live: {
    on: false,
    rec: false,
    fixes: [],
    last: null,
    read: null,
    track: [],
    started: 0,
    err: null,
    watch: null,
    gazAt: 0,
  } as import('./live').LiveState,
  /** the run's map features and US footprints, for crossings and following */
  osmFeats: null as TileFeature[] | null,
  structs: null as StructFeature[] | null,
  /** a line's elevation along it, for the transect */
  profile: null as { d: number; z: number | null; src: string }[] | null,
  running: false,
};
export function setPrior(name: PriorName) {
  usePrior(name);
  STATE.priorName = name;
}
export function fuseOpt(): FuseOptions {
  return { weights: STATE.weights, neff: STATE.neff, prior: PRIOR };
}

/** a mode drawn vertex by vertex: a line, or an area's outline */
export const drawn = () => STATE.mode === 'path' || STATE.mode === 'area';
