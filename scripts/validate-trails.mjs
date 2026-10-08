/* Real trails: walk Underfoot along trails the National Park Service mapped,
 * and along GPS tracks hikers recorded on one of them, and count how often it
 * says "path".
 *
 *   npm run build && npm run trails [-- --shots] [-- <slug> ...]
 *
 * Trails come from tests/fixtures/trails/*.gpx (public domain, written by
 * scripts/fetch-trails.mjs). Hiker tracks are public OpenStreetMap GPS traces,
 * fetched at run time and cached in tests/e2e/.netcache; they are not
 * committed. Results go to tests/e2e/out/trails.json and a Markdown table on
 * stdout. --shots also writes the figures in docs/assets/.
 *
 * Crossing stations are left out of the scores: they're placed where the line
 * crosses a mapped path, so they say "path" by construction. */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, APP, ROOT, OUT, CHROMIUM } from '../tests/e2e/harness.mjs';

const FIX = path.join(ROOT, 'tests/fixtures/trails');
const CACHE = path.join(ROOT, 'tests/e2e/.netcache');
const args = process.argv.slice(2);
const SHOTS = args.includes('--shots');
const ONLY = args.filter(a => !a.startsWith('--'));
/** trails that also get checked against hikers' own GPS tracks, and the public
 *  OSM traces used in docs/validation.md (others are used if these drop out) */
const TRACES = {
  'yose-mist-trail': [
    '/user/okainov/traces/11350011',
    '/user/Alexandr%20Nikitin/traces/3864771',
    '/user/nono303/traces/2902426',
  ],
};
const WITH_TRACES = new Set(Object.keys(TRACES));

/* ---- small geometry, metres in a local plane ------------------------------ */
const plane = o => {
  const kx = 111320 * Math.cos((o.lat * Math.PI) / 180),
    ky = 110540;
  return p => [(p.lon - o.lon) * kx, (p.lat - o.lat) * ky];
};
/** distance from p to the polyline, and how far along the polyline its foot is */
function nearest(line, p, P) {
  const [x, y] = P(p);
  let best = { d: Infinity, s: 0 },
    s0 = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = P(line[i - 1]),
      [bx, by] = P(line[i]),
      dx = bx - ax,
      dy = by - ay,
      L2 = dx * dx + dy * dy || 1e-9,
      t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)),
      d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best.d) best = { d, s: s0 + t * Math.sqrt(L2) };
    s0 += Math.sqrt(L2);
  }
  return best;
}
const length = (line, P) => line.slice(1).reduce((a, p, i) => a + Math.hypot(...sub(P(p), P(line[i]))), 0);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const quant = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

/* ---- inputs ---------------------------------------------------------------- */
const tag = (s, t) => (new RegExp(`<${t}>([^<]*)</${t}>`).exec(s) || [])[1] || '';
const unxml = s =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
function readGpx(file) {
  const s = fs.readFileSync(file, 'utf8');
  const meta = (/<metadata>([\s\S]*?)<\/metadata>/.exec(s) || [])[1] || '';
  const pts = [...s.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => ({
    lat: +m[1],
    lon: +m[2],
  }));
  const [name, park] = unxml(tag(meta, 'name')).split(' · ');
  return { slug: path.basename(file, '.gpx'), name, park, surface: tag(s, 'type'), pts };
}
/** public OSM GPS traces inside a box, cached on disk like the app's own requests */
async function osmTraces(bb) {
  const url = `https://api.openstreetmap.org/api/0.6/trackpoints?bbox=${bb.map(v => v.toFixed(5)).join(',')}&page=0`;
  const k = path.join(
    CACHE,
    crypto
      .createHash('sha1')
      .update('GET' + url)
      .digest('hex') + '.gpx',
  );
  let txt;
  try {
    txt = fs.readFileSync(k, 'utf8');
  } catch {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'underfoot-validation (github.com/dogum/underfoot)' },
    });
    if (!r.ok) throw new Error(`OSM trackpoints: HTTP ${r.status}`);
    txt = await r.text();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(k, txt);
  }
  const out = [];
  for (const [, trk] of txt.matchAll(/<trk>([\s\S]*?)<\/trk>/g)) {
    const ref = tag(trk, 'url');
    for (const [, seg] of trk.matchAll(/<trkseg>([\s\S]*?)<\/trkseg>/g)) {
      const pts = [...seg.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => ({
        lat: +m[1],
        lon: +m[2],
      }));
      if (pts.length >= 30) out.push({ ref: ref ? 'https://www.openstreetmap.org' + ref : '', pts });
    }
  }
  return out;
}
/** the stretch of a hiker's track that follows the trail: the longest run of
 *  fixes within 60 m of it, kept only if it covers most of the trail */
