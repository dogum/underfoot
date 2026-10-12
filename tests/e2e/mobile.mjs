import { chromium } from 'playwright';
import { route, settle, APP, OUT, CHROMIUM, checks } from './harness.mjs';
/* Phone checks with real touch input (CDP touch events → pointerType "touch"):
   the topbar, drawing by touch, and the sheet the answer sits in (ui/sheet). */
const b = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e =>
  errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')),
);
await route(pg);
const { ok, done } = checks('touch (phone size)');
await pg.goto(APP + '#m=point&s=auto&v=37.748560,-119.586830');
await pg.waitForTimeout(2500);
const cdp = await ctx.newCDPSession(pg);
const touch = async (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const tap = async (x, y) => {
  await touch('touchStart', x, y);
  await pg.waitForTimeout(60);
  await touch('touchEnd');
  await pg.waitForTimeout(350);
};
const drag = async (x0, y0, x1, y1, steps = 8, ms = 16) => {
  await touch('touchStart', x0, y0);
  for (let k = 1; k <= steps; k++) {
    await touch('touchMove', x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
    await pg.waitForTimeout(ms);
  }
  await touch('touchEnd');
  /* a busy page handles touches late: wait two frames (queued input is handled before a frame
     is drawn), then until the sheet has settled, not a fixed time */
  await pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await pg.waitForFunction(() => !window.SHEET?.dragging, null, { timeout: 5000 }).catch(() => {});
  await pg.waitForTimeout(450);
};
/* the part of the map the sheet leaves open */
const open = () =>
  pg.evaluate(() => {
    const m = document.querySelector('#map').getBoundingClientRect(),
      s = document.querySelector('#sheet').getBoundingClientRect();
    return { x: m.x, y: m.y, w: m.width, h: s.top - m.y };
  });
const at = (o, fx, fy) => [o.x + o.w * fx, o.y + o.h * fy];
const sheetState = () =>
  pg.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect(),
      body = r('#sheetBody'),
      bar = r('#sheetBar');
    return {
      h: SHEET.h,
      px: Math.round(SHEET.px),
      body: Math.round(Math.max(0, Math.min(innerHeight, body.bottom) - body.top)),
      bar: bar.top >= 0 && bar.bottom <= innerHeight && bar.height > 30,
      map: Math.round(r('#sheet').top - r('#map').top),
    };
  });

