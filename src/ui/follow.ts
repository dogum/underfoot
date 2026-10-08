/**
 * Following, in the readout: the summary in the transect header, the band over
 * the transect, the two chips on a followed station, and the On / Off switch.
 */
import { STATE } from '../app/state';
import { COL } from '../core/classes';
import { $, el } from '../core/dom';
import { fmt } from '../core/math';
import type { FollowStretch } from '../engine/follow';
import type { Station } from '../core/types';

const len = (s: FollowStretch) => s.d1 - s.d0;
const dist = (m: number) => (m >= 1000 ? fmt(m / 1000, 2) + ' km' : Math.round(m) + ' m');
export const stretchName = (s: FollowStretch) => s.name || 'a mapped ' + s.what;
const longest = (S: FollowStretch[]) => S.reduce((a, s) => (len(s) > len(a) ? s : a));

/** "follows Mist Trail 1.39 of 1.53 km", or '' when nothing is followed */
export function followSummary(total: number): string {
  const S = STATE.stretches;
  if (!S.length) return '';
  const sum = S.reduce((a, s) => a + len(s), 0),
    others = new Set(S.map(stretchName)).size - 1,
    what = stretchName(longest(S)) + (others ? ` and ${others} more` : '');
  if (sum >= total - 1) return `follows ${what}, all ${dist(total)}`;
  const km = total >= 1000;
  return `follows ${what} ${km ? fmt(sum / 1000, 2) : Math.round(sum)} of ${dist(total)}`;
}

/** one bar per followed stretch in the strip above the chart (y0 is the chart's top); the longest is named */
export function drawFollowBand(g: CanvasRenderingContext2D, xOf: (d: number) => number, y0: number) {
  const S = STATE.stretches;
  if (!S.length) return;
  for (const s of S) {
    const a = xOf(s.d0),
      b = xOf(s.d1);
    g.fillStyle = COL[s.cls];
    g.fillRect(a, y0 - 14, Math.max(1, b - a), 5);
    g.fillRect(a - 0.6, y0 - 16, 1.2, 14);
    g.fillRect(b - 0.6, y0 - 16, 1.2, 14);
  }
  const top = longest(S),
    t = `follows ${stretchName(top)} · ${dist(len(top))}`;
  g.font = '600 8.5px ui-monospace,monospace';
  const w = g.measureText(t).width,
    x = xOf(top.d0) + 6;
  if (w + 12 > xOf(top.d1) - xOf(top.d0)) return;
  g.fillStyle = 'rgba(11,14,18,.82)';
  g.fillRect(x, y0 + 14, w + 10, 13);
  g.fillStyle = '#e8eef4';
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  g.fillText(t, x + 5, y0 + 24.5);
}

/** the station panel's chips for a station on a followed stretch */
export function followChips(p: Station): HTMLElement[] {
  const s = p.f && STATE.stretches[p.f.k];
  if (!p.f || !s) return [];
  const chip = (k: string, v: string, title: string) => {
    const c = el('div', 'chip fol');
    c.title = title;
    c.append(el('span', 'lbl', k), el('b', null, v));
    return c;
  };
  return [
    chip(
      'Following',
      `${s.name || s.what} · ${dist(len(s))}`,
      'The line runs along this mapped line here, so the station is taken to be on it',
    ),
    chip(
      'Moved',
      `${fmt(p.f.off, 1)} m onto it`,
      'How far the station moved from the line onto the mapped line it follows',
    ),
  ];
}

export function syncFollowButtons() {
  $('#folOn').setAttribute('aria-pressed', String(STATE.follow));
  $('#folOff').setAttribute('aria-pressed', String(!STATE.follow));
}
