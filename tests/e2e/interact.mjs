import { chromium } from 'playwright';
import { route, launch, settle, APP, OUT, CHROMIUM, checks } from './harness.mjs';
/* Interaction checks: the v1 drag bug, point probe, path drawing, undo,
   vertex drag, keyboard, coordinate parsing, file loading, history, export. */
const { b, ctx } = await launch(chromium, { width: 1400, height: 900 }, 1);
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e =>
  errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')),
);
pg.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text());
});
await route(pg);
const { ok, done } = checks('mouse + keyboard interaction');
await pg.goto(APP + '#m=point&s=auto&v=37.748560,-119.586830');
await settle(pg, 60);
const box = await pg.locator('#map').boundingBox();
const cx = box.x + box.width / 2,
  cy = box.y + box.height / 2;
const ev = async (f, a) => {
  for (let i = 0; ; i++) {
    try {
      return await pg.evaluate(f, a);
    } catch (e) {
      if (i > 4 || !/context was destroyed/.test(e.message)) throw e;
      console.log('retry evaluate');
      await pg.waitForTimeout(150);
    }
  }
};
const st = () =>
  ev(() => ({
    mode: STATE.mode,
    v: STATE.verts.map(p => [+p.lat.toFixed(6), +p.lon.toFixed(6)]),
    n: STATE.stations.length,
    lat: MAP.lat,
    lon: MAP.lon,
    z: MAP.z,
    drawing: MAP.drawing,
    sel: STATE.sel,
  }));

// 1. panning the map must NOT move the probe (the v1 bug)
let s0 = await st();
const [px, py] = await ev(() => toScreen(STATE.verts[0].lat, STATE.verts[0].lon));
await pg.mouse.move(box.x + px + 120, box.y + py + 90);
await pg.mouse.down();
await pg.mouse.move(box.x + px + 220, box.y + py + 150, { steps: 8 });
await pg.mouse.up();
let s1 = await st();
ok(
  'pan leaves the probe in place',
  JSON.stringify(s0.v) === JSON.stringify(s1.v) && (s0.lat !== s1.lat || s0.lon !== s1.lon),
  `probe ${s1.v[0]} map moved ${(s1.lat - s0.lat).toExponential(1)}`,
);

// 2. dragging the probe itself moves it
const [qx, qy] = await ev(() => toScreen(STATE.verts[0].lat, STATE.verts[0].lon));
await pg.mouse.move(box.x + qx, box.y + qy);
await pg.mouse.down();
await pg.mouse.move(box.x + qx + 60, box.y + qy + 40, { steps: 6 });
await pg.mouse.up();
let s2 = await st();
ok('drag the probe relocates it', JSON.stringify(s2.v) !== JSON.stringify(s1.v), `${s1.v[0]} → ${s2.v[0]}`);

// 3. a click drops the probe at the click
await pg.mouse.click(cx - 150, cy + 80);
await pg.waitForTimeout(150);
let s3 = await st();
const want = await ev(([x, y]) => toLatLon(x, y), [cx - 150 - box.x, cy + 80 - box.y]);
ok(
  'click drops the probe there',
  Math.abs(s3.v[0][0] - want.lat) < 2e-6 && Math.abs(s3.v[0][1] - want.lon) < 2e-6,
);

// 4. path mode via key L, draw 3 vertices, finish with double-click
await pg.keyboard.press('Escape');
await pg.locator('#btnClear').click();
await pg.keyboard.press('l');
await pg.waitForTimeout(200);
const box2 = await pg.locator('#map').boundingBox();
const cx2 = box2.x + box2.width / 2,
  cy2 = box2.y + box2.height / 2;
await pg.mouse.click(cx2 - 200, cy2 - 100);
await pg.mouse.click(cx2, cy2);
await pg.mouse.dblclick(cx2 + 200, cy2 + 60);
await pg.waitForTimeout(300);
let s4 = await st();
ok(
  'draw path: 3 clicks + dblclick → 3 vertices, finished',
  s4.mode === 'path' && s4.v.length === 3 && !s4.drawing,
  `verts ${s4.v.length}, drawing ${s4.drawing}, stations ${s4.n}`,
);

