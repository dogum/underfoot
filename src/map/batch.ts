/**
 * Batch points on the map (app/batch): every point in its call's colour,
 * points not read yet hollow, the group being read ringed, and the point in
 * focus marked. A click near a point brings its row into view (ui/batch).
 */
import { STATE } from '../app/state';
import { COL } from '../core/classes';

type ToScreen = (lat: number, lon: number) => [number, number];

export function drawBatch(g: CanvasRenderingContext2D, toScreen: ToScreen, W: number, H: number) {
  const B = STATE.batch;
  if (!B) return;
  const reading = new Set(B.status === 'reading' ? B.groups[B.next] || [] : []),
    many = B.pts.length > 200;
  B.pts.forEach((p, i) => {
    const [x, y] = toScreen(p.lat, p.lon);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
    const r = B.rows[i],
      rad = many ? 3.6 : 5;
    g.beginPath();
    g.arc(x, y, rad, 0, 7);
    if (r) {
      g.fillStyle = COL[r.call];
      g.fill();
      g.strokeStyle = 'rgba(11,14,18,.9)';
      g.lineWidth = 1.2;
    } else {
      g.strokeStyle = reading.has(i) ? '#f0a92e' : 'rgba(232,238,244,.55)';
      g.lineWidth = 1.5;
    }
    g.stroke();
  });
  if (B.focus != null) {
    const p = B.pts[B.focus],
      [x, y] = toScreen(p.lat, p.lon);
    g.beginPath();
    g.arc(x, y, 10, 0, 7);
    g.strokeStyle = '#f0a92e';
    g.lineWidth = 2;
    g.stroke();
  }
}

/** the batch point within `px` of a screen position, nearest first; -1 if none */
export function hitBatch(x: number, y: number, toScreen: ToScreen, px = 14): number {
  const B = STATE.batch;
  if (!B) return -1;
  let best = -1,
    bd = px * px;
  B.pts.forEach((p, i) => {
    const [sx, sy] = toScreen(p.lat, p.lon),
      d = (sx - x) ** 2 + (sy - y) ** 2;
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