ok('coarse pointer detected', await pg.evaluate(() => TOUCH));
const nudge0 = await pg.evaluate(() => document.querySelector('#sheetGrip').classList.contains('nudge'));
// every topbar control visible on screen without horizontal scrolling
const vis = await pg.evaluate(() =>
  [
    '#mPoint',
    '#mPath',
    '#search',
    '#btnCoords',
    '#btnFile',
    '#btnClear',
    '#btnHistory',
    '#btnMarks',
    '#btnExport',
    '#btnTable',
    '#btnAbout',
  ].map(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return [s, r.left >= 0 && r.right <= innerWidth + 0.5 && r.width > 0];
  }),
);
ok(
  'all topbar controls on screen',
  vis.every(v => v[1]),
  vis
    .filter(v => !v[1])
    .map(v => v[0])
    .join(' ') || '11/11',
);
const TB = await pg.evaluate(() => {
  const r = s => document.querySelector(s).getBoundingClientRect(),
    tools = [
      '#btnCoords',
      '#btnFile',
      '#btnClear',
      '#btnHistory',
      '#btnMarks',
      '#btnExport',
      '#btnTable',
    ].map(r),
    labels = [...document.querySelectorAll('#topbar .tbtn .wide, #topbar .tbtn .ph')].filter(
      e => e.getBoundingClientRect().width > 0,
    );
  return {
    row1:
      Math.abs(r('#searchWrap').top - r('#btnAbout').top) < 6 &&
      Math.abs(r('#mPath').top - r('#btnAbout').top) < 6,
    span: (tools.at(-1).right - tools[0].left) / innerWidth,
    oneRow: tools.every(t => Math.abs(t.top - tools[0].top) < 2),
    labels: labels.map(e => e.textContent).join(' · '),
  };
});
ok(
  'search shares the first row; the seven tools spread across the second, labelled',
  TB.row1 && TB.oneRow && TB.span > 0.9 && TB.labels.split(' · ').length === 7,
  TB.labels,
);
ok(
  'no horizontal page overflow',
  await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
// export menu opens fully inside the viewport
await pg.locator('#btnExport').tap();
await pg.waitForTimeout(200);
const em = await pg.evaluate(() => {
  const m = document.querySelector('#exportMenu'),
    r = m.getBoundingClientRect();
  return { on: m.classList.contains('on'), l: r.left, r: r.right, h: r.height };
});
ok(
  'export menu visible and inside the screen',
  em.on && em.h > 40 && em.l >= 0 && em.r <= 390,
  JSON.stringify(em),
);
await pg.screenshot({ path: OUT + '/5_mobile_menu.png' });
await pg.locator('#btnHistory').tap();
await pg.waitForTimeout(200);
const hm = await pg.evaluate(() => {
  const m = document.querySelector('#historyMenu'),
    r = m.getBoundingClientRect();
  return { on: m.classList.contains('on'), l: r.left, r: r.right, h: r.height };
});
ok(
  'recent menu visible and inside the screen',
  hm.on && hm.h > 30 && hm.l >= 0 && hm.r <= 390,
  JSON.stringify(hm),
);
await pg.evaluate(() => closeMenus());

// ---------- the map's controls ----------
await pg.locator('#layersBtn').tap();
await pg.waitForTimeout(200);
const L1 = await pg.evaluate(() => ({
  sat: document.querySelector('#bmSat').getBoundingClientRect().width > 0,
  field: document.querySelector('#ovField').getBoundingClientRect().width > 0,
}));
await pg.locator('#bmDark').tap();
await pg.waitForTimeout(200);
const src = await pg.evaluate(() => MAP.src);
await pg.locator('#bmSat').tap();
let o = await open();
await tap(...at(o, 0.5, 0.5));
const L2 = await pg.evaluate(() => document.querySelector('#bmSat').getBoundingClientRect().width === 0);
ok(
  'the basemap and overlays fold behind one button; a tap on the map folds them again',
  L1.sat && L1.field && src === 'dark' && L2,
  JSON.stringify({ ...L1, picked: src, folded: L2 }),
);
await pg.locator('#lockBtn').tap();
await pg.waitForTimeout(300);
const lk0 = await pg.evaluate(() => ({
  hint: !document.querySelector('#hint').hidden && /Locked/.test(document.querySelector('#hint').textContent),
}));
await pg.waitForTimeout(4000);
const lk1 = await pg.evaluate(() => ({
  hint: !document.querySelector('#hint').hidden,
  locked: MAP.locked,
  label: document.querySelector('#lockTxt').textContent,
}));
await pg.locator('#lockBtn').tap();
await pg.waitForTimeout(200);
ok(
  'locking shows its hint for a few seconds, then only the lock button says so',
  lk0.hint && !lk1.hint && lk1.locked && /Locked/.test(lk1.label),
  JSON.stringify({ shown: lk0.hint, after: lk1 }),
);

// ---------- path drawing by touch: tap 3 vertices, the Done button finishes ----------
await pg.locator('#btnClear').tap();
await pg.locator('#mPath').tap();
await pg.waitForTimeout(300);
o = await open();
await tap(...at(o, 0.25, 0.3));
o = await open();
await tap(...at(o, 0.5, 0.5));
await tap(...at(o, 0.75, 0.38));
let s = await pg.evaluate(() => {
  const h = document.querySelector('#hint').getBoundingClientRect(),
    sh = document.querySelector('#sheet').getBoundingClientRect();
  return {
    v: STATE.verts.length,
    drawing: MAP.drawing,
    hint: document.querySelector('#hint').textContent,
    above: h.bottom <= sh.top,
    sheet: Math.round(sh.height),
  };
});
ok(
  'tap adds vertices; the sheet steps down to its handle and the hint’s Undo / Done sit above it',
  s.v === 3 && s.drawing && /Undo/.test(s.hint) && /Done/.test(s.hint) && s.above && s.sheet <= 40,
  JSON.stringify(s),
);
await pg.screenshot({ path: OUT + '/6_mobile_drawing.png' });
await pg.locator('#hint button[data-act=undo]').tap();
await pg.waitForTimeout(150);
s = await pg.evaluate(() => STATE.verts.length);
ok('Undo button removes the last vertex', s === 2, 'verts ' + s);
await tap(...at(o, 0.75, 0.38));
await pg.locator('#hint button[data-act=done]').tap();
await pg.waitForTimeout(200);
s = await pg.evaluate(() => ({
  v: STATE.verts.length,
  drawing: MAP.drawing,
  hint: document.querySelector('#hint').textContent,
}));
ok('Done finishes the line', s.v === 3 && !s.drawing && /long-press/.test(s.hint), JSON.stringify(s));

// long-press a vertex deletes it (exactly one); the sheet at peek keeps the vertices clear of it
await pg.evaluate(() => setHeight('peek'));
await pg.waitForTimeout(450);
const mb = await pg.locator('#map').boundingBox();
const [vx, vy] = await pg.evaluate(() => toScreen(STATE.verts[1].lat, STATE.verts[1].lon));
await touch('touchStart', mb.x + vx, mb.y + vy);
await pg.waitForTimeout(800);
await touch('touchEnd');
await pg.waitForTimeout(300);
s = await pg.evaluate(() => STATE.verts.length);
ok('long-press deletes one vertex', s === 2, 'verts ' + s);

// touch-drag a vertex reshapes; touch-drag elsewhere pans without moving vertices
const v0 = await pg.evaluate(() => JSON.stringify(STATE.verts));
const [ax, ay] = await pg.evaluate(() => toScreen(STATE.verts[0].lat, STATE.verts[0].lon));
await drag(mb.x + ax, mb.y + ay, mb.x + ax + 36, mb.y + ay + 24, 6);
const v1 = await pg.evaluate(() => JSON.stringify(STATE.verts));
ok('touch-drag a vertex moves it', v1 !== v0);
const c0 = await pg.evaluate(() => [MAP.lat, MAP.lon]);
o = await open();
const [px0, py0] = at(o, 0.15, 0.85);
await drag(px0, py0, px0 + 48, py0 - 30, 6);
const v2 = await pg.evaluate(() => JSON.stringify(STATE.verts)),
  c1 = await pg.evaluate(() => [MAP.lat, MAP.lon]);
ok('touch pan moves the map, not the line', v2 === v1 && (c1[0] !== c0[0] || c1[1] !== c0[1]));

// ---------- the sheet ----------
await settle(pg, 90);
await pg.evaluate(() => setHeight('half'));
await pg.waitForTimeout(450);
await pg.screenshot({ path: OUT + '/7_mobile_path.png' });
const head = await pg.evaluate(() => ({
  strip:
    !document.querySelector('#sheetStrip').hidden && document.querySelector('#sheetStrip').clientWidth > 300,
  arrows: document.querySelectorAll('#sheetBar .sbArr').length,
  tabs: [...document.querySelectorAll('#sheetTabs button')].map(b => b.textContent).join(' '),
  chips: document.querySelector('#stations').getBoundingClientRect().height,
}));
ok(
  'a line heads the sheet with its strip, ‹ › and five tabs, in place of the station chips',
  head.strip && head.arrows === 2 && head.tabs === 'Answer Route Going Years Evidence' && head.chips === 0,
  head.tabs,
);
await pg.locator('#sheetBar .sbArr[data-step="1"]').tap();
await pg.locator('#sheetBar .sbArr[data-step="1"]').tap();
await pg.waitForTimeout(300);
const st = await pg.evaluate(() => ({
  sel: STATE.sel,
  bar: document.querySelector('#sheetBar').textContent,
}));
ok('› steps along the line, and the sheet names the station', st.sel === 2 && /#3 of/.test(st.bar), st.bar);
const sb = await pg.locator('#sheetStrip').boundingBox();
const seen = new Set();
await touch('touchStart', sb.x + 40, sb.y + sb.height / 2);
for (let k = 1; k <= 12; k++) {
  await touch('touchMove', sb.x + 40 + ((sb.width - 50) * k) / 12, sb.y + sb.height / 2);
  await pg.waitForTimeout(40);
  seen.add(await pg.evaluate(() => STATE.sel));
}
await touch('touchEnd');
await pg.waitForTimeout(500);
const sc = await pg.evaluate(() => {
  const s = STATE.stations[STATE.sel],
    [, y] = toScreen(s.lat, s.lon);
  return { sel: STATE.sel, n: STATE.stations.length, inView: y > 0 && y < MAP.H - SHEET.px };
});
ok(
  'dragging along the strip scrubs through the stations, and the map keeps the station in view',
  seen.size >= 6 && sc.sel >= sc.n - 3 && sc.inView,
  `${seen.size} stations on the way, ended on ${sc.sel + 1} of ${sc.n}`,
);
// heights: a tap on the handle steps half → full → peek → half
const H = {};
H.half = await sheetState();
await pg.locator('#sheetGrip').tap();
await pg.waitForTimeout(450);
H.full = await sheetState();
await pg.locator('#sheetGrip').tap();
await pg.waitForTimeout(450);
H.peek = await sheetState();
await pg.locator('#sheetGrip').tap();
await pg.waitForTimeout(450);
ok(
  'three heights from the handle: the station’s call and the marks always on screen; at half 240 px of answer beside the map, at full 450',
  H.half.h === 'half' &&
    H.full.h === 'full' &&
    H.peek.h === 'peek' &&
    H.half.bar &&
    H.full.bar &&
    H.peek.bar &&
    H.half.body >= 240 &&
    H.half.map >= 250 &&
    H.full.body >= 450 &&
    H.peek.map >= 0.75 * 844 - 100,
  `half ${H.half.body} px of answer, ${H.half.map} px of map · full ${H.full.body} · peek leaves ${H.peek.map} px of map`,
);
// a drag on the head moves it; a flick down drops a stop
const g = await pg.locator('#sheetGrip').boundingBox();
await drag(g.x + g.width / 2, g.y + 10, g.x + g.width / 2, g.y - 260, 10, 30);
const up = await pg.evaluate(() => SHEET.h);
const g2 = await pg.locator('#sheetGrip').boundingBox();
await drag(g2.x + g2.width / 2, g2.y + 10, g2.x + g2.width / 2, g2.y + 150, 3, 8);
const down = await pg.evaluate(() => SHEET.h);
ok(
  'dragging the head moves the sheet; a flick down drops it a stop',
  up === 'full' && down === 'half',
  `${up}, then ${down}`,
);
const nudge1 = await pg.evaluate(() => ({
  on: document.querySelector('#sheetGrip').classList.contains('nudge'),
  kept: localStorage.getItem('uf.sheetMoved'),
}));
ok(
  'the handle pulses until the sheet has been moved once on this device',
  nudge0 && !nudge1.on && nudge1.kept === '1',
  JSON.stringify({ before: nudge0, after: nudge1 }),
);
// the content drags the sheet too below full: up to full, and down to peek; at full it scrolls
await pg.evaluate(() => setHeight('half'));
await pg.waitForTimeout(450);
const bb = await pg.locator('#sheetBody').boundingBox();
await drag(bb.x + bb.width / 2, bb.y + 80, bb.x + bb.width / 2, bb.y - 140, 8, 30);
const up2 = await pg.evaluate(() => SHEET.h);
await pg.evaluate(() => setHeight('half'));
await pg.waitForTimeout(450);
const bb2 = await pg.locator('#sheetBody').boundingBox();
await drag(bb2.x + bb2.width / 2, bb2.y + 20, bb2.x + bb2.width / 2, bb2.y + 200, 8, 30);
const down2 = await pg.evaluate(() => SHEET.h);
await pg.evaluate(() => setHeight('full'));
await pg.waitForTimeout(450);
const bb3 = await pg.locator('#sheetBody').boundingBox(),
  top3 = await pg.evaluate(() => document.querySelector('#sheetBody').scrollTop);
await drag(bb3.x + bb3.width / 2, bb3.y + 300, bb3.x + bb3.width / 2, bb3.y + 60, 8, 30);
const scrolled = await pg.evaluate(() => ({
  h: SHEET.h,
  top: document.querySelector('#sheetBody').scrollTop,
}));
ok(
  'below full the sheet’s content drags it too, up to full and down to peek; at full it scrolls',
  up2 === 'full' && down2 === 'peek' && scrolled.h === 'full' && scrolled.top > top3,
  `${up2}, then ${down2}; at full scrolled ${Math.round(scrolled.top - top3)} px`,
);
// tabs
await pg.locator('#sheetTabs button[data-t=route]').tap();
await pg.waitForTimeout(400);
const R = await pg.evaluate(() => {
  const on = s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 0.5;
  };
  return {
    report: on('#report') && document.querySelector('#report').classList.contains('open'),
    chart: document.querySelector('#tcanvas').clientHeight >= 150,
    controls: ['#spacingSel', '#smRaw', '#smHmm', '#folOn', '#folOff'].every(on),
    answer: document.querySelector('#verdict').getBoundingClientRect().height === 0,
  };
});
ok(
  'Route holds the route card, open, and the full chart with its controls; the answer steps aside',
  R.report && R.chart && R.controls && R.answer,
  JSON.stringify(R),
);
await pg.locator('#sheetTabs button[data-t=evidence]').tap();
await pg.waitForTimeout(300);
const E = await pg.evaluate(() => ({
  ledger: document.querySelector('#ledger').getBoundingClientRect().height > 100,
  route: document.querySelector('#transect').getBoundingClientRect().height === 0,
}));
await pg.locator('#sheetTabs button[data-t=answer]').tap();
await pg.waitForTimeout(300);
const A = await pg.evaluate(() => {
  const b = document.querySelector('#verdict .vshare'),
    r = b && b.getBoundingClientRect();
  return {
    share: !!b && r.width > 0 && r.left >= 0 && r.right <= innerWidth,
    ledgerUnder: document.querySelector('#ledger').getBoundingClientRect().height,
  };
});
ok(
  'Evidence holds the ledger; Answer the call with its share button',
  E.ledger && E.route && A.share && A.ledgerUnder === 0,
  JSON.stringify({ ...E, ...A }),
);

// marking from the sheet's head, from a station in the middle of the line
await pg.evaluate(() => {
  setHeight('half');
  selectStation(2);
});
await pg.waitForTimeout(400);
const n0 = await pg.evaluate(() => marks().length);
await pg.locator('#sheetMark button[data-m=right]').tap();
await pg.waitForTimeout(600);
const M1 = await pg.evaluate(() => ({
  n: marks().length,
  row: document.querySelector('#sheetMark').textContent,
}));
await pg.locator('#sheetBar .sbArr[data-step="1"]').tap();
await pg.waitForTimeout(300);
await pg.locator('#sheetMark button[data-m=wrong]').tap();
await pg.waitForTimeout(600);
const M2 = await pg.evaluate(() => ({
  h: SHEET.h,
  tab: SHEET.tab,
  grid: !!document.querySelector('#verdict .mark .grid'),
  top: Math.round(document.querySelector('#verdict .mark').getBoundingClientRect().top),
  row: document.querySelector('#sheetMark').textContent,
}));
await pg.locator('#verdict .mark .foot .btn', { hasText: 'Cancel' }).tap();
await pg.waitForTimeout(300);
const M3 = await pg.evaluate(() => document.querySelector('#sheetMark').textContent),
  back = await pg.evaluate(() => SHEET.h);
ok(
  'right / wrong / not sure under the call: Right keeps a mark in one tap',
  M1.n === n0 + 1 && /Marked right/.test(M1.row),
  M1.row,
);
ok(
  'Wrong opens the editor at full height under Answer, what’s really here in view; Cancel brings the question back, and the sheet back to half',
  M2.h === 'full' &&
    M2.tab === 'answer' &&
    M2.grid &&
    M2.top < 450 &&
    /Marking/.test(M2.row) &&
    /Is it/.test(M3) &&
    back === 'half',
  JSON.stringify(M2),
);
// dialogs: the whole screen, Done at the top, and Back closes them without leaving the sounding
await pg.locator('#btnTable').tap();
await pg.waitForTimeout(300);
const D1 = await pg.evaluate(() => {
  const d = document.querySelector('#dlgTable'),
    r = d.getBoundingClientRect(),
    b = d.querySelector('.dlgDone').getBoundingClientRect();
  return {
    open: d.open,
    full: r.width >= innerWidth - 1 && r.height >= innerHeight - 1,
    done: b.top >= 0 && b.bottom < 80 && b.right <= innerWidth,
    hash: location.hash,
  };
});
await pg.evaluate(() => history.back());
await pg.waitForTimeout(400);
const D2 = await pg.evaluate(() => ({ open: document.querySelector('#dlgTable').open, hash: location.hash }));
await pg.locator('#btnTable').tap();
await pg.waitForTimeout(300);
await pg.locator('#dlgTable .dlgDone').tap();
await pg.waitForTimeout(400);
const D3 = await pg.evaluate(() => ({
  open: document.querySelector('#dlgTable').open,
  dlg: history.state?.dlg || null,
}));
ok(
  'dialogs fill the screen with Done at the top; Back closes one and keeps the sounding, and so does Done',
  D1.open && D1.full && D1.done && !D2.open && D2.hash === D1.hash && !D3.open && !D3.dlg,
  JSON.stringify({ ...D1, afterBack: D2.open, afterDone: D3 }),
);
// Export: a Share button beside each file, to the phone's share sheet (stood in for here)
await pg.evaluate(() => {
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', {
    value: async d => {
      window.__shared = d.files.map(f => f.name).join(',');
    },
    configurable: true,
  });
});
await pg.locator('#btnExport').tap();
await pg.waitForTimeout(200);
const rows = await pg.evaluate(() =>
  [...document.querySelectorAll('#exportMenu .shareRow b')].map(b => b.textContent),
);
await pg.locator('#exportMenu .shareRow', { hasText: 'CSV' }).locator('button.share').tap();
await pg.waitForTimeout(500);
const shared = await pg.evaluate(() => window.__shared || '');
ok(
  'Export: GeoJSON and CSV have Share beside them, which hands the file to the share sheet',
  rows.includes('GeoJSON') && rows.includes('CSV') && /\.csv$/.test(shared),
  `${rows.join(', ')} → ${shared}`,
);