// 5. extend then undo with Backspace
await pg.mouse.click(cx2 + 260, cy2 + 100);
let s5 = await st();
await pg.keyboard.press('Backspace');
await pg.waitForTimeout(100);
let s6 = await st();
ok('click extends, ⌫ undoes', s5.v.length === 4 && s6.v.length === 3, `${s5.v.length} → ${s6.v.length}`);
await pg.keyboard.press('Enter');

// 6. drag the middle vertex
const [vx, vy] = await ev(() => toScreen(STATE.verts[1].lat, STATE.verts[1].lon));
await pg.mouse.move(box.x + vx, box.y + vy);
await pg.mouse.down();
await pg.mouse.move(box.x + vx + 40, box.y + vy - 50, { steps: 6 });
await pg.mouse.up();
let s7 = await st();
ok(
  'drag a vertex reshapes the path',
  s7.v.length === 3 &&
    JSON.stringify(s7.v[1]) !== JSON.stringify(s6.v[1]) &&
    JSON.stringify(s7.v[0]) === JSON.stringify(s6.v[0]),
);

// 7. right-click deletes a vertex
const [wx, wy] = await ev(() => toScreen(STATE.verts[2].lat, STATE.verts[2].lon));
await pg.mouse.click(box.x + wx, box.y + wy, { button: 'right' });
await pg.waitForTimeout(100);
let s8 = await st();
ok('right-click deletes a vertex', s8.v.length === 2, `${s7.v.length} → ${s8.v.length}`);

// 8. wheel zoom keeps the point under the cursor fixed
const before = await ev(([x, y]) => toLatLon(x, y), [300, 250]);
await pg.mouse.move(box.x + 300, box.y + 250);
await pg.mouse.wheel(0, -240);
await pg.waitForTimeout(120);
const after = await ev(([x, y]) => toLatLon(x, y), [300, 250]);
const zz = await ev(() => MAP.z);
ok(
  'wheel zoom anchors at the cursor',
  Math.abs(before.lat - after.lat) < 1e-6 && Math.abs(before.lon - after.lon) < 1e-6 && zz > s8.z,
  `z ${s8.z.toFixed(2)} → ${zz.toFixed(2)}`,
);

// 9. coordinate parser
const P = await ev(() =>
  [
    '37.7486, -119.5868',
    '37°44\'55.0"N 119°35\'12.5"W',
    'N 37.7486 W 119.5868',
    '37.7486 N, 119.5868 W',
    '-33.8568 151.2153',
    '37.7486\t-119.5868\t1222',
    'garbage',
  ].map(t => parseLatLon(t)),
);
ok(
  'coordinate formats (decimal, DMS, hemispheres, tabbed, negative)',
  P.slice(0, 6).every(Boolean) &&
    P[6] === null &&
    Math.abs(P[1].lat - 37.7486) < 1e-3 &&
    Math.abs(P[1].lon + 119.5868) < 1e-3 &&
    P[4].lat < 0,
  JSON.stringify(P.map(p => p && [+p.lat.toFixed(4), +p.lon.toFixed(4)])),
);

// 10. GPX / GeoJSON / CSV parsing
const F = await ev(() => ({
  gpx: parseGPX(
    '<gpx><trk><trkseg><trkpt lat="37.74" lon="-119.58"/><trkpt lat="37.741" lon="-119.581"/></trkseg></trk></gpx>',
  ).length,
  gj: parseGeoJSON({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-119.58, 37.74],
        [-119.581, 37.741],
        [-119.582, 37.742],
      ],
    },
  }).length,
  csv: parseCSV('name,latitude,longitude\na,37.74,-119.58\nb,37.741,-119.581').length,
  csv2: parseCSV('lon;lat\n-119.58;37.74\n-119.581;37.741')
    .map(p => p.lat.toFixed(2))
    .join(','),
}));
ok(
  'GPX / GeoJSON / CSV (named + swapped columns)',
  F.gpx === 2 && F.gj === 3 && F.csv === 2 && F.csv2 === '37.74,37.74',
  JSON.stringify(F),
);

