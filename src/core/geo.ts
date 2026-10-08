/**
 * Geometry: great-circle distance, local tangent-plane metres, segment and
 * ring tests on flat coordinate arrays, web-mercator tile maths, and the
 * coverage envelopes of the US-only services.
 */
import { clamp } from './math';
import type { LatLon } from './types';

/* ---------------------------------------------------------------- geometry */
export const R_E = 6378137,
  D2R = Math.PI / 180,
  R2D = 180 / Math.PI;
export function haversine(a: LatLon, b: LatLon) {
  const dLat = (b.lat - a.lat) * D2R,
    dLon = (b.lon - a.lon) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_E * Math.asin(Math.min(1, Math.sqrt(s)));
}
/* local tangent-plane metres: exact to well under a centimetre over the
   few-hundred-metre windows this works in */
export interface Projector {
  kx: number;
  ky: number;
  fwd(lat: number, lon: number): [number, number];
  inv(x: number, y: number): [number, number];
}
export function projector(lat0: number, lon0: number): Projector {
  const kx = R_E * D2R * Math.cos(lat0 * D2R),
    ky = R_E * D2R;
  return {
    kx,
    ky,
    fwd: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    inv: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  };
}
export function offset(p: LatLon, dx: number, dy: number): LatLon {
  return { lat: p.lat + dy / 111320, lon: p.lon + dx / (111320 * Math.max(0.15, Math.cos(p.lat * D2R))) };
}
/* squared distance from (px,py) to segment — kept squared on the hot path */
export function segD2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay,
    L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px,
    ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}
/* flat coordinate arrays [x0,y0,x1,y1,…] throughout the engine */
export function polyD2(px: number, py: number, a: ArrayLike<number>) {
  let m = Infinity;
  for (let i = 0; i < a.length - 2; i += 2) {
    const d = segD2(px, py, a[i], a[i + 1], a[i + 2], a[i + 3]);
    if (d < m) m = d;
  }
  return m;
}
export function ringContains(px: number, py: number, a: ArrayLike<number>) {
  let ins = false;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
    const yi = a[i + 1],
      yj = a[j + 1];
    if (yi > py !== yj > py && px < ((a[j] - a[i]) * (py - yi)) / (yj - yi) + a[i]) ins = !ins;
  }
  return ins;
}
export function ringArea(a: ArrayLike<number>) {
  let s = 0;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) s += (a[j] + a[i]) * (a[j + 1] - a[i + 1]);
  return Math.abs(s / 2);
}

export const merc = {
  x: (lon: number, z: number) => ((lon + 180) / 360) * Math.pow(2, z),
  y: (lat: number, z: number) =>
    ((1 - Math.asinh(Math.tan(clamp(lat, -85.05, 85.05) * D2R)) / Math.PI) / 2) * Math.pow(2, z),
  lon: (x: number, z: number) => (x / Math.pow(2, z)) * 360 - 180,
  lat: (y: number, z: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / Math.pow(2, z)))) * R2D,
  mpp: (lat: number, z: number) => (156543.03392 * Math.cos(lat * D2R)) / Math.pow(2, z),
};
/* coverage envelopes for the US-only services */
export const inCONUS = (p: LatLon) => p.lat > 24.3 && p.lat < 49.5 && p.lon > -125 && p.lon < -66.8;
export const in3DEP = (p: LatLon) =>
  inCONUS(p) ||
  (p.lat > 51 && p.lat < 71.6 && p.lon > -180 && p.lon < -129) ||
  (p.lat > 18.8 && p.lat < 22.4 && p.lon > -160.5 && p.lon < -154.6) ||
  (p.lat > 17.8 && p.lat < 18.6 && p.lon > -67.4 && p.lon < -65.1);
export const inUS = (p: LatLon) => in3DEP(p);
