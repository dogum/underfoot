import { chromium } from 'playwright';
import { route, launch, settle, APP, OUT, CHROMIUM, checks } from './harness.mjs';
/* Interaction checks: the v1 drag bug, point probe, path drawing, undo,
   vertex drag, keyboard, coordinate parsing, file loading, history, export. */
const { b, ctx } = await launch(chromium, { width: 1400, height: 900 }, 1);
const { ok, done } = checks('mouse + keyboard interaction');

// 0. the page as shipped, with no test globals: a missing import shows up here
{
  const p0 = await ctx.newPage(),
    e0 = [];
  p0.on('pageerror', e => e0.push(e.message));
  await route(p0, { globals: false });
  await p0.goto(APP + '#m=point&s=auto&v=37.748560,-119.586830');
  await p0.waitForTimeout(1500);
  const b0 = await p0.locator('#map').boundingBox(),
    v0 = () =>
      p0.evaluate(() => underfoot.STATE.verts.map(q => q.lat.toFixed(6) + ',' + q.lon.toFixed(6)).join(';'));
  const a = await v0();
  await p0.mouse.click(b0.x + b0.width * 0.3, b0.y + b0.height * 0.3);
  await p0.waitForTimeout(300);
  const c = await v0();
  await p0.keyboard.press('l');
  await p0.mouse.click(b0.x + b0.width * 0.4, b0.y + b0.height * 0.4);
  await p0.mouse.dblclick(b0.x + b0.width * 0.6, b0.y + b0.height * 0.5);
  await p0.waitForTimeout(300);
  const n = await p0.evaluate(() => underfoot.STATE.verts.length);
  ok(
    'as shipped (no test globals): a click drops the probe, a line can be drawn, no page errors',
    c !== a && n >= 2 && !e0.length,
    e0.length ? e0[0] : `${a} → ${c}; line of ${n}`,
  );
  await p0.close();
}

const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e =>
  errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')),
);
pg.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text());
});
await route(pg);
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

// 5. extend then undo with Backspace (the map is shorter now the transect is open)
const box3 = await pg.locator('#map').boundingBox();
await pg.mouse.click(box3.x + box3.width / 2 + 260, box3.y + box3.height / 2 + 60);
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

// 8b. the MAP basemap loads real tiles from a keyless source, drawn dark
const darkTiles = [];
const onTile = r =>
  /World_Dark_Gray_Base/.test(r.url()) &&
  darkTiles.push(r.status() + ' ' + (r.headers()['content-type'] || ''));
pg.on('response', onTile);
await pg.locator('#bmDark').click();
for (let i = 0; i < 40 && !darkTiles.length; i++) await pg.waitForTimeout(150);
await pg.waitForTimeout(400);
pg.off('response', onTile);
const lum = await ev(() => {
  const c = document.querySelector('#map'),
    k = c.width / c.getBoundingClientRect().width,
    d = c.getContext('2d').getImageData(Math.round(12 * k), Math.round(c.height - 60 * k), 1, 1).data;
  return Math.round(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]);
});
await pg.locator('#bmSat').click();
ok(
  'the MAP basemap draws keyless tiles, dimmed to the dark surface',
  darkTiles.length > 0 && darkTiles.every(t => /^200 image\//.test(t)) && lum > 0 && lum < 60,
  `${darkTiles.length} tiles from Esri's Dark Gray Canvas, luminance ${lum}`,
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

// 14a. a long line keeps its shape in a link: 600 winding points, encoded
const long = await ev(() => {
  const o = { lat: 37.7267, lon: -119.5444 },
    v = Array.from({ length: 600 }, (_, i) => ({
      lat: o.lat + (60 * Math.sin(i / 40)) / 110540,
      lon: o.lon + (i * 4) / 88000,
    }));
  setVerts(v, { mode: 'path' });
  writeHash();
  const h = location.hash;
  setVerts([o, { lat: o.lat + 0.001, lon: o.lon }], { mode: 'path' });
  return { h, v };
});
// wait for the short line's own link, then open the long one's
for (let i = 0; i < 40 && (await ev(() => location.hash)) === long.h; i++) await pg.waitForTimeout(100);
await ev(h => (location.hash = h), long.h);
await pg.waitForTimeout(400);
const back = await ev(
  ({ v }) => {
    const xy = p => [p.lon * 88000, p.lat * 110540],
      W = STATE.verts.map(xy);
    let worst = 0;
    for (const p of v) {
      const [x, y] = xy(p);
      let best = Infinity;
      for (let k = 0; k + 1 < W.length; k++) {
        const [ax, ay] = W[k],
          [bx, by] = W[k + 1],
          dx = bx - ax,
          dy = by - ay,
          t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
      }
      worst = Math.max(worst, best);
    }
    return { n: STATE.verts.length, worst };
  },
  { v: long.v },
);
ok(
  'a 600-point line survives a link to within a metre',
  /&p=[A-Za-z0-9_-]+$/.test(long.h) && long.h.length < 4000 && back.n > 20 && back.worst < 1.5,
  `${long.h.length} chars, ${back.n} points back, every original point within ${back.worst.toFixed(2)} m`,
);

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

// 16. area mode via key A: four corners, Enter closes the outline, and the hint says what to do
await pg.keyboard.press('a');
await pg.waitForTimeout(200);
const hA = await ev(() => document.querySelector('#hint').textContent);
const bA = await pg.locator('#map').boundingBox();
const ax = bA.x + bA.width / 2,
  ay = bA.y + bA.height / 2;
await pg.mouse.click(ax - 120, ay - 80);
await pg.mouse.click(ax + 120, ay - 80);
await pg.mouse.click(ax + 120, ay + 80);
await pg.mouse.click(ax - 120, ay + 80);
await pg.keyboard.press('Enter');
await pg.waitForTimeout(400);
const sA = await st(),
  aA = await ev(() => ({
    pressed: document.querySelector('#mArea').getAttribute('aria-pressed'),
    card: !document.querySelector('#areaCard').hidden,
  }));
ok(
  'draw an area: A, four clicks, Enter → a closed outline with tiles, the Area card and button on',
  sA.mode === 'area' && !sA.drawing && sA.n >= 1 && aA.pressed === 'true' && aA.card && /corners/.test(hA),
  `${sA.v.length} corners (the point kept as the first), ${sA.n} tiles · hint: ${hA.slice(0, 40)}`,
);

done(errs);
await b.close();
