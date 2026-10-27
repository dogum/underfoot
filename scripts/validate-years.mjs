/* The time machine against places whose history is known: six that changed
 * and five that didn't, each labelled by eye from its captures.
 *
 *   npm run build && npm run years [-- <name fragment> ...]
 *   npm run build:headless && npm run years -- --headless   (Node, no browser)
 *
 * A labelled change is found when a change is flagged between the same two
 * captures, or one capture either side; a flag that matches no labelled
 * change is a false one. Places and labels are in
 * tests/fixtures/years/places.json. Responses are cached in
 * tests/e2e/.netcache like the browser tests. Results go to
 * tests/e2e/out/years.json and a Markdown table on stdout. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, useNetcache, APP, ROOT, OUT } from '../tests/e2e/harness.mjs';

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/years/places.json'), 'utf8'));
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('--'));
const HEADLESS = process.argv.includes('--headless');
const places = FIX.places.filter(
  s => !ONLY.length || ONLY.some(o => s.name.toLowerCase().includes(o.toLowerCase())),
);

/* one place's history through the page, or through Node (src/headless) from the same cached responses */
let b, pg, H;
if (HEADLESS) {
  H = await import(path.join(ROOT, 'dist-headless/underfoot.mjs'));
  useNetcache();
  await H.useNode();
} else {
  const L = await launch(chromium, { width: 1440, height: 880 }, 1);
  b = L.b;
  pg = await L.ctx.newPage();
  await route(pg);
  await pg.goto(APP);
  await pg.evaluate(() => localStorage.clear());
  await settle(pg, 150);
}
/* the same summary of a history in the page and in Node */
function summary(status, asked, h, YEAR_CLASSES, yearsWords) {
  return {
    status,
    asked,
    dates: h ? h.caps.map(c => c.date.slice(0, 7)) : [],
    calls: h ? h.g.map(v => YEAR_CLASSES[v.indexOf(Math.max(...v))]) : [],
    flags: h ? h.flags.map(f => ({ i: f.i, from: f.from, to: f.to, p: f.p })) : [],
    words: h ? yearsWords(h) : '',
  };
}
async function readNode(s) {
  try {
    const got = await H.readHistory(s.lat, s.lon);
    return summary(got.h.caps.length ? 'done' : 'none', got.asked, got.h, H.YEAR_CLASSES, H.yearsWords);
  } catch {
    return summary('err', 0, null);
  }
}
async function readPage(s) {
  await pg.evaluate(p => setVerts([p], { mode: 'point' }), { lat: s.lat, lon: s.lon });
  for (let i = 0; i < 30 && !(await pg.evaluate(() => STATE.running)); i++) await pg.waitForTimeout(100);
  await settle(pg, 120);
  const key = `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`;
  await pg
    .waitForFunction(
      k => STATE.years && STATE.years.key === k && ['done', 'none', 'err'].includes(STATE.years.status),
      key,
      { timeout: 180000 },
    )
    .catch(() => {});
  return pg.evaluate(
    `(${summary})(STATE.years.status, STATE.years.asked, STATE.years.h, YEAR_CLASSES, yearsWords)`,
  );
}

const rows = [];
for (const s of places) {
  const h = HEADLESS ? await readNode(s) : await readPage(s);
  /* match each labelled change to a flag in the same interval first, then to one a capture either side */
  const used = new Set(),
    found = s.changes.map(c => ({
      ...c,
      ia: h.dates.indexOf(c.before),
      ib: h.dates.indexOf(c.after),
      at: 'missed',
    }));
  for (const near of [false, true])
    for (const c of found) {
      if (c.at !== 'missed' || c.ia < 0) continue;
      const k = h.flags.findIndex(
        (f, k) => !used.has(k) && (near ? Math.abs(f.i - c.ia) <= 1 : f.i === c.ia && c.ib === c.ia + 1),
      );
      if (k >= 0) {
        used.add(k);
        c.at = near ? 'near' : 'exact';
      }
    }
  const extra = h.flags.filter((f, k) => !used.has(k));
  const row = { ...s, ...h, found, extra };
  rows.push(row);
  console.log(
    `${s.name}: ${h.dates.length} captures, ${h.asked} tile maps · ` +
      (found.map(f => `${f.before}→${f.after} ${f.at}`).join(', ') || 'no labelled change') +
      (extra.length ? ` · ${extra.length} false` : ''),
  );
}
await b?.close();

/* ---- report ------------------------------------------------------------------ */
fs.writeFileSync(path.join(OUT, 'years.json'), JSON.stringify(rows, null, 1));
const pair = (r, i) => `${r.dates[i]} → ${r.dates[i + 1]}`;
console.log('\n| Place | Captures | Labelled change | Flagged | |');
console.log('|---|--:|---|---|---|');
for (const r of rows) {
  const lab = r.changes.map(c => `${c.before} → ${c.after}: ${c.from} → ${c.to}`).join('<br>') || 'none';
  const fl =
    r.flags.map(f => `${pair(r, f.i)}: ${f.from.join(' + ')} → ${f.to.join(' + ')}`).join('<br>') || 'none';
  const res = [
    ...r.found.map(f => (f.at === 'exact' ? 'found' : f.at === 'near' ? 'one capture off' : 'missed')),
    ...r.extra.map(() => 'false flag'),
  ];
  console.log(`| ${r.name} | ${r.dates.length} | ${lab} | ${fl} | ${res.join(', ') || 'quiet'} |`);
}
const all = rows.flatMap(r => r.found),
  n = f => all.filter(f).length,
  falseAt = rows.filter(r => r.extra.length);
console.log(
  `\nChanges found ${n(f => f.at !== 'missed')} of ${all.length} (in the right interval ${n(f => f.at === 'exact')}, one capture off ${n(f => f.at === 'near')}) · ` +
    `false flags ${rows.reduce((a, r) => a + r.extra.length, 0)} (on places that didn't change: ${rows.filter(r => !r.changes.length).reduce((a, r) => a + r.extra.length, 0)})` +
    ` · tile maps asked per place ${Math.min(...rows.map(r => r.asked))}–${Math.max(...rows.map(r => r.asked))} of 197` +
    (falseAt.length ? `\nFalse flags at: ${falseAt.map(r => r.name).join(', ')}` : ''),
);
