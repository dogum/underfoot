/* Parity: the browser and Node (src/headless) give the same answers. Runs the
 * places abroad, the trails, the time machine's places and the batch of 500
 * twice, in the page and in Node, from the same cached responses
 * (tests/e2e/.netcache), and compares every answer.
 *
 *   npm run build && npm run parity
 *
 * Fails if any call differs, or any probability by more than 1e-4. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT } from '../tests/e2e/harness.mjs';

const run = (script, headless) => {
  execFileSync('node', [path.join(ROOT, 'scripts', script), ...(headless ? ['--headless'] : [])], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};
const read = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
let bad = 0;

/* the 36 places: one point each */
run('validate-spots.mjs', false);
const pb = read('spots.json');
run('validate-spots.mjs', true);
const pn = read('spots.json');
let same = 0,
  dp = 0;
pb.forEach((b, i) => {
  const n = pn[i],
    d = Math.abs(b.p - n.p);
  dp = Math.max(dp, d);
  if (b.call === n.call && d < 1e-4 && b.sources.join() === n.sources.join()) same++;
  else console.log(`  ${b.name}: page ${b.call} ${b.p.toFixed(4)}, node ${n.call} ${n.p.toFixed(4)}`);
});
console.log(`Places abroad: ${same} of ${pb.length} the same; largest difference ${dp.toExponential(1)}`);
bad += pb.length - same;

/* the trails and hikers' tracks: every station of every line */
run('validate-trails.mjs', false);
const tb = read('trails.json');
run('validate-trails.mjs', true);
const tn = read('trails.json');
/* every list of stations in a report, with where it sits */
const lines = o =>
  (function walk(x, at, out) {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${at}[${i}]`, out));
    else if (x && typeof x === 'object') {
      if (Array.isArray(x.stations)) out.push([at, x.stations]);
      for (const [k, v] of Object.entries(x)) if (k !== 'stations') walk(v, `${at}.${k}`, out);
    }
    return out;
  })(o, '', []);
const lb = lines(tb),
  ln = lines(tn);
let st = 0,
  stSame = 0;
dp = 0;
lb.forEach(([at, b], i) => {
  const [at2, n] = ln[i] || [];
  if (at2 !== at || n.length !== b.length) {
    console.log(`  ${at}: ${b.length} stations in the page, ${n?.length ?? 0} in node`);
    bad++;
    return;
  }
  b.forEach((x, j) => {
    const y = n[j];
    if (!x || !y) return;
    st++;
    const d = Math.max(Math.abs(x.p - y.p), Math.abs(x.pPath - y.pPath));
    dp = Math.max(dp, d);
    if (x.top === y.top && d < 1e-4) stSame++;
    else console.log(`  ${at} #${j + 1}: page ${x.top} ${x.p.toFixed(4)}, node ${y.top} ${y.p.toFixed(4)}`);
  });
});
console.log(
  `Trails: ${stSame} of ${st} stations on ${lb.length} lines the same; largest difference ${dp.toExponential(1)}`,
);
bad += st - stSame;
/* the time machine's places: every capture, its smoothed call, and the changes flagged */
run('validate-years.mjs', false);
const yb = read('years.json');
run('validate-years.mjs', true);
const yn = read('years.json');
const story = y => JSON.stringify([y.asked, y.dates, y.calls, y.flags.map(f => [f.i, f.from, f.to])]);
let ySame = 0;
dp = 0;
yb.forEach((b, i) => {
  const n = yn[i];
  b.flags.forEach((f, k) => n.flags[k] && (dp = Math.max(dp, Math.abs(f.p - n.flags[k].p))));
  if (story(b) === story(n)) ySame++;
  else
    console.log(
      `  ${b.name}: page ${b.dates.length} captures, ${b.flags.length} flags; node ${n.dates.length}, ${n.flags.length}`,
    );
});
console.log(
  `Time machine: ${ySame} of ${yb.length} places the same; largest difference ${dp.toExponential(1)}`,
);
bad += yb.length - ySame + (dp > 1e-4 ? 1 : 0);

/* the batch of 500: every point's row */
run('validate-batch.mjs', false);
const bb = read('batch.json');
run('validate-batch.mjs', true);
const bn = read('batch.json');
let bSame = 0;
dp = 0;
bb.rows.forEach((b, i) => {
  const n = bn.rows[i];
  if (!b || !n) return;
  const d = Math.max(Math.abs(b.p - n.p), Math.abs(b.doubt - n.doubt));
  dp = Math.max(dp, d);
  if (b.call === n.call && b.then === n.then && d < 1e-4) bSame++;
  else console.log(`  point ${i + 1}: page ${b.call} ${b.p.toFixed(4)}, node ${n.call} ${n.p.toFixed(4)}`);
});
console.log(
  `Batch: ${bSame} of ${bb.rows.length} points the same; largest difference ${dp.toExponential(1)}`,
);
bad += bb.rows.length - bSame;

if (bad) {
  console.error(`✗ ${bad} answers differ`);
  process.exit(1);
}
console.log('✓ the page and Node agree');
