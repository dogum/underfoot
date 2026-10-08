import { chromium } from 'playwright';
import { route, APP, OUT, CHROMIUM, checks } from './harness.mjs';
/* Phone checks with real touch input (CDP touch events → pointerType "touch"). */
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

ok('coarse pointer detected', await pg.evaluate(() => TOUCH));
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
    .join(' ') || '10/10',
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

// path drawing by touch: switch mode, tap 3 vertices, the Done button finishes
await pg.locator('#btnClear').tap();
await pg.locator('#mPath').tap();
await pg.waitForTimeout(300);
const mb = await pg.locator('#map').boundingBox();
const X = f => mb.x + mb.width * f,
  Y = f => mb.y + mb.height * f;
await tap(X(0.25), Y(0.35));
await tap(X(0.5), Y(0.55));
await tap(X(0.75), Y(0.4));
let s = await pg.evaluate(() => ({
  v: STATE.verts.length,
  drawing: MAP.drawing,
  hint: document.querySelector('#hint').textContent,
}));
ok(
  'tap adds vertices; hint shows Undo/Done',
  s.v === 3 && s.drawing && /Undo/.test(s.hint) && /Done/.test(s.hint),
  JSON.stringify(s),
);
await pg.screenshot({ path: OUT + '/6_mobile_drawing.png' });
await pg.locator('#hint button[data-act=undo]').tap();
await pg.waitForTimeout(150);
s = await pg.evaluate(() => STATE.verts.length);
ok('Undo button removes the last vertex', s === 2, 'verts ' + s);
await tap(X(0.75), Y(0.4));
await pg.locator('#hint button[data-act=done]').tap();
await pg.waitForTimeout(200);
s = await pg.evaluate(() => ({
  v: STATE.verts.length,
  drawing: MAP.drawing,
  hint: document.querySelector('#hint').textContent,
}));
ok('Done finishes the line', s.v === 3 && !s.drawing && /long-press/.test(s.hint), JSON.stringify(s));
const tv = await pg.evaluate(() =>
  ['#spacingSel', '#smRaw', '#smHmm', '#folOn', '#folOff'].map(sel => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return [sel, r.left >= 0 && r.right <= innerWidth + 0.5 && r.width > 0];
  }),
);
ok(
  'transect controls on screen, the follow switch too',
  tv.every(v => v[1]),
  tv
    .filter(v => !v[1])
    .map(v => v[0])
    .join(' ') || '5/5',
);

// long-press a vertex deletes it (exactly one)
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
await touch('touchStart', mb.x + ax, mb.y + ay);
for (let k = 1; k <= 6; k++) {
  await touch('touchMove', mb.x + ax + k * 6, mb.y + ay + k * 4);
  await pg.waitForTimeout(16);
}
await touch('touchEnd');
await pg.waitForTimeout(200);
const v1 = await pg.evaluate(() => JSON.stringify(STATE.verts));
ok('touch-drag a vertex moves it', v1 !== v0);
const c0 = await pg.evaluate(() => [MAP.lat, MAP.lon]);
await touch('touchStart', X(0.15), Y(0.85));
for (let k = 1; k <= 6; k++) {
  await touch('touchMove', X(0.15) + k * 8, Y(0.85) - k * 5);
  await pg.waitForTimeout(16);
}
await touch('touchEnd');
await pg.waitForTimeout(200);
const v2 = await pg.evaluate(() => JSON.stringify(STATE.verts)),
  c1 = await pg.evaluate(() => [MAP.lat, MAP.lon]);
ok('touch pan moves the map, not the line', v2 === v1 && (c1[0] !== c0[0] || c1[1] !== c0[1]));

await pg.waitForTimeout(9000);
await pg.screenshot({ path: OUT + '/7_mobile_path.png' });
done(errs);
// the route card, last, so its taps can't move anything under the touch tests above
const rc = await pg.evaluate(() => {
  const r = document.querySelector('#report');
  return {
    shown: !r.hidden,
    open: r.classList.contains('open'),
    w: r.getBoundingClientRect().right <= innerWidth + 0.5,
  };
});
await pg.locator('#report .rhead').tap();
await pg.waitForTimeout(200);
const rc2 = await pg.evaluate(() => document.querySelector('#report').classList.contains('open'));
await pg.locator('#report .rhead').tap();
ok(
  'route card: one line on a phone, opens on a tap',
  rc.shown && !rc.open && rc.w && rc2,
  JSON.stringify({ ...rc, opened: rc2 }),
);
await b.close();
