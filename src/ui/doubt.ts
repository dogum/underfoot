/**
 * Doubt, in the readout: the "worth a look" line under the verdict and the
 * band under the transect's call strip, with the check list's numbers on it
 * (engine/doubt).
 */
import { STATE } from '../app/state';
import { el } from '../core/dom';
import { DOUBT_AT, doubtWords } from '../engine/doubt';
import type { StationResult } from '../core/types';

/** the verdict's "worth a look" line, or null when the answer is clear enough */
export function doubtLine(r: StationResult): HTMLElement | null {
  const d = r.doubt;
  if (!d || !r.view || d.score < DOUBT_AT) return null;
  const box = el('div', 'look');
  box.title = `Doubt ${d.score.toFixed(2)}: ${d.close >= d.spread ? 'a close call' : 'the sources disagree'}`;
  box.append(el('span', 'lbl', 'Worth a look'), document.createTextNode(doubtWords(d, r.view)));
  return box;
}

/** amber where the answer is shaky, in a strip from y to y + h; each station covers its own stretch */
export function drawDoubtBand(
  g: CanvasRenderingContext2D,
  xOf: (d: number) => number,
  bounds: number[],
  y: number,
  h: number,
) {
  const st = STATE.stations,
    res = STATE.results;
  g.fillStyle = '#141a21';
  g.fillRect(xOf(0), y, xOf(bounds[bounds.length - 1]) - xOf(0), h);
  st.forEach((_, i) => {
    const d = res[i]?.doubt;
    if (!d || d.score < 0.2) return;
    const a = xOf(bounds[i]),
      b = xOf(bounds[i + 1]);
    g.fillStyle = `rgba(240,169,46,${Math.min(1, d.score).toFixed(3)})`;
    g.fillRect(a, y, Math.max(1, b - a), h);
  });
  g.font = '600 7.5px ui-monospace,monospace';
  g.fillStyle = '#6b7d8d';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillText('DOUBT', xOf(0) - 6, y + h / 2);
  /* the check list's numbers, as on the map */
  g.font = '700 7.5px ui-monospace,monospace';
  g.textAlign = 'center';
  STATE.checks.forEach((i, k) => {
    const s = st[i];
    if (!s) return;
    const x = xOf(s.d);
    g.beginPath();
    g.arc(x, y + h / 2, 5.5, 0, 7);
    g.fillStyle = '#f0a92e';
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = '#0b0e12';
    g.stroke();
    g.fillStyle = '#0b0e12';
    g.fillText(String(k + 1), x, y + h / 2 + 0.5);
  });
}
