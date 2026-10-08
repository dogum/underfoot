/**
 * Here, on the map: the walk being recorded, the trail of recent fixes, the
 * newest fix's accuracy disc, and the walker, moved onto the trail they're
 * following when the matcher found one.
 */
import { STATE } from '../app/state';
import { merc } from '../core/geo';
import { recentWindow } from '../engine/live';

type ToScreen = (lat: number, lon: number) => [number, number];

/** true while Here draws the probe itself, in place of the usual station marker and GPS disc */
export const liveDraws = () => STATE.live.on && STATE.mode === 'point';

export function drawLive(g: CanvasRenderingContext2D, toScreen: ToScreen, z: number) {
  const L = STATE.live;
  if (!L.on) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  /* the recording */
  if (L.rec && L.track.length > 1) {
    g.beginPath();
    L.track.forEach((p, i) => {
      const [x, y] = toScreen(p.lat, p.lon);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = 'rgba(240,169,46,.32)';
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = '#f0a92e';
    g.lineWidth = 1.5;
    g.stroke();
  }
  /* the fixes behind the newest one, fading with age */
  const w = recentWindow(L.fixes),
    n = w.length;
  if (!L.rec && n > 1) {
    g.beginPath();
    w.forEach((p, i) => {
      const [x, y] = toScreen(p.lat, p.lon);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = 'rgba(79,176,239,.35)';
    g.lineWidth = 1;
    g.stroke();
    w.slice(0, -1).forEach((p, i) => {
      const [x, y] = toScreen(p.lat, p.lon);
      g.beginPath();
      g.arc(x, y, 2.3, 0, 7);
      g.fillStyle = `rgba(79,176,239,${(0.2 + (0.7 * i) / n).toFixed(2)})`;
      g.fill();
    });
  }
  const f = L.read || L.last;
  if (f && liveDraws()) {
    const st = STATE.stations[0],
      [fx, fy] = toScreen(f.lat, f.lon),
      [yx, yy] = st ? toScreen(st.lat, st.lon) : [fx, fy],
      r = f.acc / merc.mpp(f.lat, z);
    /* the fix and its own accuracy */
    g.beginPath();
    g.arc(fx, fy, r, 0, 7);
    g.fillStyle = 'rgba(79,176,239,.12)';
    g.fill();
    g.strokeStyle = 'rgba(79,176,239,.9)';
    g.lineWidth = 1.2;
    g.stroke();
    if (Math.hypot(yx - fx, yy - fy) > 2) {
      g.setLineDash([2, 2.4]);
      g.strokeStyle = 'rgba(232,238,244,.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(yx, yy);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(fx, fy, 2.2, 0, 7);
      g.fillStyle = 'rgba(11,14,18,.4)';
      g.fill();
      g.strokeStyle = 'rgba(232,238,244,.85)';
      g.stroke();
    }
    /* the walker */
    g.beginPath();
    g.arc(yx, yy, 13, 0, 7);
    g.strokeStyle = 'rgba(79,176,239,.45)';
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    g.arc(yx, yy, 6.5, 0, 7);
    g.fillStyle = '#4fb0ef';
    g.fill();
    g.strokeStyle = '#f2f7fb';
    g.lineWidth = 2.4;
    g.stroke();
  }
  g.restore();
}
