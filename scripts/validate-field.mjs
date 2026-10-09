/* Field maps against soundings: does a cell of the field map (the 2 m grid
 * the FIELD layer draws, and area mode will sum) say what a sounding at that
 * same spot says? Twenty field maps, ten random cells in each, 10–58 m from
 * the centre: 200 spots, each sounded on its own and compared by class.
 *
 *   npm run build && npm run field [-- <name fragment> ...]
 *
 * Responses are cached in tests/e2e/.netcache like the browser tests; the
 * first run sounds 220 points (the gazetteer keeps to a request a second).
 * Results go to tests/e2e/out/field.json and a summary on stdout. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, APP, OUT } from '../tests/e2e/harness.mjs';

const CENTRES = [
  ['Ansel Adams Gallery, Yosemite Village', 37.74856, -119.58683],
  ['Northside Drive, Yosemite Valley', 37.7462, -119.588],
  ["Cook's Meadow", 37.745046, -119.589358],
  ['Merced River by Sentinel Bridge', 37.7436, -119.5893],
  ['Valley Loop Trail, Yosemite', 37.7414, -119.5892],
  ['Yosemite Lodge', 37.7428, -119.5975],
  ['Camp 4 woods', 37.7413, -119.6022],
  ['Mirror Lake road', 37.7387, -119.562],
  ['Mist Trail', 37.72622, -119.5455],
  ['Four Mile Trail', 37.7296, -119.588],
  ['Bright Angel Trail', 36.0785, -112.1283],
  ['Hidden Lake Trail, Glacier', 48.6902, -113.7375],
  ['Black Forest, Germany', 48.547, 8.224],
  ['Flevoland polder, Netherlands', 52.55, 5.6],
  ['Hyde Park, London', 51.5073, -0.1657],
  ['Shibuya crossing, Tokyo', 35.6595, 139.7005],
  ['Masai Mara, Kenya', -1.5, 35.1],
  ['Pasture, Waikato, New Zealand', -37.85, 175.45],
  ['Boreal forest, Manitoba', 54.5, -98.0065],
  ['Central Nairobi', -1.2841, 36.8233],
];
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('--'));
const centres = CENTRES.filter(
  c => !ONLY.length || ONLY.some(o => c[0].toLowerCase().includes(o.toLowerCase())),
);

/* the same spots every run */
let seed = 20261008;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const { b, ctx } = await launch(chromium, { width: 1440, height: 880 }, 1);
const pg = await ctx.newPage();
await route(pg);
await pg.goto(APP);
await pg.evaluate(() => localStorage.clear());
await settle(pg, 150);
const sound = async p => {
  await pg.evaluate(p => setVerts([p], { mode: 'point' }), p);
  for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
  await settle(pg, 120);
  await pg
    .waitForFunction(() => STATE.field && STATE.field.ready && STATE.field.imgDone, null, { timeout: 20000 })
    .catch(() => {});
};

const rows = [];
for (const [name, lat, lon] of centres) {
  const spots = Array.from({ length: 10 }, () => {
    const r = 10 + rnd() * 48,
      a = rnd() * 2 * Math.PI;
    return { dx: r * Math.cos(a), dy: r * Math.sin(a), r };
  });
  await sound({ lat, lon });
  /* each spot's cell in this field map, and where the spot is */
  const cells = await pg.evaluate(spots => {
    const F = STATE.field.F,
      G = STATE.results[0].geo;
    return spots.map(s => {
      const p = fieldCellAt(F, s.dx, s.dy),
        [la, lo] = G.P.inv(s.dx, s.dy);
      const i = p.indexOf(Math.max(...p));
      return { lat: la, lon: lo, field: K[i], fp: p[i] };
    });
  }, spots);
  let agree = 0;
  for (const [k, c] of cells.entries()) {
    await sound({ lat: c.lat, lon: c.lon });
    const s = await pg.evaluate(() => {
      const v = STATE.results[0].view;
      return { top: v.top, p: v.topP };
    });
    const row = { centre: name, r: spots[k].r, ...c, sounded: s.top, sp: s.p, same: c.field === s.top };
    rows.push(row);
    agree += row.same;
  }
  console.log(`${agree}/10 ${name}`);
}
await b.close();

fs.writeFileSync(path.join(OUT, 'field.json'), JSON.stringify(rows, null, 1));
const share = f => {
  const r = rows.filter(f);
  return r.length
    ? `${r.filter(x => x.same).length}/${r.length} (${Math.round((100 * r.filter(x => x.same).length) / r.length)}%)`
    : '—';
};
console.log(`\nField cell and sounding agree: ${share(() => true)}`);
console.log(`  10–25 m from the centre: ${share(r => r.r < 25)}`);
console.log(`  25–40 m: ${share(r => r.r >= 25 && r.r < 40)}`);
console.log(`  40–58 m: ${share(r => r.r >= 40)}`);
const miss = {};
for (const r of rows.filter(x => !x.same))
  miss[`${r.field} → ${r.sounded}`] = (miss[`${r.field} → ${r.sounded}`] || 0) + 1;
console.log(
  '  the field said → the sounding said: ' +
    Object.entries(miss)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
);
