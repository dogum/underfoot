/**
 * Area mode on the map (app/area): the outline, closed once drawn, and the
 * mosaic of its tiles' field maps clipped to it. paintField draws any field
 * map's cells, for the single station's FIELD layer too (map/draw).
 */
import { STATE } from '../app/state';
import { K, RGB } from '../core/classes';
import { merc, projector } from '../core/geo';
import { clamp, fmt } from '../core/math';
import { ACRE, TILE, ringArea } from '../engine/area';
import type { FieldMap } from '../engine/field';
import { MAP, toScreen } from './map';

/** a field map's cells as an image, one pixel a cell: the call's colour, opacity for confidence; returns each call's cell count */
export function paintField(F: FieldMap, cv: HTMLCanvasElement): Map<string, number> {
  const N = F.N;
  cv.width = cv.height = N;
  const cg = cv.getContext('2d')!,
    im = cg.createImageData(N, N),
    seen = new Map<string, number>();
  for (let k = 0; k < N * N; k++) {
    let best = 0,
      bp = -1;
    for (let c = 0; c < K.length; c++) {
      const v = F.probs[k * K.length + c];
      if (v > bp) {
        bp = v;
        best = c;
      }
    }
    const rgb = RGB[K[best]];
    im.data.set(
      [rgb[0], rgb[1], rgb[2], Math.round(255 * (0.16 + 0.5 * clamp((bp - 0.3) / 0.6, 0, 1)))],
      k * 4,
    );
    seen.set(K[best], (seen.get(K[best]) || 0) + 1);
  }
  cg.putImageData(im, 0, 0);
  return seen;
}

const ringPath = (g: CanvasRenderingContext2D, close: boolean) => {
  g.beginPath();
  STATE.verts.forEach((p, i) => {
    const [x, y] = toScreen(p.lat, p.lon);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  if (close) g.closePath();
};

/** the outline: closed and lightly filled once drawn; while drawing, dashed to the cursor and back to the start */
export function drawAreaRing(g: CanvasRenderingContext2D) {
  const v = STATE.verts;
  if (!v.length) return;
  const closed = !MAP.drawing && v.length >= 3;
  g.save();
  ringPath(g, closed);
  if (closed) {
    g.fillStyle = 'rgba(240,169,46,.06)';
    g.fill();
  }
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(240,169,46,.32)';
  g.lineWidth = 6;
  g.stroke();
  g.strokeStyle = '#f0a92e';
  g.lineWidth = 1.5;
  g.stroke();
  if (MAP.drawing && MAP.cursor) {
    const c = MAP.cursor,
      [x0, y0] = toScreen(v.at(-1)!.lat, v.at(-1)!.lon),
      [x1, y1] = toScreen(c.lat, c.lon),
      [xs, ys] = toScreen(v[0].lat, v[0].lon);
    g.setLineDash([5, 5]);
    g.strokeStyle = 'rgba(240,169,46,.7)';
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    if (v.length >= 2) g.lineTo(xs, ys);
    g.stroke();
    g.setLineDash([]);
    /* what the outline would hold, closed at the cursor */
    if (v.length >= 2) {
      const P = projector(v[0].lat, v[0].lon),
        a = ringArea([...v, c].map(p => P.fwd(p.lat, p.lon)));
      g.font = '600 10px ui-monospace,monospace';
      g.fillStyle = '#f0a92e';
      g.textAlign = 'left';
      g.fillText(`${fmt(a / ACRE, a < 4 * ACRE ? 2 : 1)} ac`, x1 + 10, y1 - 8);
    }
  }
  g.restore();
}

const _tileCv = new WeakMap<FieldMap, HTMLCanvasElement>();
/** every tile read so far, as the FIELD layer draws a field map, clipped to the outline */
export function drawAreaMosaic(g: CanvasRenderingContext2D) {
  const A = STATE.area,
    v = STATE.verts;
  if (!MAP.field || !A || v.length < 3) return;
  const P = projector(v[0].lat, v[0].lon);
  g.save();
  ringPath(g, true);
  g.clip();
  A.tiles.forEach((F, t) => {
    if (!F) return;
    let cv = _tileCv.get(F);
    if (!cv) {
      cv = document.createElement('canvas');
      paintField(F, cv);
      _tileCv.set(F, cv);
    }
    const [cx, cy] = A.centres[t],
      [lat, lon] = P.inv(cx, cy),
      [x, y] = toScreen(lat, lon),
      s = TILE / merc.mpp(lat, MAP.z);
    if (s < 6) return;
    g.imageSmoothingEnabled = s / F.N < 3;
    g.drawImage(cv, x - s / 2, y - s / 2, s, s);
  });
  g.restore();
}
