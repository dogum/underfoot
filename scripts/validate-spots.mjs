/* Places abroad: sound 36 points outside the lower 48 United States, six per
 * continent, each labelled by eye from imagery before Underfoot ran on it, and
 * count how often the call is right.
 *
 *   npm run build && npm run spots [-- <name fragment> ...]
 *
 * Places and labels are in tests/fixtures/spots/abroad.json; `truth` lists the
 * acceptable classes, the first being the best label. The labels describe the
 * ground in the imagery, so a call of snow also counts where today's weather
 * puts fresh snow on top of it (engine/today), and the report says so. Responses are cached in
 * tests/e2e/.netcache like the browser tests. Results go to
 * tests/e2e/out/spots.json and a Markdown table on stdout. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, APP, ROOT, OUT } from '../tests/e2e/harness.mjs';

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/spots/abroad.json'), 'utf8'));
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('--'));
const spots = FIX.spots.filter(
  s => !ONLY.length || ONLY.some(o => s.name.toLowerCase().includes(o.toLowerCase())),
);

const { b, ctx } = await launch(chromium, { width: 1440, height: 880 }, 1);
const pg = await ctx.newPage();
await route(pg);
await pg.goto(APP);
await pg.evaluate(() => localStorage.clear());
await settle(pg, 150);

const rows = [];
for (const s of spots) {
  await pg.evaluate(p => setVerts([p], { mode: 'point' }), { lat: s.lat, lon: s.lon });
  for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
  if (!(await settle(pg, 120))) console.warn(`  ${s.name}: did not fully settle; scoring what arrived`);
  const r = await pg.evaluate(() => {
    const r = STATE.results[0],
      v = r.view;
    return {
      order: v.order.slice(0, 3).map(i => [K[i], v.p[i]]),
      sources: v.ledger.filter(l => l.status === 'ok').map(l => l.id),
      /* fresh snow on top today, and whether a clear pass since saw it too */
      snowToday: !!r.parts?.today?.onTop,
      passSnow: r.sh.pass?.scl === 11,
    };
  });
  const [top, p] = r.order[0],
    row = {
      ...s,
      call: top,
      p,
      second: r.order[1][0],
      snowToday: r.snowToday,
      passSnow: r.passSnow,
      /* the ground is under today's snow: calling snow is right too */
      seasonal: top === 'snow' && r.snowToday && !s.truth.includes('snow'),
      right: s.truth.includes(top) || (top === 'snow' && r.snowToday),
      strict: top === s.truth[0],
      top2: s.truth.includes(top) || s.truth.includes(r.order[1][0]),
      sources: r.sources,
    };
  rows.push(row);
  console.log(
    `${row.right ? '✓' : '✗'} ${s.name}: ${top} ${(p * 100).toFixed(0)}%, then ${row.second} (truth ${s.truth.join(' | ')}; ${r.sources.length} sources)${row.seasonal ? ' · under fresh snow today' : ''}`,
  );
}
await b.close();

/* ---- report ------------------------------------------------------------------ */
fs.writeFileSync(path.join(OUT, 'spots.json'), JSON.stringify(rows, null, 1));
const n = f => rows.filter(f).length;
console.log('\n| Place | Region | Truth | Call | Then | Sources |');
console.log('|---|---|---|---|---|--:|');
for (const r of rows)
  console.log(
    `| ${r.name} | ${r.region} | ${r.truth.join(' \\| ')} | ${r.right ? '' : '✗ '}${r.call} ${(r.p * 100).toFixed(0)}%${r.seasonal ? ' (fresh snow today' + (r.passSnow ? ', the satellite saw it' : '') + ')' : ''} | ${r.second} | ${r.sources.length} |`,
  );
console.log(
  `\nRight ${n(r => r.right)} of ${rows.length} (${n(r => r.seasonal)} of them under fresh snow today) · strict ${n(r => r.strict)} · truth in the top two ${n(r => r.top2)}`,
);
const regions = [...new Set(rows.map(r => r.region))];
console.log(
  regions.map(g => `${g} ${n(r => r.region === g && r.right)}/${n(r => r.region === g)}`).join(' · '),
);
