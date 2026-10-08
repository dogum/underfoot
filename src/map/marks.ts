/**
 * Marks, on the map: a small ✓, ✗ or ? beside each marked station (io/marks),
 * on the side away from the check list's number.
 */
import { STATE } from '../app/state';
import { markAt } from '../ui/marks';

type ToScreen = (lat: number, lon: number) => [number, number];
const LOOK = { right: ['✓', '#3ba55c'], wrong: ['✗', '#e5484d'], unsure: ['?', '#6b7d8d'] } as const;

export function drawMarkTicks(g: CanvasRenderingContext2D, toScreen: ToScreen, W: number, H: number) {
  g.save();
  g.font = '700 10px ui-monospace,monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const s of STATE.stations) {
    const m = markAt(s);
    if (!m) continue;
    const [x0, y0] = toScreen(s.lat, s.lon),
      x = x0 - 13,
      y = y0 - 13;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const [t, c] = LOOK[m.verdict];
    g.beginPath();
    g.arc(x, y, 8, 0, 7);
    g.fillStyle = c;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#0b0e12';
    g.stroke();
    g.fillStyle = '#fff';
    g.fillText(t, x, y + 0.5);
  }
  g.restore();
}
