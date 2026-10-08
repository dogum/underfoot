// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Drawing the map: tiles (parent drawn under loading children), the field map,
 * the vectors the engine measured against, and the overlay of stations and line.
 */
import { STATE } from '../app/state';
import { cumLen } from '../app/stations';
import { COL, K, NAME, RGB } from '../core/classes';
import { $, el } from '../core/dom';
import { haversine, merc } from '../core/geo';
import { clamp, fmt } from '../core/math';
import { TILE_SRC, _tiles, loadTile } from '../data/imagery';
import { FIELD_CELL, FIELD_HALF, FIELD_N } from '../engine/field';
import { lineRule } from '../engine/geometry';
import { drawCheckBadges, drawDoubtHalos } from './doubt';
import { drawMarkTicks } from './marks';
import { drawFollow } from './follow';
import { drawLive, liveDraws } from './live';
import { isLocked } from './lock';
import { MAP, mapDraw, toLatLon, toScreen, updateScale, world } from './map';

/* ---- tiles, with the parent drawn underneath while children load --------- */
export function draw() {
  const g = MAP.g,
    { W, H, dpr } = MAP;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0a0d10';
  g.fillRect(0, 0, W, H);
  const S = TILE_SRC[MAP.src],
    zi = clamp(Math.round(MAP.z), 2, S.max),
    scale = Math.pow(2, MAP.z - zi),
    ts = 256 * scale;
  const [cx, cy] = world(MAP.lat, MAP.lon, zi);
  const x0 = Math.floor((cx - W / 2 / scale) / 256),
    x1 = Math.floor((cx + W / 2 / scale) / 256);
  const y0 = Math.floor((cy - H / 2 / scale) / 256),
    y1 = Math.floor((cy + H / 2 / scale) / 256);
  g.imageSmoothingEnabled = true;
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const sx = (tx * 256 - cx) * scale + W / 2,
        sy = (ty * 256 - cy) * scale + H / 2,
        e = loadTile(MAP.src, zi, tx, ty);
      if (e.im) {
        g.drawImage(e.im, sx, sy, ts + 0.6, ts + 0.6);
        continue;
      }
      e.p.then(im => {
        if (im) mapDraw();
      });
      for (let up = 1; up <= 4; up++) {
        const pz = zi - up;
        if (pz < 1) break;
        const f = 1 << up,
          ptx = Math.floor(tx / f),
          pty = Math.floor(ty / f),
          pe = _tiles.get(`${MAP.src}/${pz}/${((ptx % (1 << pz)) + (1 << pz)) % (1 << pz)}/${pty}`);
        if (pe && pe.im) {
          const sub = 256 / f;
          g.drawImage(
            pe.im,
            (tx - ptx * f) * sub,
            (ty - pty * f) * sub,
            sub,
            sub,
            sx,
            sy,
            ts + 0.6,
            ts + 0.6,
          );
          break;
        }
      }
    }
  if (S.dim) {
    g.fillStyle = `rgba(10,13,16,${S.dim})`;
    g.fillRect(0, 0, W, H);
  }
  drawField();
  drawVectors();
  drawOverlay();
  updateScale();
  /* credits, with the data sources while they're in the answer; the field
     legend sits above them however many lines they take */
  const used = (id: string) => STATE.results.some(r => r?.parts?.[id]?.status === 'ok');
  const credit =
    S.at +
    ' · OSM data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors via <a href="https://openfreemap.org">OpenFreeMap</a>' +
    (used('pass') ? ' · contains modified Copernicus Sentinel data' : '') +
    (used('world') ? ' · land cover: Impact Observatory, Microsoft, Esri' : '');
  if (credit !== _credit) {
    _credit = credit;
    const a = $('#attrib');
    a.innerHTML = credit;
    $('#fieldLegend').style.bottom = `${a.offsetTop ? a.offsetHeight + 14 : 44}px`;
  }
}

let _credit = '';

