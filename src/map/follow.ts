/**
 * Following, on the map: the followed stretch of each path or road drawn solid
 * in its class colour (the map's own lines are dashed, so solid means followed),
 * and a faint tie from each station back to where the line put it.
 */
import { STATE } from '../app/state';
import { COL } from '../core/classes';

type ToScreen = (lat: number, lon: number) => [number, number];

/** a station that moved less than this onto the followed line gets no tie */
export const TIE_MIN = 2;

export function drawFollow(g: CanvasRenderingContext2D, toScreen: ToScreen) {
  if (STATE.mode !== 'path') return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of STATE.stretches) {
    if (s.geom.length < 2) continue;
    g.beginPath();
    s.geom.forEach(([lat, lon], i) => {
      const [x, y] = toScreen(lat, lon);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = 'rgba(11,14,18,.65)';
    g.lineWidth = 6.5;
    g.stroke();
    g.strokeStyle = COL[s.cls];
    g.lineWidth = 3.4;
    g.stroke();
  }
  g.lineWidth = 1;
  for (const st of STATE.stations) {
    if (!st.raw || !st.f || st.f.off < TIE_MIN) continue;
    const [x0, y0] = toScreen(st.raw.lat, st.raw.lon),
      [x1, y1] = toScreen(st.lat, st.lon);
    g.setLineDash([2, 2.4]);
    g.strokeStyle = 'rgba(232,238,244,.62)';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(x0, y0, 2.2, 0, 7);
    g.fillStyle = 'rgba(11,14,18,.35)';
    g.fill();
    g.strokeStyle = 'rgba(232,238,244,.8)';
    g.stroke();
  }
  g.restore();
}