// 11. coords dialog round trip
await pg.locator('#btnCoords').click();
await pg.locator('#coordText').fill('37.74856,-119.58683\n37.7462,-119.5880');
await pg.locator('#coordGo').click();
await pg.waitForTimeout(200);
let s9 = await st();
ok('paste-coordinates dialog sets a path', s9.mode === 'path' && s9.v.length === 2);

// 12. URL hash + history
await settle(pg, 60);
const H = await ev(() => ({ hash: location.hash, hist: loadHist().length }));
ok('URL hash and history written', /v=37\.748560/.test(H.hash) && H.hist >= 1, H.hash.slice(0, 60));

// 13. exports
const ex = await ev(async () => {
  const got = [],
    orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) got.push([this.download, this.href]);
  };
  exportGeoJSON();
  exportCSV();
  HTMLAnchorElement.prototype.click = orig;
  return Promise.all(
    got.map(async ([n, h]) => {
      const t = await (await fetch(h)).text();
      return [n, t.length, t.slice(0, 80)];
    }),
  );
});
ok(
  'GeoJSON + CSV export',
  ex.length === 2 &&
    ex[0][1] > 200 &&
    /FeatureCollection/.test(ex[0][2]) &&
    /^station|^i,|lat/.test(ex[1][2]),
  ex.map(e => e[0] + ' ' + e[1] + 'B').join(', '),
);

// 13b. "Report a wrong call" opens a prefilled GitHub issue for this sounding
const rep = await ev(() => {
  let url = null;
  const o = window.open;
  window.open = u => {
    url = u;
    return null;
  };
  showExport();
  const b = [...document.querySelectorAll('#exportMenu button')].find(x => /wrong call/i.test(x.textContent));
  b && b.click();
  window.open = o;
  return url;
});
const q = rep && new URL(rep).searchParams;
ok(
  'Report a wrong call → prefilled issue',
  !!q &&
    q.get('template') === 'wrong-call.yml' &&
    /dogum\.github\.io\/underfoot\/#m=path/.test(q.get('link')) &&
    /^Wrong call: \S/.test(q.get('title')),
  q ? q.get('title') + ' · ' + q.get('link').slice(0, 60) : 'no url',
);

// 14. keyboard station stepping
await ev(() => selectStation(0));
await pg.keyboard.press(']');
await pg.keyboard.press(']');
const sel = await ev(() => STATE.sel);
ok('] steps stations', sel === 2, 'sel ' + sel);

// 14b. a new link in an open tab (hash change) loads that sounding
await ev(() => {
  location.hash = '#m=point&s=auto&v=37.745950,-119.533150'; // Half Dome
});
await pg.waitForTimeout(400);
const hc = await ev(() => ({
  mode: STATE.mode,
  v: STATE.verts.map(p => [+p.lat.toFixed(4), +p.lon.toFixed(4)]),
}));
ok(
  'a new link in an open tab loads it',
  hc.mode === 'point' && hc.v.length === 1 && Math.abs(hc.v[0][1] + 119.5332) < 1e-3,
  JSON.stringify(hc),
);
await settle(pg, 60);

// 15. GPS uncertainty tabs
await pg.keyboard.press('p');
await settle(pg, 60);
const g = await ev(() => {
  const out = [];
  for (const s of [0, 3, 10]) {
    STATE.gps = s;
    recompute();
    out.push(STATE.results[0].view.top + ' ' + STATE.results[0].view.topP.toFixed(2));
  }
  STATE.gps = 0;
  recompute();
  render();
  return out;
});
ok('GPS ±0/3/10 re-weights over the field', g.length === 3, g.join(' | '));

done(errs);
await b.close();
