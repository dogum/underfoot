/**
 * Laying a line on the map before it's read: the mapped features along it,
 * the stretches that follow a mapped path or road (engine/follow), a station
 * at each crossing, and the stations on a followed stretch moved onto it.
 */
import { NO_FOLLOW, followLines } from '../engine/follow';
import { mapFeatures } from './read';
import { findCrossings, mergeCrossings, snapStations } from './stations';
import type { Run } from './run';
import type { Station, TileFeature } from '../core/types';

/** the line's mapped features, or null if any tile couldn't be read (or wasn't, once `live` turned false) */
export const lineFeatures = (st: Station[], live?: () => boolean): Promise<TileFeature[] | null> =>
  mapFeatures(st, live).catch(() => null);

/** the line's stations with its crossings and followed stretches; the run keeps both */
export function layLine(run: Run, st: Station[], feats: TileFeature[] | null): Station[] {
  run.stretches = [];
  if (!feats) return st;
  const fol = run.follow ? followLines(run.verts, feats) : NO_FOLLOW;
  const cr = findCrossings(run.verts, feats, fol);
  run.crossings = cr;
  run.stretches = fol.stretches;
  return snapStations(mergeCrossings(run.verts, st, cr), fol);
}
