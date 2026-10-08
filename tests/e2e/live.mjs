import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, APP, ROOT, OUT, checks } from './harness.mjs';
/* Here: the phone's position, emulated. Reading a fix, standing still, walking,
 * a rough fix, a walk up the Mist Trail, recording, and location turned off. */
const { ok, done } = checks('live: Here and recording');
const errs = [];
const { b, ctx } = await launch(chromium, { width: 1440, height: 900 }, 1);
await ctx.grantPermissions(['geolocation']);
const at = (lat, lon, accuracy = 8) => ctx.setGeolocation({ latitude: lat, longitude: lon, accuracy });
const pg = await ctx.newPage();
pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await route(pg);
await at(37.74856, -119.58683);
await pg.goto(APP);
await pg.evaluate(() => {
  localStorage.clear();
  Object.assign(window, underfoot);
});
await settle(pg, 120);
const state = () =>
  pg.evaluate(() => ({
    on: STATE.live.on,
    mode: STATE.mode,
    v: STATE.verts.length,
    lat: STATE.verts[0] && STATE.verts[0].lat,
    gps: STATE.gps,
    run: STATE.runId,
    pill: document.querySelector('#livePill').textContent,
    pressed: document.querySelector('#hereBtn').getAttribute('aria-pressed'),
    hist: loadHist().length,
  }));
const quiet = async () => {
  await pg.waitForTimeout(400);
  await settle(pg, 90);
};

// 1 · Here reads the fix
const h0 = (await state()).hist;
await pg.locator('#hereBtn').click();
await quiet();
let s = await state();
ok(
  'Here reads the fix: a point, its spread from the fix’s accuracy',
  s.on && s.pressed === 'true' && s.mode === 'point' && Math.abs(s.lat - 37.74856) < 1e-6 && s.gps === 8,
  JSON.stringify({ gps: s.gps, pill: s.pill }),
);
ok('the pill says live, the accuracy and the fix’s age', /LIVE · ±8 m · \d+ s ago/.test(s.pill), s.pill);
ok(
  'the station shows the fix; the Position tabs give way to it',
  await pg.evaluate(
    () =>
      /^±8 m/.test(document.querySelector('#readout .chip.live b')?.textContent || '') &&
      !document.querySelector('#gpsLive').hidden &&
      document.querySelector('#gpsTabs button[data-s="3"]').disabled,
  ),
);

// 2 · standing still is not re-read; walking is
const r0 = s.run;
await at(37.74856 + 3 / 110540, -119.58683);
await pg.waitForTimeout(800);
s = await state();
ok('standing still: 3 m at ±8 m is not re-read', s.run === r0, `run ${r0} → ${s.run}`);
await at(37.74856 + 40 / 110540, -119.58683);
await quiet();
s = await state();
ok('walking: 40 m is re-read', s.run > r0 && Math.abs(s.lat - (37.74856 + 40 / 110540)) < 1e-6);

// 3 · a fix too rough to read
const r1 = s.run;
await at(37.7495, -119.5862, 120);
await pg.waitForTimeout(800);
s = await state();
ok('a ±120 m fix is not read, and the pill says why', s.run === r1 && /too rough/.test(s.pill), s.pill);
ok('recent soundings are not filled with fixes', s.hist === h0, `${h0} → ${s.hist}`);

// 4 · a walk up the Mist Trail: the Park Service's line, wobbling ±6 m like a phone
const gpx = fs.readFileSync(path.join(ROOT, 'tests/fixtures/trails/yose-mist-trail.gpx'), 'utf8');
const trail = [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => ({
  lat: +m[1],
  lon: +m[2],
}));
const walk = trail.slice(20, 60).map((p, i) => ({
  lat: p.lat + (6 * Math.sin(i * 1.7)) / 110540,
  lon: p.lon + (6 * Math.cos(i * 2.3)) / 88000,
}));
for (const p of walk) {
  await at(p.lat, p.lon);
  await pg.waitForTimeout(120);
}
await quiet();
const T = await pg.evaluate(() => {
  const st = STATE.stations[0],
    v = STATE.results[0] && STATE.results[0].view;
  return {
    f: st && st.f,
    top: v && v.top,
    p: v && Math.round(v.topP * 100),
    sub: document.querySelector('#verdict small')?.textContent,
    chips: [...document.querySelectorAll('#readout .chip b')].slice(0, 3).map(b => b.textContent),
  };
});
ok(
  'on the Mist Trail, the newest fix is read with the ones behind it and moved onto the trail',
  T.f && T.f.cls === 'path' && T.top === 'path' && /^on Mist Trail · live$/.test(T.sub),
  `${T.top} ${T.p}% · ${T.sub} · ${T.chips.join(' | ')}`,
);
await pg.screenshot({ path: OUT + '/live-trail.png' });

// 5 · recording: the walk becomes a line when it stops
await pg.locator('#livePill [data-live=rec]').click();
for (const p of trail.slice(60, 80)) {
  await at(p.lat, p.lon, 6);
  await pg.waitForTimeout(80);
}
await pg.waitForTimeout(300);
s = await state();
ok('recording: the pill counts the walk', /^REC · \d+ m · 0:\d\d/.test(s.pill), s.pill);
await pg.locator('#livePill [data-live=rec]').click();
await quiet();
s = await state();
ok(
  'Stop: Here ends and the walk is read as a line',
  !s.on && s.pressed === 'false' && s.mode === 'path' && s.v >= 10 && s.hist === h0 + 1,
  JSON.stringify({ mode: s.mode, verts: s.v, hist: s.hist }),
);

// 6 · anything else that sets the probe ends Here
await pg.locator('#hereBtn').click();
await quiet();
await pg.evaluate(() => (location.hash = '#m=point&s=auto&v=37.745950,-119.533150'));
await pg.waitForTimeout(600);
s = await state();
ok('opening a link ends Here', !s.on && Math.abs(s.lat - 37.74595) < 1e-6);
await b.close();

// 7 · location turned off for the page
const { b: b2, ctx: c2 } = await launch(chromium, { width: 390, height: 844 }, 1, {
  isMobile: true,
  hasTouch: true,
});
await c2.clearPermissions();
const p2 = await c2.newPage();
await route(p2);
await p2.goto(APP + '#m=point&s=auto&v=37.748560,-119.586830');
await p2.waitForTimeout(800);
await p2.locator('#hereBtn').tap();
await p2.waitForTimeout(1500);
const D = await p2.evaluate(() => ({
  msg: !document.querySelector('#liveMsg').hidden && document.querySelector('#liveMsgText').textContent,
  pressed: document.querySelector('#hereBtn').getAttribute('aria-pressed'),
  inView: (() => {
    const r = document.querySelector('#hereBtn').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.width > 0;
  })(),
}));
ok('phone: the Here button is on screen', D.inView);
ok(
  'location off: a plain message, and the button goes back to grey',
  /Location is off/.test(D.msg || '') && D.pressed === 'false',
  (D.msg || '').slice(0, 60),
);
await b2.close();
done(errs);
