import { chromium } from 'playwright';
import { route, launch, settle, LOG, APP, OUT, checks } from './harness.mjs';
/* End to end: a point and the demo line, every source live (or from the cache). */
const { ok, done } = checks('soundings: a point and a line');
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
await pg.screenshot({ path: OUT + '/point.png' });

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
await pg.screenshot({ path: OUT + '/path.png' });
const bad = LOG.filter(l => /NO-CORS|^ERR/.test(l));
ok('no blocked or failed requests', bad.length === 0, bad.slice(0, 3).join(' | '));
await b.close();
done(errs);
