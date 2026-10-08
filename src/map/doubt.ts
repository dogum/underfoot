/**
 * Doubt, on the map: an amber halo around each station worth a second look,
 * stronger the more doubt (engine/doubt).
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