/* ---- field map ---------------------------------------------------------- */
export function drawField() {
  const fld = STATE.field;
  $('#fieldLegend').hidden = !(MAP.field && fld && fld.ready);
  if (!MAP.field || !fld || !fld.ready) return;
  if (MAP.fieldDirty || !MAP.fieldCv) {
    MAP.fieldDirty = false;
    const F = fld.F,
      N = F.N,
      cv = MAP.fieldCv || (MAP.fieldCv = document.createElement('canvas'));
    cv.width = cv.height = N;
    const cg = cv.getContext('2d'),
      im = cg.createImageData(N, N),
      seen = new Map();
    for (let k = 0; k < N * N; k++) {
      let best = 0,
        bp = -1;
      for (let c = 0; c < K.length; c++) {
        const v = F.probs[k * K.length + c];
        if (v > bp) {
          bp = v;
          best = c;
        }
      }
      const rgb = RGB[K[best]];
      im.data.set(
        [rgb[0], rgb[1], rgb[2], Math.round(255 * (0.16 + 0.5 * clamp((bp - 0.3) / 0.6, 0, 1)))],
        k * 4,
      );
      seen.set(K[best], (seen.get(K[best]) || 0) + 1);
    }
    cg.putImageData(im, 0, 0);
    const box = $('#fieldItems');
    box.textContent = '';
    [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .forEach(([k, n]) => {
        const s = el('span'),
          i = el('i');
        i.style.background = COL[k];
        s.append(i, document.createTextNode(`${NAME[k]} ${Math.round((n / (N * N)) * 100)}%`));
        box.append(s);
      });
    $('#fieldNote').textContent =
      `${FIELD_HALF * 2} m square · ${FIELD_CELL} m cells · opacity = confidence` +
      (fld.imgDone ? '' : ' · imagery still filling in');
  }
  const G = fld.G,
    [la0, lo0] = G.P.inv(-FIELD_HALF, FIELD_HALF),
    [la1, lo1] = G.P.inv(FIELD_HALF, -FIELD_HALF);
  const [ax, ay] = toScreen(la0, lo0),
    [bx, by] = toScreen(la1, lo1);
  if (bx - ax < 20) return;
  const g = MAP.g;
  g.save();
  g.imageSmoothingEnabled = (bx - ax) / FIELD_N < 3;
  g.drawImage(MAP.fieldCv, ax, ay, bx - ax, by - ay);
  g.strokeStyle = 'rgba(232,238,244,.35)';
  g.setLineDash([4, 4]);
  g.lineWidth = 1;
  g.strokeRect(ax, ay, bx - ax, by - ay);
  g.restore();
}

/* ---- the geometry the engine measured against --------------------------- */
export const VEC_STYLE = {
  paved: ['#9aa6b4', 2],
  path: ['#e07a95', 1.4],
  rail: ['#c48ad6', 1.6],
  water: ['#5aa9ec', 1.4],
};
export function drawVectors() {
  if (!MAP.vectors || MAP.z < 14.5) return;
  const g = MAP.g,
    a = toLatLon(0, 0),
    b = toLatLon(MAP.W, MAP.H),
    vb = [a.lon, b.lat, b.lon, a.lat];
  const vis = bb => !(bb[2] < vb[0] || bb[0] > vb[2] || bb[3] < vb[1] || bb[1] > vb[3]);
  const path = r => {
    g.beginPath();
    for (let i = 0; i < r.length; i += 2) {
      const [x, y] = toScreen(r[i + 1], r[i]);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  };
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const f of STATE.osmFeats || []) {
    if (!vis(f.bb)) continue;
    if (f.t === 3 && f.L === 'building') {
      g.fillStyle = 'rgba(217,87,55,.16)';
      g.strokeStyle = 'rgba(217,87,55,.65)';
      g.lineWidth = 1;
      for (const r of f.r) {
        path(r);
        g.fill();
        g.stroke();
      }
      continue;
    }
    if (f.t === 2) {
      const lr = lineRule(f.L, f.p);
      if (!lr) continue;
      const [col, w] = VEC_STYLE[lr.cls];
      g.strokeStyle = col + 'd0';
      g.lineWidth = w;
      if (lr.cls === 'path') g.setLineDash([5, 3]);
      for (const r of f.r) {
        path(r);
        g.stroke();
      }
      g.setLineDash([]);
    }
  }
  g.strokeStyle = 'rgba(255,196,120,.9)';
  g.lineWidth = 1.2;
  g.setLineDash([3, 2]);
  for (const s of STATE.structs || [])
    for (const r of s.r) {
      path(r);
      g.stroke();
    }
  g.restore();
}

/* ---- stations, vertices, rings, GPS disc, brush ------------------------- */
export function drawOverlay() {
  const g = MAP.g,
    { W, H } = MAP,
    st = STATE.stations,
    v = STATE.verts;
  g.save();
  if (STATE.mode === 'path' && v.length > 1) {
    g.beginPath();
    v.forEach((p, i) => {
      const [x, y] = toScreen(p.lat, p.lon);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = 'rgba(240,169,46,.32)';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
    g.strokeStyle = '#f0a92e';
    g.lineWidth = 1.5;
    g.stroke();
    drawFollow(g, toScreen);
  }
  if (STATE.mode === 'path' && MAP.drawing && v.length && MAP.cursor) {
    const [x0, y0] = toScreen(v.at(-1).lat, v.at(-1).lon),
      [x1, y1] = toScreen(MAP.cursor.lat, MAP.cursor.lon);
    g.setLineDash([5, 5]);
    g.strokeStyle = 'rgba(240,169,46,.7)';
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
    g.font = '600 10px ui-monospace,monospace';
    g.fillStyle = '#f0a92e';
    g.textAlign = 'left';
    const L = cumLen(v).at(-1) + haversine(v.at(-1), MAP.cursor);
    g.fillText(L >= 1000 ? fmt(L / 1000, 2) + ' km' : Math.round(L) + ' m', x1 + 10, y1 - 8);
  }
  const sel = st[STATE.sel];
  if (sel) {
    const [x, y] = toScreen(sel.lat, sel.lon),
      mpp = merc.mpp(sel.lat, MAP.z);
    if (MAP.rings) {
      g.setLineDash([3, 4]);
      for (const [rad, lab] of [
        [10, '3DEP'],
        [60, 'FIELD'],
        [170, 'OSM'],
      ]) {
        const rr = rad / mpp;
        if (rr < 8 || rr > Math.max(W, H)) continue;
        g.beginPath();
        g.arc(x, y, rr, 0, 7);
        g.strokeStyle = 'rgba(240,169,46,.4)';
        g.lineWidth = 1;
        g.stroke();
        if (rr > 30) {
          g.setLineDash([]);
          g.font = '600 9px ui-monospace,monospace';
          g.fillStyle = 'rgba(240,169,46,.8)';
          g.fillText(`${lab} ${rad} m`, x + 4, y - rr - 4);
          g.setLineDash([3, 4]);
        }
      }
      g.setLineDash([]);
      const R = STATE.results[STATE.sel];
      if (R && R.img) {
        const s = ((R.img.W / 2) * R.img.mpp) / mpp;
        if (s > 5) {
          g.strokeStyle = 'rgba(79,176,239,.85)';
          g.strokeRect(x - s / 2, y - s / 2, s, s);
        }
      }
    }
    if (STATE.gps > 0 && !liveDraws()) {
      for (const k of [1, 2]) {
        const rr = (STATE.gps * k) / mpp;
        g.beginPath();
        g.arc(x, y, rr, 0, 7);
        g.fillStyle = k === 1 ? 'rgba(79,176,239,.10)' : 'rgba(79,176,239,.05)';
        g.fill();
        g.strokeStyle = `rgba(79,176,239,${k === 1 ? 0.9 : 0.5})`;
        g.lineWidth = 1.2;
        g.stroke();
      }
    }
  }
  drawDoubtHalos(g, toScreen, W, H);
  st.forEach((p, i) => {
    if (liveDraws()) return; // Here draws the walker instead
    const [x, y] = toScreen(p.lat, p.lon);
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return;
    const isSel = i === STATE.sel,
      r = STATE.results[i],
      col = r && r.view ? COL[r.view.top] : '#f0a92e';
    const many = st.length > 14,
      rad = isSel ? 7.5 : many ? 3.6 : 5;
    g.beginPath();
    g.arc(x, y, p.x && !isSel ? rad + 1.2 : rad, 0, 7);
    g.fillStyle = col;
    g.fill();
    g.lineWidth = isSel ? 2 : p.x ? 2 : 1.2;
    g.strokeStyle = p.x && !isSel ? '#f2f7fb' : 'rgba(11,14,18,.9)';
    g.stroke();
    if (isSel) {
      g.beginPath();
      g.arc(x, y, 11.5, 0, 7);
      g.strokeStyle = '#f0a92e';
      g.lineWidth = 1.2;
      g.stroke();
      g.beginPath();
      for (const [a, b, c, d] of [
        [-17, 0, -12, 0],
        [12, 0, 17, 0],
        [0, -17, 0, -12],
        [0, 12, 0, 17],
      ]) {
        g.moveTo(x + a, y + b);
        g.lineTo(x + c, y + d);
      }
      g.stroke();
    }
    if (st.length > 1 && !many) {
      g.font = '600 9px ui-monospace,monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#0b0e12';
      g.fillText(String(i + 1), x, y + 0.5);
    }
  });
  drawCheckBadges(g, toScreen, W, H);
  drawMarkTicks(g, toScreen, W, H);
  if (STATE.mode === 'path')
    v.forEach((p, i) => {
      if (v.length > 60) return;
      const [x, y] = toScreen(p.lat, p.lon);
      g.save();
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      g.fillStyle = '#0b0e12';
      g.strokeStyle = isLocked() ? '#6b7d8d' : '#f0a92e';
      g.lineWidth = 1.4;
      g.fillRect(-4, -4, 8, 8);
      g.strokeRect(-4, -4, 8, 8);
      g.restore();
    });
  if (MAP.peek) {
    const [x, y] = toScreen(MAP.peek.lat, MAP.peek.lon);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.setLineDash([2, 2]);
    g.beginPath();
    g.arc(x, y, 10, 0, 7);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    for (const [a, b, c, d] of [
      [-15, 0, -6, 0],
      [6, 0, 15, 0],
      [0, -15, 0, -6],
      [0, 6, 0, 15],
    ]) {
      g.moveTo(x + a, y + b);
      g.lineTo(x + c, y + d);
    }
    g.stroke();
  }
  drawLive(g, toScreen, MAP.z);
  if (MAP.brush) {
    const [x, y] = toScreen(MAP.brush.lat, MAP.brush.lon);
    g.beginPath();
    g.arc(x, y, 9, 0, 7);
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    g.arc(x, y, 3, 0, 7);
    g.fillStyle = '#fff';
    g.fill();
  }
  g.restore();
}
