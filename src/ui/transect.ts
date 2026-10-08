// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The transect under the map: stacked posterior along the line, the call strip,
 * crossing labels, the elevation profile, and the scrubber linked to the map.
 */
import { selectStation } from '../app/actions';
import { STATE } from '../app/state';
import { along, cumLen } from '../app/stations';
import { CIX, CLASSES, COL, K, NAME, RIBBON_ORDER } from '../core/classes';
import { $, el } from '../core/dom';
import { clamp, fmt } from '../core/math';
import { MAP, mapDraw } from '../map/map';
import { drawDoubtBand } from './doubt';
import { drawCallStrip, drawCompact, isCompact, syncChart } from './compact';
import { drawFollowBand, followSummary } from './follow';
import { spanBounds } from '../engine/report';

/* ---------------------------------------------------------------- transect */
export const TR = { cv: null, g: null, W: 0, H: 0, hover: null, PAD: { l: 46, r: 12, t: 10, b: 20 } };
export function transectInit() {
  TR.cv = $('#tcanvas');
  TR.g = TR.cv.getContext('2d');
  new ResizeObserver(() => drawTransect()).observe($('#transect'));
  TR.cv.addEventListener('pointermove', e => {
    const r = TR.cv.getBoundingClientRect();
    TR.hover = e.clientX - r.left;
    brushAt(TR.hover);
    drawTransect();
  });
  TR.cv.addEventListener('pointerleave', () => {
    TR.hover = null;
    MAP.brush = null;
    $('#tcursor').textContent = '';
    drawTransect();
    mapDraw();
  });
  TR.cv.addEventListener('pointerdown', e => {
    const r = TR.cv.getBoundingClientRect(),
      i = stationNear(dAt(e.clientX - r.left));
    if (i != null) selectStation(i);
  });
}
export const total = () => (STATE.stations.length ? STATE.stations.at(-1).d : 0);
export const xOf = d => TR.PAD.l + (total() > 0 ? d / total() : 0) * (TR.W - TR.PAD.l - TR.PAD.r);
export const dAt = px => clamp((px - TR.PAD.l) / (TR.W - TR.PAD.l - TR.PAD.r), 0, 1) * total();
export function stationNear(d) {
  let b = null,
    bd = Infinity;
  STATE.stations.forEach((s, i) => {
    const k = Math.abs(s.d - d);
    if (k < bd) {
      bd = k;
      b = i;
    }
  });
  return b;
}
export function brushAt(px) {
  const d = dAt(px),
    v = STATE.verts,
    cum = cumLen(v);
  MAP.brush = v.length > 1 ? along(v, cum, d) : null;
  mapDraw();
  const i = stationNear(d),
    r = STATE.results[i];
  $('#tcursor').textContent =
    `${fmt(d, 0)} m · #${i + 1} ${r && r.view ? NAME[r.view.top] + ' ' + Math.round(r.view.topP * 100) + '%' : ''}`;
}
export function drawTransect() {
  if (!TR.cv || !$('#transect').classList.contains('on')) return;
  /* on a phone the transect folds to one row unless the full chart was asked for (ui/compact) */
  syncChart();
  const compact = isCompact();
  TR.PAD.l = compact ? 36 : 46;
  const dpr = Math.min(2, devicePixelRatio || 1);
  TR.W = TR.cv.clientWidth;
  TR.H = TR.cv.clientHeight || 190;
  TR.cv.width = Math.round(TR.W * dpr);
  TR.cv.height = Math.round(TR.H * dpr);
  const g = TR.g,
    P = TR.PAD;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, TR.W, TR.H);
  const st = STATE.stations,
    res = STATE.results,
    n = st.length;
  if (n < 2) return;
  if (compact) {
    drawCompact(g, xOf, spanBounds(st), TR.hover);
    $('#tinfo').textContent = `${fmt(total(), 0)} m · ${n} stations`;
    $('#tfollow').textContent = followSummary(total());
    return;
  }
  /* a followed stretch gets a band of its own above the chart */
  const top = P.t + (STATE.stretches.length ? 18 : 0);
  /* under the call strip, a thin band for doubt (ui/doubt) */
  const stripH = 16,
    gap = 6,
    bandH = 5,
    H1 = Math.round((TR.H - top - P.b - stripH - gap * 2 - bandH - 3) * 0.56);
  const y0 = top,
    y1 = y0 + H1,
    sy0 = y1 + gap,
    sy1 = sy0 + stripH,
    by0 = sy1 + 3,
    ey0 = by0 + bandH + gap,
    ey1 = TR.H - P.b;
  const cols = res.map(r => (r && r.view ? r.view.p : null));
  /* stacked posterior */
  const acc = new Array(n).fill(0);
  for (const key of RIBBON_ORDER) {
    const ci = CIX[key];
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const v = cols[i] ? cols[i][ci] : 0,
        x = xOf(st[i].d),
        yt = y1 - (acc[i] + v) * H1;
      i ? g.lineTo(x, yt) : g.moveTo(x, yt);
    }
    for (let i = n - 1; i >= 0; i--) g.lineTo(xOf(st[i].d), y1 - acc[i] * H1);
    g.closePath();
    g.fillStyle = COL[key];
    g.fill();
    g.strokeStyle = '#0e1216';
    g.lineWidth = 0.7;
    g.stroke();
    for (let i = 0; i < n; i++) acc[i] += cols[i] ? cols[i][ci] : 0;
  }
  g.strokeStyle = '#2a3742';
  g.lineWidth = 1;
  g.strokeRect(P.l, y0, TR.W - P.l - P.r, H1);
  const lab = (t, y) => {
    g.save();
    g.translate(12, y);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillStyle = '#43525e';
    g.font = '600 8.5px ui-monospace,monospace';
    g.fillText(t, 0, 0);
    g.restore();
  };
  lab(STATE.smooth ? 'SMOOTHED' : 'POSTERIOR', (y0 + y1) / 2);
  lab('CALL', (sy0 + sy1) / 2);
  g.font = '600 8.5px ui-monospace,monospace';
  g.fillStyle = '#6b7d8d';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillText('100%', P.l - 6, y0 + 4);
  g.fillText('0', P.l - 6, y1 - 4);
  /* hard call, direct-labelled; each station covers its own stretch of the
     line, a crossing its mapped width (engine/report spanBounds) */
  const B = spanBounds(st);
  drawCallStrip(g, xOf, B, sy0, stripH);
  drawDoubtBand(g, xOf, B, by0, bandH);
  /* elevation: the dense 3DEP profile when there is one */
  const prof =
    STATE.profile && STATE.profile.some(p => p.z != null)
      ? STATE.profile.filter(p => p.z != null)
      : st
          .map((s, i) => ({ d: s.d, z: res[i] && res[i].sh.terr ? res[i].sh.terr.z : null }))
          .filter(p => p.z != null);
  if (prof.length > 1) {
    const zs = prof.map(p => p.z),
      lo = Math.min(...zs),
      hi = Math.max(...zs),
      span = Math.max(1, hi - lo);
    const Y = z => ey1 - ((z - lo) / span) * (ey1 - ey0);
    g.beginPath();
    prof.forEach((p, i) => {
      const x = xOf(p.d);
      i ? g.lineTo(x, Y(p.z)) : g.moveTo(x, Y(p.z));
    });
    g.lineTo(xOf(prof.at(-1).d), ey1);
    g.lineTo(xOf(prof[0].d), ey1);
    g.closePath();
    g.fillStyle = 'rgba(79,176,239,.10)';
    g.fill();
    g.beginPath();
    prof.forEach((p, i) => {
      const x = xOf(p.d);
      i ? g.lineTo(x, Y(p.z)) : g.moveTo(x, Y(p.z));
    });
    g.strokeStyle = '#4fb0ef';
    g.lineWidth = 1.8;
    g.stroke();
    g.fillStyle = '#6b7d8d';
    g.textAlign = 'right';
    g.fillText(fmt(hi, 0) + ' m', P.l - 6, ey0 + 4);
    g.fillText(fmt(lo, 0) + ' m', P.l - 6, ey1 - 4);
    lab('ELEV', (ey0 + ey1) / 2);
    $('#tinfo').textContent =
      `${fmt(total(), 0)} m · ${n} stations · relief ${fmt(hi - lo, 1)} m${STATE.profile && STATE.profile[0] && STATE.profile[0].src ? ' · ' + STATE.profile[0].src : ''}`;
    $('#tfollow').textContent = followSummary(total());
  } else {
    g.fillStyle = '#43525e';
    g.textAlign = 'center';
    g.fillText('elevation pending', TR.W / 2, (ey0 + ey1) / 2);
    $('#tinfo').textContent = `${fmt(total(), 0)} m · ${n} stations`;
    $('#tfollow').textContent = followSummary(total());
  }
  /* axis */
  g.strokeStyle = '#1e2832';
  g.beginPath();
  g.moveTo(P.l, ey1 + 0.5);
  g.lineTo(TR.W - P.r, ey1 + 0.5);
  g.stroke();
  g.fillStyle = '#6b7d8d';
  g.textBaseline = 'top';
  g.textAlign = 'center';
  g.font = '500 9px ui-monospace,monospace';
  const T = total(),
    step = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000].find(s => T / s <= 8) || T / 6;
  for (let d = 0; d <= T + 1e-6; d += step) {
    const x = xOf(d);
    g.fillText(d >= 1000 ? fmt(d / 1000, 1) + 'k' : String(Math.round(d)), x, ey1 + 5);
  }
  for (let i = 0; i < n; i++) {
    g.fillStyle = i === STATE.sel ? '#f0a92e' : st[i].x ? '#e8eef4' : '#43525e';
    g.fillRect(xOf(st[i].d) - 1, y0 - 5, 2, st[i].x ? 6 : 4);
  }
  /* crossings: what the line actually passes over, named where the map names it */
  g.font = '600 8.5px ui-monospace,monospace';
  g.textBaseline = 'bottom';
  let lastR = -1e9;
  const xL = xOf(0),
    xR = xOf(st[n - 1].d);
  for (let i = 0; i < n; i++) {
    const x = st[i].x;
    if (!x) continue;
    const r = res[i],
      px = xOf(st[i].d);
    g.strokeStyle = 'rgba(232,238,244,.55)';
    g.setLineDash([2, 2]);
    g.beginPath();
    g.moveTo(px, y0);
    g.lineTo(px, sy1);
    g.stroke();
    g.setLineDash([]);
    const lab = (r && r.q && r.q.best[x.cls] && r.q.best[x.cls].name) || x.what,
      t = lab.length > 16 ? lab.slice(0, 15) + '…' : lab;
    /* labels never overlap: measured width, kept inside the chart, skipped if crowded */
    const w = g.measureText(t).width,
      cx = clamp(px, xL + w / 2 + 2, Math.max(xL + w / 2 + 2, xR - w / 2 - 2));
    if (cx - w / 2 > lastR + 6) {
      g.fillStyle = 'rgba(11,14,18,.72)';
      g.fillRect(cx - w / 2 - 3, y0 + 1, w + 6, 12);
      g.fillStyle = '#e8eef4';
      g.textAlign = 'center';
      g.fillText(t, cx, y0 + 11.5);
      lastR = cx + w / 2;
    }
  }
  drawFollowBand(g, xOf, y0);
  const sx = TR.hover != null ? TR.hover : xOf(st[STATE.sel] ? st[STATE.sel].d : 0);
  g.strokeStyle = 'rgba(240,169,46,.9)';
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(sx, y0);
  g.lineTo(sx, ey1);
  g.stroke();
  g.setLineDash([]);
  /* legend: what actually appears */
  const lg = $('#tlegend');
  lg.textContent = '';
  const present = new Set();
  for (const r of res)
    if (r && r.view)
      r.view.order.slice(0, 3).forEach(ci => {
        if (r.view.p[ci] > 0.06) present.add(K[ci]);
      });
  for (const c of CLASSES)
    if (present.has(c.k)) {
      const d = el('div'),
        i = el('i');
      i.style.background = c.c;
      d.append(i, document.createTextNode(c.n));
      lg.append(d);
    }
}
