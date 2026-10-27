/**
 * Many separate points without a browser, read as the app's batch reads them
 * (app/batch): in groups of nearby points (engine/batch), one group at a time
 * so each service sees a steady pace, each group one headless sounding. A
 * signal stops it between groups; a group it cuts off is left unread.
 */
import { BATCH, groupPoints, rowOf, unanswered } from '../engine/batch';
import type { BatchRow } from '../engine/batch';
import { sound } from './sound';
import type { Sounding, SoundRequest } from './sound';
import type { LatLon } from '../core/types';

export interface PointsRequest {
  /** up to BATCH.max points; any beyond are left out */
  points: LatLon[];
  /** each group's deadline, ms; default 30,000 */
  deadlineMs?: number;
  signal?: AbortSignal;
  /** called as each group is kept: groups read so far, and of how many */
  group?: (read: number, of: number) => void;
}
export interface PointsRead {
  /** one per point, in the order given; null for a point not read */
  rows: (BatchRow | null)[];
  groups: number;
  /** groups read */
  read: number;
  /** sources that hadn't answered when a group was kept, summed over its points, by source */
  missing: Record<string, number>;
  /** every group read and every source answered */
  complete: boolean;
  /** points beyond the most a batch reads, left out */
  dropped: number;
  ms: number;
  weights: Sounding['weights'] | null;
}

export async function soundPoints(
  req: PointsRequest,
  read: (r: SoundRequest) => Promise<Sounding> = sound,
): Promise<PointsRead> {
  const t0 = Date.now(),
    pts = req.points.slice(0, BATCH.max),
    groups = groupPoints(pts),
    out: PointsRead = {
      rows: pts.map(() => null),
      groups: groups.length,
      read: 0,
      missing: {},
      complete: true,
      dropped: req.points.length - pts.length,
      ms: 0,
      weights: null,
    };
  for (const g of groups) {
    if (req.signal?.aborted) break;
    const so = await read({
      mode: 'batch',
      verts: g.map(i => pts[i]),
      deadlineMs: req.deadlineMs ?? 30000,
      signal: req.signal,
    });
    if (req.signal?.aborted) break;
    g.forEach((i, k) => {
      const r = so.run.results[k];
      out.rows[i] = rowOf(r);
      for (const id of unanswered(r)) out.missing[id] = (out.missing[id] || 0) + 1;
    });
    if (!so.complete) out.complete = false;
    out.weights = so.weights;
    out.read++;
    req.group?.(out.read, groups.length);
  }
  if (out.read < groups.length) out.complete = false;
  out.ms = Date.now() - t0;
  return out;
}
