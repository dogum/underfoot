// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The console: verdict, readout, GPS tabs, posterior bars, imagery panel and ledger.
 * render() is the single redraw for the whole page.
 */
import { hint, selectStation } from '../app/actions';
import { scheduleField } from '../app/field';
import { recompute } from '../app/sound';
import { STATE } from '../app/state';
import { CLASSES, COL, K, NAME, PRIOR, SOURCES } from '../core/classes';
import { $, $$, TOUCH, el, esc } from '../core/dom';
import { clamp, fmt, softmax } from '../core/math';
import { IMG_MODEL, imgLogLik } from '../engine/imagery-model';
import { narrate } from '../engine/narrate';
import { overhead } from '../engine/overhead';
import { renderGoing } from './going';
import { syncLock } from '../map/lock';
import { mapDraw } from '../map/map';
import { followChips, syncFollowButtons } from './follow';
import { renderLedger } from './ledger';
import { markBox } from './marks';
import { passHtml, todayChips, todayLine } from './today';
import { doubtLine } from './doubt';
import { liveChips, liveSubtitle, renderLive } from './live';
import { renderReport } from './report';
import { shareNow } from './share';
import { drawTransect } from './transect';

export const UI = { open: new Set(['image']), showAll: false };
export function render() {
  const has = STATE.stations.length > 0;
  $('#emptyState').hidden = has;
  $('#panels').hidden = !has;
  $('#transect').classList.toggle('on', STATE.mode === 'path' && STATE.stations.length > 1);
  syncFollowButtons();
  renderLive();
  renderReport();
  renderStations();
  const r = STATE.results[STATE.sel];
  $('#panels').classList.toggle('stale', has && !(r && r.view));
  if (has && r && r.view) {
    renderVerdict(r);
    renderReadout(r);
    renderGoing();
    renderGps();
    renderPosterior(r);
    renderPixels(r);
    renderLedger(r);
  } else if (has) renderPending();
  if (STATE.mode === 'path' && STATE.stations.length > 1) drawTransect();
  syncLock();
  mapDraw();
  hint();
}
/* between a new probe and its first evidence: say so, rather than leaving the
   previous answer on screen looking current */
export function renderPending() {
  const st = STATE.stations[STATE.sel];
  if (!st) return;
  const v = $('#verdict');
  v.textContent = '';
  const top = el('div', 'vtop'),
    sw = el('div', 'vswatch pending'),
    mid = el('div');
  mid.append(
    el('div', 'vname', 'Sounding…'),
    el(
      'div',
      'vsub',
      `${fmt(Math.abs(st.lat), 6)}°${st.lat >= 0 ? 'N' : 'S'} ${fmt(Math.abs(st.lon), 6)}°${st.lon >= 0 ? 'E' : 'W'} · asking ${SOURCES.length} sources`,
    ),
  );
  top.append(sw, mid);
  v.append(top);
}
export function pendingOf(r) {
  return r && r.fused ? r.fused.ledger.filter(l => l.status === 'wait').length : SOURCES.length;
}

