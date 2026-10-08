/**
 * The transect's call strip, and its compact form on a phone: one 46 px row
 * (stations, the call strip, the doubt band and the check list's numbers) so
 * the answer under it has room. "Chart" opens the full transect; the choice is
 * remembered on the device, like the route card's.
 */
import { STATE } from '../app/state';
import { COL, NAME } from '../core/classes';
import { $ } from '../core/dom';
import { clamp } from '../core/math';
import { drawDoubtBand } from './doubt';

const PHONE = '(max-width: 820px)';
/** the compact row's height, in CSS px */
export const COMPACT_H = 46;

function chartOpen(): boolean {
  try {
    return localStorage.getItem('uf.chart') === '1';
  } catch {
    return false;
  }
}
/** on a phone, unless the full chart was asked for */
export const isCompact = () => matchMedia(PHONE).matches && !chartOpen();

/** the header's Chart toggle: label, state, and the class the CSS keys on */
export function syncChart() {
  const compact = isCompact(),
    b = $('#tchart');
  $('#transect').classList.toggle('compact', compact);
  if (!b) return;
  b.textContent = compact ? 'Chart ▾' : 'Chart ▴';
  b.setAttribute('aria-expanded', String(!compact));
  b.title = compact ? 'Open the full transect' : 'Fold the transect to one row';
}
export function toggleChart() {
  try {
    localStorage.setItem('uf.chart', chartOpen() ? '0' : '1');
  } catch {}
  syncChart();
}

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
