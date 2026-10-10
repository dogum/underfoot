/* Batch points at the roadmap's size: 500 points in 25 places, 12 in the US
 * and 13 abroad, 20 in each within about a kilometre, read as one batch.
 *
 *   npm run build && npm run batch            # through the browser tests' cache
 *   npm run build && npm run batch -- --live  # straight to every service, a fresh profile
 *
 * Counts the time, the groups, every request that failed or was refused (a
 * 429 is a rate limit) and every source that hadn't answered when its group
 * was kept. Points are in tests/fixtures/batch/five-hundred.csv. */
import { chromium } from 'playwright';
import path from 'node:path';
import { route, launch, settle, APP, ROOT } from '../tests/e2e/harness.mjs';

const LIVE = process.argv.includes('--live');
const { b, ctx } = await launch(chromium, { width: 1440, height: 880 }, 1);
const pg = await ctx.newPage();
const bad = [],
  hosts = new Map();
pg.on('requestfailed', r => bad.push(`failed ${r.failure()?.errorText} ${r.url().slice(0, 90)}`));
pg.on('response', r => {
  const u = new URL(r.url());
  if (u.protocol.startsWith('http')) hosts.set(u.host, (hosts.get(u.host) || 0) + 1);
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 90)}`);
});
if (LIVE)
  await pg.addInitScript(() =>
    addEventListener('DOMContentLoaded', () => window.underfoot && Object.assign(window, window.underfoot)),
  );
else await route(pg);
await pg.goto(APP + '#m=point&s=auto&v=37.74856,-119.58683');
await settle(pg, 90);
bad.length = 0;
hosts.clear();
await pg.setInputFiles('#fileIn', path.join(ROOT, 'tests/fixtures/batch/five-hundred.csv'));
await pg.waitForSelector('#dlgPoints[open]');
await pg.click('#ptsSep');
const t0 = Date.now();
let last = -1;
for (;;) {
  const s = await pg.evaluate(() => ({
    next: STATE.batch.next,
    groups: STATE.batch.groups.length,
    status: STATE.batch.status,
  }));
  if (s.next !== last) {
    last = s.next;
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s: ${s.next} of ${s.groups} groups`);
  }
  if (s.status !== 'reading' || Date.now() - t0 > 30 * 60e3) break;
  await pg.waitForTimeout(2000);
}
const B = await pg.evaluate(() => {
  const B = STATE.batch;
  return {
    n: B.pts.length,
    read: B.rows.filter(Boolean).length,
    groups: B.groups.length,
    missing: B.missing,
    missingBy: B.missingBy || {},
    status: B.status,
    ms: B.ms,
    rows: B.rows,
  };
});
await b.close();
const by = k => B.rows.reduce((m, r) => (r ? m.set(r[k], (m.get(r[k]) || 0) + 1) : m), new Map());
console.log(
  `\n${LIVE ? 'Live network' : 'Through the cache'}: ${B.read} of ${B.n} points read in ${(B.ms / 1000).toFixed(0)} s (${B.status}), ${B.groups} groups`,
);
console.log(
  `sources that hadn't answered: ${B.missing}${
    B.missing
      ? ' (' +
        Object.entries(B.missingBy)
          .map(([k, n]) => `${k} ${n}`)
          .join(', ') +
        ')'
      : ''
  } · requests that failed or were refused: ${bad.length}${bad.filter(x => x.startsWith('429')).length ? ` (${bad.filter(x => x.startsWith('429')).length} rate-limited)` : ''}`,
);
for (const x of bad.slice(0, 12)) console.log('  ' + x);
console.log(
  'requests by host: ' +
    [...hosts]
      .sort((a, b) => b[1] - a[1])
      .map(([h, n]) => `${h} ${n}`)
      .join(' · '),
);
console.log(
  'calls: ' +
    [...by('call')]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(' · '),
);
console.log(
  `median call probability ${(B.rows.map(r => r.p).sort((a, b) => a - b)[B.read >> 1] * 100).toFixed(0)}% · worth a look ${B.rows.filter(r => r.doubt >= 0.5).length}`,
);