export function renderStations() {
  const w = $('#stations');
  w.textContent = '';
  if (STATE.stations.length < 2) return;
  STATE.stations.forEach((p, i) => {
    const r = STATE.results[i],
      b = el('button', 'stn');
    b.setAttribute('aria-current', String(i === STATE.sel));
    b.title = `Station ${i + 1} · ${fmt(p.d, 0)} m — ${r && r.view ? NAME[r.view.top] + ' ' + Math.round(r.view.topP * 100) + '%' : 'pending'}`;
    const bar = el('i');
    if (r && r.view) bar.style.background = COL[r.view.top];
    b.append(bar, el('span', null, p.x ? '×' : String(i + 1)));
    if (p.x) b.title += ` · crossing ${p.x.what}`;
    b.onclick = () => selectStation(i);
    w.append(b);
  });
  const cur = w.children[STATE.sel];
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
export function renderVerdict(r) {
  const f = r.view,
    v = $('#verdict');
  v.textContent = '';
  const cls = CLASSES.find(c => c.k === f.top),
    top = el('div', 'vtop'),
    sw = el('div', 'vswatch');
  sw.style.background = COL[f.top];
  const mid = el('div');
  mid.style.minWidth = '0';
  const sub = el('div', 'vsub', cls.d);
  sub.title = cls.d;
  mid.append(el('div', 'vname', cls.n), sub);
  const pct = el('div', 'vpct');
  pct.innerHTML = `<b>${Math.round(f.topP * 100)}</b><i>%</i><small>${liveSubtitle(r.station) || (r.mode === 'gps' ? `within ±${STATE.gps} m` : r.mode === 'smoothed' ? 'smoothed along path' : r.mode === 'crossing' ? (r.station.x.over ? `on a bridge over the ${esc(r.station.x.over)}` : `line crosses a ${esc(r.station.x.what)}`) : 'at the coordinate')}</small>`;
  top.append(sw, mid, pct);
  v.append(top);
  /* what's above the surface the answer names (engine/overhead) */
  const ov = overhead(r.sh, r.q, f.top);
  if (ov) {
    const o = el('div', 'vover ' + ov.kind);
    o.title = ov.src;
    o.innerHTML = `<span>Overhead</span><b>${esc(ov.text)}</b><i>${esc(ov.src)}</i>`;
    v.append(o);
  }
  const n = el('div', 'narr');
  n.innerHTML = narrate(f, r.sh, r.q);
  v.append(n);
  const dl = doubtLine(r);
  if (dl) v.append(dl);
  const mk = markBox(r);
  if (mk) v.append(mk);
  /* on a phone, the share card is a tap from the answer */
  if (TOUCH) {
    const sb = el('button', 'vshare', 'Share card');
    sb.title = 'A picture of this call, with the link that reopens it';
    sb.onclick = () => shareNow();
    v.append(sb);
  }
  const bars = el('div', 'vbars');
  bars.append(confGauge(f.conf));
  const stat = el('div', 'vstat'),
    ok = r.fused.ledger.filter(l => l.status === 'ok' || l.status === 'quiet').length;
  for (const [k, val] of [
    ['Runner-up', `${NAME[K[f.order[1]]]} ${Math.round(f.p[f.order[1]] * 100)}%`],
    ['Margin', `${Math.round(f.margin * 100)} pts`],
    ['Entropy', `${fmt(f.bits, 2)} / ${fmt(Math.log2(K.length), 2)} bits`],
    ['Sources in', `${ok} of ${SOURCES.length} · τ ${fmt(r.fused.tau, 2)}`],
  ]) {
    const row = el('div', 'row');
    row.append(el('span', 'lbl', k), el('b', null, val));
    stat.append(row);
  }
  bars.append(stat);
  v.append(bars);
  const wait = pendingOf(r);
  if (wait) {
    const w = el('div', 'vflag'),
      d = el('span', 'led wait');
    d.style.marginTop = '0';
    w.append(
      d,
      document.createTextNode(
        `Provisional — ${wait} source${wait > 1 ? 's' : ''} still reporting. This will move.`,
      ),
    );
    v.append(w);
  } else if (f.conf < 0.3) {
    const w = el('div', 'vflag');
    w.textContent = '⚠ Low confidence — sources disagree or are thin here. Read it as a shortlist.';
    v.append(w);
  }
}
export function confGauge(c) {
  const S = 56,
    ns = 'http://www.w3.org/2000/svg',
    s = document.createElementNS(ns, 'svg');
  s.setAttribute('width', S);
  s.setAttribute('height', S);
  s.setAttribute('viewBox', `0 0 ${S} ${S}`);
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `Confidence ${Math.round(c * 100)} percent`);
  s.style.flex = '0 0 auto';
  const R = 23,
    C = 2 * Math.PI * R,
    m = S / 2;
  const circ = (col, dash) => {
    const e = document.createElementNS(ns, 'circle');
    e.setAttribute('cx', m);
    e.setAttribute('cy', m);
    e.setAttribute('r', R);
    e.setAttribute('fill', 'none');
    e.setAttribute('stroke', col);
    e.setAttribute('stroke-width', 4);
    e.setAttribute('stroke-linecap', 'round');
    if (dash != null) e.setAttribute('stroke-dasharray', `${dash} ${C}`);
    e.setAttribute('transform', `rotate(-90 ${m} ${m})`);
    return e;
  };
  const t = (y, size, fill, txt, w) => {
    const e = document.createElementNS(ns, 'text');
    e.setAttribute('x', m);
    e.setAttribute('y', y);
    e.setAttribute('text-anchor', 'middle');
    e.setAttribute('fill', fill);
    e.setAttribute('font-family', 'ui-monospace,monospace');
    e.setAttribute('font-size', size);
    if (w) e.setAttribute('font-weight', w);
    e.textContent = txt;
    return e;
  };
  s.append(
    circ('#1b232c'),
    circ('#f0a92e', C * c),
    t(m + 4, 13, '#e8eef4', Math.round(c * 100), '600'),
    t(m + 15, 6.5, '#6b7d8d', 'CONF'),
  );
  return s;
}
export function renderReadout(r) {
  const s = $('#readout'),
    p = r.station,
    sh = r.sh;
  s.textContent = '';
  const h = el('header');
  h.append(el('span', 'lbl', 'Station'), el('span', 'rule'));
  if (STATE.stations.length > 1)
    h.append(
      el(
        'span',
        'hint',
        `${STATE.sel + 1} of ${STATE.stations.length} · ${fmt(p.d, 0)} m along${p.x ? ' · crossing' : p.f ? ' · following' : ''}`,
      ),
    );
  s.append(h);
  s.append(
    el(
      'div',
      'coord mono',
      `${Math.abs(p.lat).toFixed(6)}°${p.lat >= 0 ? 'N' : 'S'}  ${Math.abs(p.lon).toFixed(6)}°${p.lon >= 0 ? 'E' : 'W'}`,
    ),
  );
  const nm = sh.nom && !sh.nom.error ? sh.nom.display_name : '';
  s.append(el('div', 'place', nm || (sh.gazAsked && sh.nom === undefined ? 'resolving place…' : '')));
  const chips = el('div', 'chips');
  chips.append(...liveChips(), ...followChips(p));
  const add = (k, v, t) => {
    const c = el('div', 'chip');
    if (t) c.title = t;
    c.append(el('span', 'lbl', k), el('b', null, v));
    chips.append(c);
  };
  const t = sh.terr;
  add('Elevation', t ? `${fmt(t.z, 1)} m` : t === null ? 'n/a' : '…', t ? t.src : '');
  add('Slope', t ? `${fmt(t.slope, 1)}°` : t === null ? 'n/a' : '…');
  if (sh.conus) {
    add(
      'Canopy',
      sh.nlcd ? (sh.nlcd.canopy != null ? sh.nlcd.canopy + '%' : '—') : sh.nlcd === null ? 'n/a' : '…',
      'NLCD tree canopy cover, 30 m',
    );
    add(
      'Impervious',
      sh.nlcd ? (sh.nlcd.imperv != null ? sh.nlcd.imperv + '%' : '—') : sh.nlcd === null ? 'n/a' : '…',
      'NLCD impervious surface, 30 m',
    );
  }
  add(
    'Photo',
    sh.imeta && sh.imeta.date ? sh.imeta.date : sh.imeta ? 'undated' : '…',
    'Acquisition date of the imagery under the point (Esri)',
  );
  add(
    'Map density',
    r.q ? String(r.q.density) : '…',
    "OSM features within 170 m — how much the map's silence is worth",
  );
  chips.append(...todayChips(sh));
  s.append(chips);
  const now = todayLine(sh);
  if (now) s.append(now);
}
export function renderGps() {
  /* while Here is on, each fix sets the spread from its own accuracy */
  const live = STATE.live.on && STATE.mode === 'point' && STATE.live.read;
  $$('#gpsTabs button[data-s]').forEach(b => {
    b.setAttribute('aria-pressed', String(!live && +b.dataset.s === STATE.gps));
    b.disabled = !!live;
  });
  const lt = $('#gpsLive');
  lt.hidden = !live;
  if (live) lt.textContent = `fix ±${Math.round(STATE.live.read.acc)} m`;
  const fld = STATE.field,
    ready = fld && fld.idx === STATE.sel && fld.ready;
  $('#gpsHelp').innerHTML =
    STATE.gps === 0
      ? 'The coordinate taken as exact. A phone fix is usually good to <b>±3–10 m</b>; pick that and the answer becomes what is likely under a fix with that spread.'
      : ready
        ? `Averaged over the field map under a ±${STATE.gps} m Gaussian (blue disc). Narrow features lose weight, broad ones gain it.`
        : `Waiting for the field map around this station before averaging over ±${STATE.gps} m…`;
}
export function renderPosterior(r) {
  const f = r.view,
    list = $('#plist');
  list.textContent = '';
  const max = Math.max(...f.p);
  const show = f.order.filter((ci, rank) => UI.showAll || rank < 4 || f.p[ci] >= 0.005);
  for (const ci of show) {
    const k = K[ci],
      p = f.p[ci],
      rank = f.order.indexOf(ci);
    const row = el('div', 'prow' + (rank === 0 ? ' lead' : ''));
    row.title = `${NAME[k]} — ${(p * 100).toFixed(1)}%  (prior ${(PRIOR[k] * 100).toFixed(1)}%)`;
    const body = el('div', 'pbody'),
      chip = el('span', 'chipc');
    chip.style.background = COL[k];
    const tr = el('div', 'track'),
      bar = el('div', 'bar');
    bar.style.width = `max(2px,${((p / max) * 100).toFixed(2)}%)`;
    if (rank === 0) bar.style.background = COL[k];
    const tick = el('div', 'pri');
    tick.style.left = Math.min(100, (PRIOR[k] / max) * 100) + '%';
    tr.append(bar, tick);
    body.append(
      chip,
      el('span', 'nm', NAME[k]),
      tr,
      el('span', 'pv mono', p >= 0.001 ? (p * 100).toFixed(1) : '<0.1'),
    );
    row.append(body);
    list.append(row);
  }
  const hidden = K.length - show.length;
  if (hidden > 0 || UI.showAll) {
    const b = el('button', 'more mono', UI.showAll ? 'show fewer' : `+${hidden} under 0.5%`);
    b.onclick = () => {
      UI.showAll = !UI.showAll;
      render();
    };
    list.append(b);
  }
}
export function renderPixels(r) {
  const im = r.img,
    box = $('#pxstats'),
    meta = $('#imgMeta');
  box.textContent = '';
  meta.textContent = '';
  const cv = $('#swatch'),
    g = cv.getContext('2d');
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
  const c = r.feat.core;
  for (const [k, v, lo, hi, col] of [
    ['brightness', c.L, 0, 1, 'var(--cool)'],
    ['greenness', c.G, -0.2, 0.8, COL.forest],
    ['blueness', c.B, -0.35, 0.35, COL.water],
    ['texture', c.sd, 0, 0.2, 'var(--cool)'],
    ['edges', c.edge, 0, 0.15, 'var(--cool)'],
    ['shadow', c.D, 0, 1, 'var(--ink-3)'],
  ]) {
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
      .map(i => `${NAME[IMG_MODEL.classes[i]]} ${Math.round(ps[i] * 100)}%`)
      .join(' · ')}</b><br>` +
    (m && m.date
      ? `Photo <b>${m.date}</b>${m.res ? ` · ${m.res} m/px source` : ''}${m.acc ? ` · stated accuracy ±${m.acc} m` : ''}${m.src ? ` · ${esc(m.src)}` : ''}`
      : 'Photo date unknown') +
    (r.sh.imgWmul < 1
      ? '<br><span style="color:var(--accent)">Coarse source imagery — this vote is down-weighted.</span>'
      : '') +
    passHtml(r.sh);
}
export function reFuse() {
  recompute();
  if (STATE.field && STATE.field.ready) scheduleField(60);
  render();
}
