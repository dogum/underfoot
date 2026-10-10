/**
 * The imagery panel: the patch the classifier read, its colour and texture,
 * what the pixels alone say, and the photo's date and source.
 */
import { COL, NAME } from '../core/classes';
import { $, el, esc } from '../core/dom';
import { clamp, fmt, softmax } from '../core/math';
import type { ClassKey, StationResult } from '../core/types';
import { IMG_MODEL, imgLogLik } from '../engine/imagery-model';
import { passHtml } from './today';

export function renderPixels(r: StationResult) {
  const im = r.img,
    box = $('#pxstats'),
    meta = $('#imgMeta');
  box.textContent = '';
  meta.textContent = '';
  const cv = $('#swatch') as HTMLCanvasElement,
    g = cv.getContext('2d')!;
  if (!im) {
    cv.width = cv.height = 48;
    g.fillStyle = '#1b232c';
    g.fillRect(0, 0, 48, 48);
    $('#imgHint').textContent = r.sh.imgErr ? 'unavailable' : 'loading…';
    $('#swScale').textContent = '';
    return;
  }
  cv.width = cv.height = im.W;
  g.putImageData(im.data, 0, 0);
  $('#imgHint').textContent = `z${im.z} · ${fmt(im.W * im.mpp, 0)} m box`;
  $('#swScale').textContent = fmt(im.W * im.mpp, 0) + ' m';
  if (!r.feat) return;
  const c = r.feat.core;
  for (const [k, v, lo, hi, col] of [
    ['brightness', c.L, 0, 1, 'var(--cool)'],
    ['greenness', c.G, -0.2, 0.8, COL.forest],
    ['blueness', c.B, -0.35, 0.35, COL.water],
    ['texture', c.sd, 0, 0.2, 'var(--cool)'],
    ['edges', c.edge, 0, 0.15, 'var(--cool)'],
    ['shadow', c.D, 0, 1, 'var(--ink-3)'],
  ] as [string, number, number, number, string][]) {
    const row = el('div', 'pxrow'),
      m = el('div', 'm'),
      i = el('i');
    i.style.width = clamp((v - lo) / (hi - lo), 0, 1) * 100 + '%';
    i.style.background = col;
    m.append(i);
    row.append(el('span', 'k', k), m, el('span', 'v mono', fmt(v, 2)));
    box.append(row);
  }
  const lp = imgLogLik(r.feat.v),
    ps = softmax(IMG_MODEL.classes.map(k => lp[k])),
    ord = [...ps.keys()].sort((a, b) => ps[b] - ps[a]);
  const m = r.sh.imeta;
  meta.innerHTML =
    `Pixels alone read <b>${ord
      .slice(0, 3)
      .map(i => `${NAME[IMG_MODEL.classes[i] as ClassKey]} ${Math.round(ps[i] * 100)}%`)
      .join(' · ')}</b><br>` +
    (m && m.date
      ? `Photo <b>${m.date}</b>${m.res ? ` · ${m.res} m/px source` : ''}${m.acc ? ` · stated accuracy ±${m.acc} m` : ''}${m.src ? ` · ${esc(m.src)}` : ''}`
      : 'Photo date unknown') +
    (r.sh.imgWmul < 1
      ? '<br><span style="color:var(--accent)">Coarse source imagery — this vote is down-weighted.</span>'
      : '') +
    passHtml(r.sh);
}
