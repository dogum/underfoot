import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, LOG, APP, OUT, ROOT, checks } from './harness.mjs';
/* End to end: a point, the demo line and a trail, every source live (or from the cache). */
const { ok, done } = checks('soundings: a point, a line and a trail');
const errs = [];
const { b, ctx } = await launch(chromium, { width: 1500, height: 940 }, 1);
const pg = await ctx.newPage();
pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
pg.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text());
});
await route(pg);

// a point: the Ansel Adams Gallery in Yosemite Village
let t0 = Date.now();
await pg.goto(APP + '#m=point&s=auto&v=37.748560,-119.586830');
let s = await settle(pg, 90);
ok('point settles with the field map', !!s, s ? `${((Date.now() - t0) / 1000).toFixed(1)} s` : 'timed out');
let r = await pg.evaluate(() => {
  const x = STATE.results[0];
  return { top: x.view.top, p: x.view.topP, srcs: x.fused.ledger.map(l => l.id + ':' + l.status) };
});
ok(
  'all 8 sources answer',
  r.srcs.every(x => x.endsWith(':ok')),
  r.srcs.join(' '),
);
ok(
  'the gallery reads as a building',
  r.top === 'building' && r.p > 0.9,
  `${r.top} ${Math.round(r.p * 100)}%`,
);
ok(
  'a clear answer has no "worth a look"',
  await pg.evaluate(() => !document.querySelector('#verdict .look')),
);
await pg.screenshot({ path: OUT + '/point.png' });
const card = async () =>
  pg.evaluate(async () => {
    const cv = await shareCard(),
      blob = await cardBlob(cv);
    return { type: blob.type, kb: Math.round(blob.size / 1024), w: cv.width, h: cv.height };
  });
let C = await card();
ok(
  'share card for a point: a 1200 × 630 JPEG under 400 KB',
  C.type === 'image/jpeg' && C.w === 1200 && C.h === 630 && C.kb < 400,
  `${C.w} × ${C.h}, ${C.kb} KB`,
);

