/**
 * Batch points, pure: which points are read together, what each one's row
 * says, and the order the table shows them in.
 *
 * Points read together share their requests: map tiles, footprint cells, one
 * weather request, one satellite search, one soil query and one land-cover
 * request. So a group is up to GROUP points that sit close together: the
 * points are put in order along a Hilbert curve (neighbours on the curve are
 * neighbours on the ground) and cut wherever a group would pass GROUP points
 * or spread wider than SPAN degrees.
 */
import type { ClassKey, LatLon } from '../core/types';

export const BATCH = {
  /** the most points a batch reads */
  max: 1000,
  /** the most points read together */
  group: 40,
  /** degrees: the widest a group may spread, north–south or east–west (about 20 km) */
  span: 0.2,
};

/** a point's position along a Hilbert curve over the whole globe, at 2^16 cells a side */
export function hilbert(p: LatLon, order = 16): number {
  const n = 1 << order;
  let x = Math.min(n - 1, Math.floor(((p.lon + 180) / 360) * n)),
    y = Math.min(n - 1, Math.floor(((p.lat + 90) / 180) * n)),
    d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0,
      ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
}

/** the points' indices in groups that are read together: nearby, at most `group` each */
export function groupPoints(pts: LatLon[], group = BATCH.group, span = BATCH.span): number[][] {
  const order = pts.map((p, i) => [hilbert(p), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    out: number[][] = [];
  let cur: number[] = [],
    box = [0, 0, 0, 0];
  for (const [, i] of order) {
    const p = pts[i];
    const next = cur.length
      ? [Math.min(box[0], p.lat), Math.max(box[1], p.lat), Math.min(box[2], p.lon), Math.max(box[3], p.lon)]
      : [p.lat, p.lat, p.lon, p.lon];
    if (cur.length && (cur.length >= group || next[1] - next[0] > span || next[3] - next[2] > span)) {
      out.push(cur);
      cur = [i];
      box = [p.lat, p.lat, p.lon, p.lon];
    } else {
      cur.push(i);
      box = next;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** What a batch keeps for each point once it's read. */
export interface BatchRow {
  call: ClassKey;
  /** the call's probability */
  p: number;
  then: ClassKey;
  pThen: number;
  /** how many sources answered */
  src: number;
  /** the doubt score (engine/doubt): 0.5 or more is worth a look */
  doubt: number;
}

/** the read rows' indices, least sure first (lowest probability for the call); unread points last, in file order */
export function leastSureFirst(rows: (BatchRow | null)[]): number[] {
  return rows
    .map((r, i) => i)
    .sort((a, b) => {
      const ra = rows[a],
        rb = rows[b];
      if (!ra || !rb) return ra ? -1 : rb ? 1 : a - b;
      return ra.p - rb.p || a - b;
    });
}