function followRun(trail, track, P, L) {
  const near = track.pts.map(p => ({ p, ...nearest(trail, p, P) }));
  let best = [],
    cur = [];
  for (const n of near) {
    if (n.d < 60) cur.push(n);
    else cur = [];
    if (cur.length > best.length) best = [...cur];
  }
  // one pass, start to end: a hiker who went up and came back down the same
  // way would otherwise count twice. Fixes beyond either end are dropped.
  let i0 = 0,
    i1 = 0;
  best.forEach((n, i) => {
    if (n.s < best[i0].s) i0 = i;
    if (n.s > best[i1].s) i1 = i;
  });
  const run = (i0 <= i1 ? best.slice(i0, i1 + 1) : best.slice(i1, i0 + 1).reverse()).filter(
    n => n.s > 1 && n.s < L - 1,
  );
  if (run.length < 20 || run.at(-1).s - run[0].s < 0.7 * L) return null;
  return { ref: track.ref, pts: run.map(n => n.p), off: run.map(n => n.d) };
}

/* ---- one line through the app ---------------------------------------------- */
async function sound(pg, pts) {
  await pg.evaluate(pts => setVerts(pts, { mode: 'path' }), pts);
  for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
  const ok = await settle(pg, 400);
  if (!ok) console.warn('  (did not fully settle; scoring what arrived)');
  return pg.evaluate(() =>
    STATE.stations.map((s, i) => {
      const r = STATE.results[i],
        v = r && r.view;
      if (!v) return null;
      return {
        d: s.d,
        cross: s.x ? s.x.what : null,
        top: v.top,
        p: v.topP,
        pPath: v.p[CIX.path],
        second: K[v.order[1]],
        rankPath: v.order.indexOf(CIX.path),
        dPath: r.q && r.q.best.path ? r.q.best.path.d : null,
        // the readout names the mapped trail as the likely tread (see engine/narrate.ts)
        tread:
          !['building', 'paved', 'path', 'rail'].includes(v.top) &&
          !!(r.q && r.q.best.path) &&
          Phi((r.q.best.path.w - r.q.best.path.d) / GEOM_ERR) > 0.5 &&
          v.p[CIX.path] > 0.03,
        nlcd: r.sh && r.sh.nlcd ? r.sh.nlcd.code : null,
      };
    }),
  );
}
function score(stations) {
  const even = stations.filter(s => s && !s.cross),
    n = even.length;
  const misses = {};
  for (const s of even) if (s.top !== 'path') misses[s.top] = (misses[s.top] || 0) + 1;
  const near = even.map(s => s.dPath).filter(d => d != null);
  return {
    n,
    exact: even.filter(s => s.top === 'path').length / n,
    top2: even.filter(s => s.rankPath <= 1).length / n,
    medP: quant(
      even.map(s => s.pPath),
      0.5,
    ),
    mapped: even.filter(s => s.dPath != null && s.dPath <= 5).length / n,
    named: even.filter(s => s.top === 'path' || s.tread).length / n,
    medGap: quant(near, 0.5),
    misses,
    crossings: stations.filter(s => s && s.cross).length,
  };
}

/* ---- run --------------------------------------------------------------------- */
const trails = fs
  .readdirSync(FIX)
  .filter(f => f.endsWith('.gpx'))
  .map(f => readGpx(path.join(FIX, f)))
  .filter(t => !ONLY.length || ONLY.includes(t.slug));
