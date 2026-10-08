/**
 * Doubt, on the map: an amber halo around each station worth a second look,
 * stronger the more doubt, and the check list's numbers beside its spots
 * (engine/doubt).
 */
import { STATE } from '../app/state';
import { DOUBT_AT } from '../engine/doubt';

type ToScreen = (lat: number, lon: number) => [number, number];

export function drawDoubtHalos(g: CanvasRenderingContext2D, toScreen: ToScreen, W: number, H: number) {
  g.save();
  STATE.stations.forEach((s, i) => {
    const d = STATE.results[i]?.doubt;
    if (!d || d.score < DOUBT_AT) return;
    const [x, y] = toScreen(s.lat, s.lon);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
    const a = 0.3 + (0.6 * (d.score - DOUBT_AT)) / (1 - DOUBT_AT);
    g.beginPath();
    g.arc(x, y, 11, 0, 7);
    g.fillStyle = `rgba(240,169,46,${(a * 0.22).toFixed(3)})`;
    g.fill();
    g.strokeStyle = `rgba(240,169,46,${a.toFixed(3)})`;
    g.lineWidth = 1.6;
    g.stroke();
  });
  g.restore();
}

/** the walk check list's numbers, beside its stations, drawn over the markers */
export function drawCheckBadges(g: CanvasRenderingContext2D, toScreen: ToScreen, W: number, H: number) {
  g.save();
  g.font = '700 10.5px ui-monospace,monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  STATE.checks.forEach((i, k) => {
    const s = STATE.stations[i];
    if (!s) return;
    const [x0, y0] = toScreen(s.lat, s.lon),
      x = x0 + 13,
      y = y0 - 13;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
    g.beginPath();
    g.arc(x, y, 8.5, 0, 7);
    g.fillStyle = '#f0a92e';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#0b0e12';
    g.stroke();
    g.fillStyle = '#0b0e12';
    g.fillText(String(k + 1), x, y + 0.5);
  });
  g.restore();
}
