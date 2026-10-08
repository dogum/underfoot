// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * STATE: the one mutable record of what is being sounded and how — mode,
 * vertices, stations, results, weights, N_eff, prior, GPS σ, smoothing.
 */
import { PRIOR, SOURCES, usePrior } from '../core/classes';
import { DEFAULT_NEFF } from '../engine/fuse';

export const MAX_STATIONS = 48;
export const STATE = {
  mode: 'point',
  verts: [],
  spacing: 'auto',
  stations: [],
  results: [],
  sel: 0,
  weights: Object.fromEntries(SOURCES.map(s => [s.id, s.w])),
  neff: DEFAULT_NEFF,
  priorName: 'probed',
  gps: 0,
  smooth: true,
  runId: 0,
  field: null,
  crossings: [],
  /** match stretches that follow a mapped path or road (engine/follow) */
  follow: true,
  stretches: [],
  osmFeats: null,
  structs: null,
  profile: null,
  running: false,
};
export function setPrior(name) {
  usePrior(name);
  STATE.priorName = name;
}
export function fuseOpt() {
  return { weights: STATE.weights, neff: STATE.neff, prior: PRIOR };
}