const { b, ctx } = await launch(chromium, { width: 1440, height: 880 }, 1);
const pg = await ctx.newPage();
await route(pg);
await pg.goto(APP);
await pg.evaluate(() => localStorage.clear());
await settle(pg, 150);

const rows = [];
const shotDir = path.join(OUT, 'trails');
fs.mkdirSync(shotDir, { recursive: true });
const snap = async (name, view) => {
  if (!SHOTS) return;
  await pg.evaluate(view => {
    let i = STATE.stations.findIndex((s, j) => !s.x && STATE.results[j]?.view?.top !== 'path');
    if (view) {
      // a common close-up: the station nearest the centre, so its field map is in frame
      const d = s =>
        (s.lat - view.lat) ** 2 + ((s.lon - view.lon) * Math.cos((view.lat * Math.PI) / 180)) ** 2;
      i = STATE.stations.reduce((b, s, j) => (!s.x && d(s) < d(STATE.stations[b]) ? j : b), 0);
    }
    selectStation(i >= 0 ? i : 0);
    if (view) {
      Object.assign(MAP, view);
      mapDraw();
    }
  }, view);
  await pg.waitForTimeout(view ? 2500 : 1200);
  await pg.screenshot({ path: path.join(shotDir, name + '.png') });
  await pg.locator('#map').screenshot({ path: path.join(shotDir, name + '-map.png') });
  await pg.locator('#transect').screenshot({ path: path.join(shotDir, name + '-transect.png') });
};
/** a close-up 70% of the way along a line, the same for the trail and the tracks on it */
function closeUp(pts, P, L, z = 17.6) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(...sub(P(pts[i]), P(pts[i - 1])));
    if (acc >= 0.7 * L) return { lat: pts[i].lat, lon: pts[i].lon, z };
  }
  return { ...pts.at(-1), z };
}
for (const t of trails) {
  const P = plane(t.pts[0]),
    L = length(t.pts, P);
  process.stdout.write(`${t.slug} (${Math.round(L)} m) … `);
  const st = await sound(pg, t.pts);
  const sc = score(st);
  rows.push({ ...t, pts: undefined, kind: 'nps', L, ...sc, stations: st });
  console.log(`path ${(sc.exact * 100).toFixed(0)}%, top two ${(sc.top2 * 100).toFixed(0)}%`);
  const view = WITH_TRACES.has(t.slug) ? closeUp(t.pts, P, L) : undefined;
  await snap(t.slug, view);

  if (!WITH_TRACES.has(t.slug)) continue;
  const lat = t.pts.map(p => p.lat),
    lon = t.pts.map(p => p.lon),
    pad = 0.0015;
  const bb = [Math.min(...lon) - pad, Math.min(...lat) - pad, Math.max(...lon) + pad, Math.max(...lat) + pad];
  const pref = TRACES[t.slug],
    rank = r => {
      const i = pref.findIndex(u => r.ref.endsWith(u));
      return i < 0 ? pref.length : i;
    };
  const runs = (await osmTraces(bb))
    .map(tr => followRun(t.pts, tr, P, L))
    .filter(Boolean)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 3);
  for (const [k, run] of runs.entries()) {
    process.stdout.write(`  hiker track ${k + 1} (${run.pts.length} fixes) … `);
    const s2 = await sound(pg, run.pts);
    const sc2 = score(s2);
    rows.push({
      slug: `${t.slug}-hiker-${k + 1}`,
      name: `${t.name}, hiker track ${k + 1}`,
      park: t.park,
      surface: t.surface,
      kind: 'gps',
      ref: run.ref,
      L: length(run.pts, plane(run.pts[0])),
      offMed: quant(run.off, 0.5),
      offP90: quant(run.off, 0.9),
      ...sc2,
      stations: s2,
    });
    console.log(
      `off the official line ${quant(run.off, 0.5).toFixed(1)} m median, ${quant(run.off, 0.9).toFixed(1)} m p90; path ${(sc2.exact * 100).toFixed(0)}%`,
    );
    await snap(`${t.slug}-hiker-${k + 1}`, view);
  }
}
await b.close();