// the demo line (no hash, no history)
t0 = Date.now();
await pg.evaluate(() => {
  localStorage.clear();
  history.replaceState(null, '', location.pathname);
});
await pg.reload();
s = await settle(pg, 120);
ok('demo line settles', !!s, s ? `${((Date.now() - t0) / 1000).toFixed(1)} s` : 'timed out');
const L = await pg.evaluate(() => ({
  n: STATE.stations.length,
  stretches: STATE.stretches.length,
  len: Math.round(STATE.stations.at(-1).d),
  cross: STATE.stations
    .map((st, i) =>
      st.x
        ? {
            what: st.x.what,
            cls: st.x.cls,
            call: STATE.results[i].view.top,
            p: STATE.results[i].view.topP,
            name: STATE.results[i].q.best[st.x.cls] && STATE.results[i].q.best[st.x.cls].name,
          }
        : null,
    )
    .filter(Boolean),
}));
ok('line has stations along 900 m', L.n >= 40 && L.len > 850, `${L.n} stations, ${L.len} m`);
const road = L.cross.find(c => /Northside Drive/.test(c.name || ''));
ok(
  'crosses Northside Drive as paved',
  road && road.call === 'paved' && road.p > 0.9,
  road ? `${road.call} ${Math.round(road.p * 100)}%` : 'no crossing found',
);
const streams = L.cross.filter(c => c.cls === 'water');
ok(
  'the Merced River crossing reads as water',
  streams.length >= 1 && streams.every(c => c.call === 'water'),
  streams.map(c => `${c.call} ${Math.round(c.p * 100)}%`).join(', '),
);
const trail = L.cross.find(c => /Cook's Meadow Trail/.test(c.name || ''));
ok(
  "Cook's Meadow Trail crossing reads as path",
  trail && trail.call === 'path',
  trail ? `${trail.call} ${Math.round(trail.p * 100)}%` : 'missing',
);
const rep = await pg.evaluate(() => {
  const r = currentReport();
  return {
    sum: r.classes.reduce((a, c) => a + c.m, 0) + r.pending,
    len: r.length,
    cross: r.crossings.reduce((a, c) => a + c.n, 0),
    top: r.classes
      .slice(0, 3)
      .map(c => `${c.cls} ${Math.round(c.m)} m`)
      .join(', '),
  };
});
const W = await pg.evaluate(() => {
  const B = spanBounds(STATE.stations);
  return {
    roads: STATE.stations
      .map((s, i) => (s.x && s.x.cls === 'paved' ? +(B[i + 1] - B[i]).toFixed(1) + '/' + 2 * s.x.w : null))
      .filter(Boolean),
    card: !document.querySelector('#report').hidden && document.querySelector('#report .rhead').textContent,
  };
});
ok(
  'a road crossing counts its mapped width, not the gap to its neighbours',
  W.roads.length === 3 && W.roads.every(r => +r.split('/')[0] <= +r.split('/')[1] + 0.01),
  W.roads.join(', ') + ' m (counted / mapped)',
);
C = await card();
ok(
  'share card for a line: a 1200 × 630 JPEG under 400 KB',
  C.type === 'image/jpeg' && C.w === 1200 && C.h === 630 && C.kb < 400,
  `${C.w} × ${C.h}, ${C.kb} KB`,
);
ok('the route card sits above the transect', /^Route896 m · forest \d+% · grass/.test(W.card || ''), W.card);
ok(
  'the route report reconciles with the transect',
  Math.abs(rep.sum - rep.len) < 0.01 && rep.cross === L.cross.length,
  `${Math.round(rep.len)} m: ${rep.top}… · ${rep.cross} crossings`,
);
const DB = await pg.evaluate(() => {
  const lit = STATE.results.map((r, i) => [i, r.doubt ? r.doubt.score : 0]).filter(([, s]) => s >= 0.5);
  const top = lit.sort((a, b) => b[1] - a[1])[0];
  selectStation(top[0]);
  return {
    lit: lit.length,
    n: STATE.results.length,
    look: document.querySelector('#verdict .look')?.textContent || '',
  };
});
ok(
  'the demo line: some stations worth a look, and why',
  DB.lit >= 5 && DB.lit <= 25 && /^Worth a look.+(%| says )/.test(DB.look),
  `${DB.lit} of ${DB.n} · ${DB.look}`,
);
// the walk check list: from the route card, to a station, to GPX and back
const CK = await pg.evaluate(async () => {
  const got = [],
    orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) got.push([this.download, this.href]);
  };
  const head = document.querySelector('#report .rhead'),
    folded = !document.querySelector('#report').classList.contains('open');
  if (folded) head.click();
  const chips = [...document.querySelectorAll('#report .rdoubt .n')].map(n => n.textContent).join('');
  document.querySelector('#report .rcheck').click();
  const rows = [...document.querySelectorAll('#checkBody .ck')].map(r => r.textContent);
  document.querySelector('#checkGpx').click();
  HTMLAnchorElement.prototype.click = orig;
  document.querySelectorAll('#checkBody .go')[1].click();
  if (folded) document.querySelector('#report .rhead').click();
  const [name, href] = got[0] || [],
    text = href ? await (await fetch(href)).text() : '',
    doc = new DOMParser().parseFromString(text, 'application/xml'),
    w = [...doc.getElementsByTagNameNS('http://www.topografix.com/GPX/1/1', 'wpt')],
    back = parseGPX(text);
  return {
    checks: STATE.checks.slice(),
    d: STATE.checks.map(i => Math.round(STATE.stations[i].d)),
    chips,
    rows,
    sel: STATE.sel,
    open: document.querySelector('#dlgCheck').open,
    name,
    bad: !!doc.querySelector('parsererror'),
    root: doc.documentElement.namespaceURI + ' ' + doc.documentElement.getAttribute('version'),
    names: w.map(x => x.querySelector('name')?.textContent),
    links: w.map(x => x.querySelector('link')?.getAttribute('href')),
    same:
      back.length === STATE.checks.length &&
      back.every((p, k) => {
        const s = STATE.stations[STATE.checks[k]];
        return Math.abs(p.lat - s.lat) < 1e-6 && Math.abs(p.lon - s.lon) < 1e-6;
      }),
  };
});
ok(
  'the check list: five spots 40 m or more apart, in walking order',
  CK.checks.length === 5 &&
    CK.d.every((d, k) => !k || d - CK.d[k - 1] >= 40) &&
    CK.chips === '12345' &&
    CK.rows.length === 5 &&
    CK.rows.every(r => /m along/.test(r)),
  CK.d.map((d, k) => `${k + 1}: #${CK.checks[k] + 1} ${d} m`).join(' · '),
);
ok('a check-list spot opens its station', !CK.open && CK.sel === CK.checks[1], `station ${CK.sel + 1}`);
ok(
  'the check list exports GPX 1.1 that reads back',
  !CK.bad &&
    CK.root === 'http://www.topografix.com/GPX/1/1 1.1' &&
    /\.gpx$/.test(CK.name) &&
    CK.names.length === 5 &&
    /^1 · /.test(CK.names[0]) &&
    CK.links.every(l => /^https:.*#m=path.*&at=\d+$/.test(l)) &&
    CK.same,
  `${CK.name}: ${CK.names.join(', ')}`,
);
await pg.evaluate(h => (location.hash = h), CK.links[3].slice(CK.links[3].indexOf('#')));
for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
await settle(pg, 120);
const AT = await pg.evaluate(() => ({ sel: STATE.sel, n: STATE.stations.length, hash: location.hash }));
ok(
  "a waypoint's link reopens the line at its spot",
  AT.n === 60 && AT.sel === CK.checks[3] && !/at=/.test(AT.hash),
  `station ${AT.sel + 1}`,
);
await pg.evaluate(() => selectStation(0));
ok(
  'the demo line crosses trails but follows none',
  L.n === 60 && L.stretches === 0,
  `${L.n} stations, ${L.stretches} followed stretches`,
);
await pg.screenshot({ path: OUT + '/path.png' });

// a trail: the Park Service's line for the Mist Trail follows the mapped Mist Trail
const gpx = fs.readFileSync(path.join(ROOT, 'tests/fixtures/trails/yose-mist-trail.gpx'), 'utf8');
const pts = [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => ({
  lat: +m[1],
  lon: +m[2],
}));
await pg.evaluate(pts => setVerts(pts, { mode: 'path' }), pts);
for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
s = await settle(pg, 120);
const T = await pg.evaluate(() => {
  const even = STATE.stations.map((st, i) => (st.x ? null : STATE.results[i].view.top)).filter(Boolean);
  return {
    stretches: STATE.stretches.map(x => `${x.name || x.what} ${Math.round(x.d1 - x.d0)} m`),
    path: even.filter(t => t === 'path').length / even.length,
  };
});
ok(
  'the Mist Trail line follows the Mist Trail',
  T.stretches.length === 1 && /^Mist Trail/.test(T.stretches[0]),
  T.stretches.join(', '),
);
ok('and reads as path along it', T.path >= 0.9, `path at ${Math.round(T.path * 100)}% of stations`);
ok(
  'a followed trail has nothing worth a look',
  await pg.evaluate(() => STATE.results.every(r => !r.doubt || r.doubt.score < 0.5)),
);
await pg.evaluate(() => selectStation(STATE.stations.findIndex(s => s.f && s.d > 300)));
await pg.waitForTimeout(300);
const U = await pg.evaluate(() => ({
  chips: [...document.querySelectorAll('#readout .chip.fol b')].map(b => b.textContent),
  head: document.querySelector('#tfollow').textContent,
}));
ok(
  'a followed station shows what it follows and how far it moved',
  U.chips.length === 2 && /^Mist Trail/.test(U.chips[0]) && /m onto it$/.test(U.chips[1]),
  U.chips.join(' | '),
);
ok('the transect header says what the line follows', /^follows Mist Trail/.test(U.head), U.head);
await pg.screenshot({ path: OUT + '/trail.png' });

// the switch: off reads every station where the line puts it, and says so in the link
const flip = async sel => {
  await pg.locator(sel).click();
  for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
  await settle(pg, 120);
  return pg.evaluate(() => ({
    n: STATE.stretches.length,
    f: /[#&]f=0/.test(location.hash),
    head: document.querySelector('#tfollow').textContent,
    off: document.querySelector('#folOff').getAttribute('aria-pressed'),
  }));
};
let F = await flip('#folOff');
ok(
  'Off: nothing followed, f=0 in the link',
  F.n === 0 && F.f && !F.head && F.off === 'true',
  JSON.stringify(F),
);
F = await flip('#folOn');
ok('On again: the Mist Trail is followed', F.n === 1 && !F.f && F.off === 'false', JSON.stringify(F));
// a footbridge over the Merced near Swinging Bridge, following off so the
// crossing itself is tested: the river is crossed on the deck
await pg.evaluate(() => {
  location.hash =
    '#m=path&s=auto&f=0&v=37.742815,-119.592530;37.742965,-119.592742;37.743287,-119.593198;37.743437,-119.593410';
});
for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
await settle(pg, 120);
const B = await pg.evaluate(() =>
  STATE.stations
    .map((st, i) => (st.x ? { cls: st.x.cls, over: st.x.over, call: STATE.results[i].view.top } : null))
    .filter(Boolean),
);
const deck = B.find(c => c.over === 'river');
ok(
  'a footbridge over the river reads as the bridge, not the water',
  deck && deck.call === 'path' && !B.some(c => c.cls === 'water'),
  JSON.stringify(B),
);
const bad = LOG.filter(l => /NO-CORS|^ERR/.test(l));
ok('no blocked or failed requests', bad.length === 0, bad.slice(0, 3).join(' | '));
await b.close();
done(errs);
