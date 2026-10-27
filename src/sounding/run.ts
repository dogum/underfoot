/**
 * A sounding without a page: what is being read, its stations and what each
 * one has learned. The app's STATE is one run; the headless reader (the MCP
 * and the command line) makes its own. Nothing in src/sounding/ touches the
 * DOM, so it runs in a browser and in Node alike.
 */
import { PRIOR } from '../core/classes';
import { inCONUS, inUS } from '../core/geo';
import type {
  Crossing,
  FuseOptions,
  LatLon,
  Mode,
  SourceId,
  Station,
  StationResult,
  StructFeature,
  TileFeature,
} from '../core/types';
import type { FollowStretch } from '../engine/follow';
import type { Going } from './going';

export const MAX_STATIONS = 48;

/** a line's elevation along it, for the transect and the route card */
export interface ProfileSample {
  d: number;
  z: number | null;
  /** which elevation model it came from */
  src: string;
}

export interface Run {
  /** bumped by every new sounding: a reply for an older one is dropped */
  runId: number;
  mode: Mode;
  verts: LatLon[];
  /** station spacing: 'auto', metres as a string, or '0' for the vertices only */
  spacing: string;
  /** match stretches that follow a mapped path or road (engine/follow) */
  follow: boolean;
  /** smooth the cover classes along a line (engine/smooth) */
  smooth: boolean;
  stations: Station[];
  results: StationResult[];
  /** the station in focus: the one the gazetteer is asked about */
  sel: number;
  crossings: Crossing[];
  stretches: FollowStretch[];
  profile: ProfileSample[] | null;
  /** the run's map features and US footprints */
  osmFeats: TileFeature[] | null;
  structs: StructFeature[] | null;
  /** the walk check list, as station indices in walking order */
  checks: number[];
  going: Going | null;
  weights: Record<SourceId, number>;
  neff: number;
}

/** what a reader calls as answers land. The app re-fuses and redraws; the headless reader waits for the end */
export interface Hooks {
  /** an answer landed: re-fuse and show it */
  tick(): void;
  /** an answer the field map uses landed */
  field(): void;
  /** the map geometry is in for every station */
  mapped?(): void;
}
export const QUIET: Hooks = { tick() {}, field() {} };

/** a reply belongs to this run only while no newer sounding has started */
export const current = (run: Run, id: number) => id === run.runId;

export function fuseOpt(run: Run): FuseOptions {
  return { weights: run.weights, neff: run.neff, prior: PRIOR };
}

/** a result for each station, nothing read yet: undefined means asking, null means no coverage */
export function freshResults(st: Station[], gazFor: number | null): StationResult[] {
  return st.map((p, i) => ({
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
      gazAsked: i === gazFor,
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
}
