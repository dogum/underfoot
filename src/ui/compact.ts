/**
 * The transect's call strip, and the one-row strip at the top of the phone's
 * sheet (ui/sheet): station ticks, the call along the line, the doubt band and
 * the check list's numbers, with the selected station marked.
 */
import { STATE } from '../app/state';
import { COL, NAME } from '../core/classes';
import { clamp } from '../core/math';
import { drawDoubtBand } from './doubt';

/** the strip's height, in CSS px */
export const COMPACT_H = 46;

/** each station's call over its own stretch of the line, named where there's room */
export function drawCallStrip(
  g: CanvasRenderingContext2D,
  xOf: (d: number) => number,
  bounds: number[],
  y: number,
  h: number,
) {
  const res = STATE.results,
    n = STATE.stations.length,
    mid = (i: number) => xOf(bounds[clamp(i, 0, n)]);
  let run = 0;
  for (let i = 1; i <= n; i++) {
    const a = res[run]?.view?.top ?? null,
      b = i < n ? (res[i]?.view?.top ?? null) : null;
    if (i < n && a === b) continue;
    const xa = mid(run),
      xb = mid(i),
      w = xb - xa;
    if (a) {
      g.fillStyle = COL[a];
      g.fillRect(xa, y, Math.max(1.5, w - 1), h);
      const t = NAME[a].toUpperCase();
      g.font = '600 9px ui-monospace,monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (g.measureText(t).width < w - 8) {
        g.fillStyle = ['snow', 'grass', 'crop'].includes(a) ? '#0b0e12' : '#f2f7fb';
        g.fillText(t, (xa + xb) / 2, y + h / 2 + 0.5);
      }
    }
    run = i;
  }
}

/** the whole compact transect: station ticks, the call strip, the doubt band, the selection */
export function drawCompact(
  g: CanvasRenderingContext2D,
  xOf: (d: number) => number,
  bounds: number[],
  hover: number | null,
) {
  const st = STATE.stations,
    stripY = 6,
    stripH = 16,
    bandY = 28,
    bandH = 5;
  for (let i = 0; i < st.length; i++) {
    g.fillStyle = i === STATE.sel ? '#f0a92e' : st[i].x ? '#e8eef4' : '#43525e';
    g.fillRect(xOf(st[i].d) - 1, 0, 2, st[i].x ? 5 : 3);
  }
  drawCallStrip(g, xOf, bounds, stripY, stripH);
  g.font = '600 7.5px ui-monospace,monospace';
  g.fillStyle = '#6b7d8d';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillText('CALL', xOf(0) - 6, stripY + stripH / 2);
  drawDoubtBand(g, xOf, bounds, bandY, bandH);
  const sx = hover ?? xOf(st[STATE.sel]?.d ?? 0);
  g.strokeStyle = 'rgba(240,169,46,.9)';
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(sx, 2);
  g.lineTo(sx, COMPACT_H - 4);
  g.stroke();
  g.setLineDash([]);
}
