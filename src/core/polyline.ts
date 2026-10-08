/**
 * Lines in links: a compact, URL-safe encoding for long lines, and the
 * simplification that keeps them short.
 *
 * The encoding is Google's polyline algorithm (zig-zag deltas in 5-bit groups
 * with a continuation bit) at 1e-6 degrees, about 0.1 m, with the base64url
 * alphabet instead of ASCII 63–126, so nothing in it needs escaping in a URL.
 * A GPS track costs about four characters a point.
 */
import { projector } from './geo';
import type { LatLon } from './types';

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SCALE = 1e6;

export function encodeLine(pts: LatLon[]): string {
  let out = '',
    plat = 0,
    plon = 0;
  const put = (v: number) => {
    let z = v < 0 ? ~(v << 1) : v << 1;
    while (z >= 0x20) {
      out += ABC[0x20 | (z & 0x1f)];
      z >>>= 5;
    }
    out += ABC[z];
  };
  for (const p of pts) {
    const lat = Math.round(p.lat * SCALE),
      lon = Math.round(p.lon * SCALE);
    put(lat - plat);
    put(lon - plon);
    plat = lat;
    plon = lon;
  }
  return out;
}

/** the points of an encoded line; null if the string isn't one */
export function decodeLine(s: string): LatLon[] | null {
  const out: LatLon[] = [];
  let i = 0,
    lat = 0,
    lon = 0;
  const get = () => {
    let shift = 0,
      z = 0,
      c: number;
    do {
      if (i >= s.length) return null;
      c = ABC.indexOf(s[i++]);
      if (c < 0) return null;
      z |= (c & 0x1f) << shift;
      shift += 5;
    } while (c >= 0x20 && shift < 35);
    return z & 1 ? ~(z >>> 1) : z >>> 1;
  };
  while (i < s.length) {
    const a = get(),
      b = get();
    if (a == null || b == null) return null;
    lat += a;
    lon += b;
    const p = { lat: lat / SCALE, lon: lon / SCALE };
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
    out.push(p);
  }
  return out;
}

/** Douglas–Peucker in local metres: the fewest points that stay within tol of the line */
export function simplifyLine(pts: LatLon[], tol: number): LatLon[] {
  if (pts.length < 3) return pts.slice();
  const P = projector(pts[0].lat, pts[0].lon),
    xy = pts.map(p => P.fwd(p.lat, p.lon)),
    keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!,
      [ax, ay] = xy[i],
      [bx, by] = xy[j],
      dx = bx - ax,
      dy = by - ay,
      L2 = dx * dx + dy * dy || 1e-12;
    let m = -1,
      k = -1;
    for (let q = i + 1; q < j; q++) {
      const t = Math.max(0, Math.min(1, ((xy[q][0] - ax) * dx + (xy[q][1] - ay) * dy) / L2)),
        d = Math.hypot(ax + t * dx - xy[q][0], ay + t * dy - xy[q][1]);
      if (d > m) {
        m = d;
        k = q;
      }
    }
    if (m > tol) {
      keep[k] = 1;
      stack.push([i, k], [k, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** a line short enough for a link: simplified to 1 m, then coarser until it fits in max points */
export function linkLine(pts: LatLon[], max = 1500): LatLon[] {
  let tol = 1,
    out = simplifyLine(pts, tol);
  while (out.length > max) out = simplifyLine(pts, (tol *= 2));
  return out;
}