/* ---- report ------------------------------------------------------------------ */
fs.writeFileSync(path.join(OUT, 'trails.json'), JSON.stringify(rows, null, 1));
const pct = v => (v * 100).toFixed(0) + '%';
const miss = m =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || '—';
console.log(
  '\n| Trail | Park | Length | Stations | Path | Top two | Path or tread named | OSM trail within 5 m | Called instead |',
);
console.log('|---|---|--:|--:|--:|--:|--:|--:|---|');
for (const r of rows)
  console.log(
    `| ${r.name} | ${r.park.replace(' National Park', '')} | ${(r.L / 1000).toFixed(1)} km | ${r.n} | ${pct(r.exact)} | ${pct(r.top2)} | ${pct(r.named)} | ${pct(r.mapped)} | ${miss(r.misses)} |`,
  );
const nps = rows.filter(r => r.kind === 'nps'),
  N = nps.reduce((a, r) => a + r.n, 0),
  sum = f => nps.reduce((a, r) => a + f(r) * r.n, 0);
console.log(
  `\nOfficial lines: ${nps.length} trails, ${N} stations — path ${pct(sum(r => r.exact) / N)}, top two ${pct(sum(r => r.top2) / N)}, path or tread named ${pct(sum(r => r.named) / N)}.`,
);

/* ---- figures ---------------------------------------------------------------- */
if (SHOTS) {
  const jpg = (src, dst, w) =>
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      src,
      '-vf',
      `scale=${w}:-1:flags=lanczos`,
      '-q:v',
      '5',
      dst,
    ]);
  const dst = path.join(ROOT, 'docs/assets');
  const b2 = await chromium.launch({ executablePath: CHROMIUM });
  const p2 = await b2.newPage({ viewport: { width: 1128, height: 400 }, deviceScaleFactor: 1 });
  const compose = async (name, body, width) => {
    const html = path.join(shotDir, name + '.html'),
      png = path.join(shotDir, name + '.png');
    fs.writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#0d1117;color:#c9d1d9;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;padding:14px;width:1100px}
      figure{margin:0 0 12px}figcaption{display:flex;gap:8px;margin:0 0 4px;color:#8b949e}figcaption b{color:#e6edf3;font-weight:600}
      figcaption span{margin-left:auto;color:#f0a92e}img{display:block;width:100%;border:1px solid #21262d;border-radius:4px}
      .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pair img+img{margin-top:6px}
    </style>${body}`,
    );
    await p2.goto('file://' + html);
    await p2.screenshot({ path: png, fullPage: true });
    jpg(png, path.join(dst, name + '.jpg'), width);
    console.log(`wrote docs/assets/${name}.jpg`);
  };
  const img = (slug, part) => `<img src="file://${path.join(shotDir, `${slug}-${part}.png`)}">`;
  const head = r =>
    `<figcaption><b>${r.name}</b> · ${r.park.replace(' National Park', '')} · ${(r.L / 1000).toFixed(1)} km<span>path ${pct(r.exact)} · path or tread named ${pct(r.named)}</span></figcaption>`;

  // one transect per trail, stacked and labelled
  await compose(
    'trails-transects',
    nps.map(r => `<figure>${head(r)}${img(r.slug, 'transect')}</figure>`).join(''),
    960,
  );
  // the Mist Trail: the park's line beside a hiker's own GPS track
  const mist = rows.find(r => r.slug === 'yose-mist-trail'),
    hiker = rows.find(r => r.slug === 'yose-mist-trail-hiker-1');
  if (mist && hiker)
    await compose(
      'trails-mist-gps',
      `<div class="pair">${[mist, hiker]
        .map(
          r =>
            `<figure><figcaption><b>${r.kind === 'gps' ? 'A hiker’s GPS track' : 'The park’s mapped line'}</b>${r.kind === 'gps' ? ` · ${r.offMed.toFixed(0)} m median off the line` : ''}<span>tread named ${pct(r.named)}</span></figcaption>${img(r.slug, 'map')}${img(r.slug, 'transect')}</figure>`,
        )
        .join('')}</div>`,
      1100,
    );
  await b2.close();
}