// replacing a line that's being drawn (a file, a link, Recent): the new one is fitted above the sheet it brings back
await pg.locator('#btnClear').tap();
await pg.locator('#mPath').tap();
await pg.evaluate(() => setHeight('half'));
await pg.waitForTimeout(400);
o = await open();
await tap(...at(o, 0.3, 0.3));
await tap(...at(o, 0.6, 0.4));
const mid = await pg.evaluate(() => MAP.drawing);
await pg.evaluate(() =>
  setVerts(
    [
      { lat: 37.74856, lon: -119.58683 },
      { lat: 37.7462, lon: -119.588 },
      { lat: 37.7445, lon: -119.59 },
      { lat: 37.743, lon: -119.5899 },
      { lat: 37.7414, lon: -119.5892 },
    ],
    { mode: 'path' },
  ),
);
await pg.waitForTimeout(700);
const fit = await pg.evaluate(() => {
  const ys = STATE.verts.map(v => toScreen(v.lat, v.lon)[1]);
  return { h: SHEET.h, low: Math.round(Math.max(...ys)), open: Math.round(MAP.H - SHEET.px) };
});
ok(
  'a line replacing one mid-drawing is fitted above the sheet, not under it',
  mid && fit.h === 'half' && fit.low < fit.open,
  `${mid ? 'drawing' : 'not drawing'}, the sheet at ${fit.h}, lowest vertex at ${fit.low} px, the sheet from ${fit.open}`,
);

// ---------- a smaller phone ----------
const small = await (async () => {
  const c2 = await b.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const p2 = await c2.newPage();
  await route(p2);
  await p2.goto(APP);
  await settle(p2, 120);
  const h = await p2.evaluate(() => {
    const body = document.querySelector('#sheetBody').getBoundingClientRect(),
      bar = document.querySelector('#sheetBar').getBoundingClientRect();
    return {
      body: Math.round(Math.min(innerHeight, body.bottom) - body.top),
      bar: bar.bottom <= innerHeight,
      wide: document.documentElement.scrollWidth <= innerWidth,
    };
  });
  await c2.close();
  return h;
})();
ok(
  'at 375 × 667 the call is on screen and the answer has 150 px at half',
  small.bar && small.wide && small.body >= 150,
  `${small.body} px`,
);
done(errs);
await b.close();
