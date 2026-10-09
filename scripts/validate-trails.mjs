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
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, APP, ROOT, OUT, CHROMIUM } from '../tests/e2e/harness.mjs';
import { followRun, length, osmTraces, plane, quant, readGpx, shift, simplify, sub } from './lib/trails.mjs';

const FIX = path.join(ROOT, 'tests/fixtures/trails');
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

/* ---- one line through the app ---------------------------------------------- */
async function sound(pg, pts) {
  await pg.evaluate(pts => setVerts(pts, { mode: 'path' }), pts);
  for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
  const ok = await settle(pg, 400);
  if (!ok) console.warn('  (did not fully settle; scoring what arrived)');
  return pg.evaluate(() => ({
    followed: STATE.stretches.reduce((a, s) => a + s.d1 - s.d0, 0) / (STATE.stations.at(-1)?.d || 1),
    /* go / slow / no-go on foot, as drawn and walked the other way (engine/mobility) */
    foot: (() => {
      const l = STATE.going?.line?.foot;
      if (!l) return null;
      const back = STATE.going.inputs.map(x => x && rateStation({ ...x, grade: -x.grade }, 'foot'));
      const down = rateLine(spanBounds(STATE.stations), back, 'foot');
      return { hours: l.hours, back: down.hours, smg: l.smg, blocked: l.blocked.map(b => b.why) };
    })(),
    stretches: STATE.stretches,
    stations: STATE.stations.map((s, i) => {
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
        // from where the station was before it moved onto a followed path
        dPath: s.f && s.f.cls === 'path' ? s.f.off : r.q && r.q.best.path ? r.q.best.path.d : null,
        // the readout names the mapped trail as the likely tread (see engine/narrate.ts)
        tread:
          !['building', 'paved', 'path', 'rail'].includes(v.top) &&
          !!(r.q && r.q.best.path) &&
          Phi((r.q.best.path.w - r.q.best.path.d) / GEOM_ERR) > 0.5 &&
          v.p[CIX.path] > 0.03,
        nlcd: r.sh && r.sh.nlcd ? r.sh.nlcd.code : null,
        follow: !!s.f,
        snap: s.f ? s.f.off : null,
      };
    }),
  }));
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
  const so = await sound(pg, t.pts);
  const sc = score(so.stations);
  rows.push({ ...t, pts: undefined, kind: 'nps', L, ...sc, ...so });
  console.log(
    `path ${(sc.exact * 100).toFixed(0)}%, top two ${(sc.top2 * 100).toFixed(0)}%, followed ${(so.followed * 100).toFixed(0)}%`,
  );
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
    const sc2 = score(s2.stations);
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
      ...s2,
    });
    console.log(
      `off the official line ${quant(run.off, 0.5).toFixed(1)} m median, ${quant(run.off, 0.9).toFixed(1)} m p90; path ${(sc2.exact * 100).toFixed(0)}%, followed ${(s2.followed * 100).toFixed(0)}%`,
    );
    await snap(`${t.slug}-hiker-${k + 1}`, view);
  }
}
/* ---- controls -------------------------------------------------------------------
 * Following has to fire along trails and stay quiet beside them:
 *   beside  each official line moved 25 m to one side: a transect that runs
 *           beside the trail, which should not follow it
 *   drawn   each official line cut down to the bends a person would click,
 *           within 4 m of the trail, which should still follow it
 *   demo    the demo line, which crosses trails and roads but follows none */
const controls = [];
if (!ONLY.length || ONLY.includes('controls')) {
  for (const t of trails) {
    for (const [kind, pts] of [
      ['beside', shift(t.pts, 25)],
      ['drawn', simplify(t.pts, 4)],
    ]) {
      process.stdout.write(`control ${kind} ${t.slug} (${pts.length} vertices) … `);
      const so = await sound(pg, pts);
      const sc = score(so.stations);
      controls.push({
        kind,
        slug: t.slug,
        verts: pts.length,
        followed: so.followed,
        path: sc.exact,
        n: sc.n,
        stretches: so.stretches,
      });
      console.log(`followed ${(so.followed * 100).toFixed(0)}%, path ${(sc.exact * 100).toFixed(0)}%`);
    }
  }
  process.stdout.write('control demo line … ');
  const so = await sound(pg, await pg.evaluate(() => DEMO));
  controls.push({
    kind: 'demo',
    slug: 'demo',
    verts: 5,
    followed: so.followed,
    path: score(so.stations).exact,
    stretches: so.stretches,
  });
  console.log(`followed ${(so.followed * 100).toFixed(0)}%`);
}
await b.close();

/* ---- report ------------------------------------------------------------------ */
fs.writeFileSync(path.join(OUT, 'trails.json'), JSON.stringify({ rows, controls }, null, 1));
const pct = v => (v * 100).toFixed(0) + '%';
const miss = m =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || '—';
const hm = h => (h == null ? '—' : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
console.log(
  '\n| Trail | Park | Length | Stations | Followed | Path | Top two | Path or tread named | OSM trail within 5 m | Called instead | On foot, as drawn / reversed |',
);
console.log('|---|---|--:|--:|--:|--:|--:|--:|--:|---|--:|');
for (const r of rows)
  console.log(
    `| ${r.name} | ${r.park.replace(' National Park', '')} | ${(r.L / 1000).toFixed(1)} km | ${r.n} | ${pct(r.followed)} | ${pct(r.exact)} | ${pct(r.top2)} | ${pct(r.named)} | ${pct(r.mapped)} | ${miss(r.misses)} | ${r.foot ? `${hm(r.foot.hours)} / ${hm(r.foot.back)}${r.foot.blocked.length ? ' (blocked: ' + r.foot.blocked.join(', ') + ')' : ''}` : '—'} |`,
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

if (controls.length) {
  console.log('\n| Control | Lines | Followed (share of length) | Path (share of stations) |');
  console.log('|---|--:|--:|--:|');
  for (const [kind, label] of [
    ['beside', 'Beside the trail, 25 m off'],
    ['drawn', 'Drawn by hand, within 4 m'],
    ['demo', 'The demo line'],
  ]) {
    const c = controls.filter(r => r.kind === kind),
      m = f => c.reduce((a, r) => a + f(r), 0) / c.length;
    console.log(`| ${label} | ${c.length} | ${pct(m(r => r.followed))} | ${pct(m(r => r.path))} |`);
  }
  for (const r of controls.filter(r => r.kind === 'beside' && r.followed > 0.05))
    console.log(`  beside ${r.slug}: followed ${pct(r.followed)}`);
  for (const r of controls.filter(r => r.kind === 'drawn' && r.followed < 0.9))
    console.log(`  drawn ${r.slug} (${r.verts} vertices): followed ${pct(r.followed)}`);
}
