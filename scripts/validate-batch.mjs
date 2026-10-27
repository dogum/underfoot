/* Batch points at the roadmap's size: 500 points in 25 places, 12 in the US
 * and 13 abroad, 20 in each within about a kilometre, read as one batch.
 *
 *   npm run build && npm run batch                         # through the browser tests' cache
 *   npm run build && npm run batch -- --live               # straight to every service, a fresh profile
 *   npm run build:headless && npm run batch -- --headless  # in Node (src/headless), either way
 *
 * Counts the time, the groups, every request that failed or was refused (a
 * 429 is a rate limit) and every source that hadn't answered when its group
 * was kept. In Node it then cancels a second batch partway through a group
 * and counts the requests asked after it stopped. Points are in
 * tests/fixtures/batch/five-hundred.csv; rows go to tests/e2e/out/batch.json. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { route, launch, settle, useNetcache, APP, ROOT, OUT } from '../tests/e2e/harness.mjs';

const LIVE = process.argv.includes('--live'),
  HEADLESS = process.argv.includes('--headless'),
  CSV = path.join(ROOT, 'tests/fixtures/batch/five-hundred.csv');
const bad = [],
  hosts = new Map();
const B = HEADLESS ? await readNode() : await readPage();

async function readPage() {
  const { b, ctx } = await launch(chromium, { width: 1440, height: 880 }, 1);
  const pg = await ctx.newPage();
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
  await pg.setInputFiles('#fileIn', CSV);
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
  const out = await pg.evaluate(() => {
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
  return out;
}

/* the same file's points read in Node, with every request counted as the page's are */
async function readNode() {
  const H = await import(path.join(ROOT, 'dist-headless/underfoot.mjs'));
  if (!LIVE) useNetcache();
  await H.useNode();
  const net = globalThis.fetch,
    asked = [];
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    hosts.set(u.host, (hosts.get(u.host) || 0) + 1);
    asked.push(Date.now());
    try {
      const r = await net(input, init);
      if (r.status >= 400) bad.push(`${r.status} ${u.href.slice(0, 90)}`);
      return r;
    } catch (e) {
      bad.push(`failed ${e.message} ${u.href.slice(0, 90)}`);
      throw e;
    }
  };
  const pts = fs
    .readFileSync(CSV, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map(l => {
      const [, lat, lon] = l.split(',');
      return { lat: +lat, lon: +lon };
    });
  const t0 = Date.now();
  const pr = await H.soundPoints({
    points: pts,
    group: (n, of) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s: ${n} of ${of} groups`),
  });
  /* cancelled partway through the third group of points 200 m north: what's asked once it has stopped */
  const north = pts.slice(0, 120).map(p => ({ lat: p.lat + 0.002, lon: p.lon })),
    stop = new AbortController();
  let third = -1;
  const watch = setInterval(() => third >= 0 && asked.length - third >= 10 && stop.abort(), 5);
  const cut = await H.soundPoints({
    points: north,
    signal: stop.signal,
    group: n => n === 2 && (third = asked.length),
  });
  clearInterval(watch);
  const stopped = Date.now(),
    before = asked.length;
  await new Promise(z => setTimeout(z, 5000));
  console.log(
    `cancelled in the third group: ${cut.read} of ${cut.groups} groups kept; ` +
      `${asked.length - before} requests asked in the 5 s after it stopped`,
  );
  const missing = Object.values(pr.missing).reduce((a, n) => a + n, 0);
  return {
    n: pts.length,
    read: pr.rows.filter(Boolean).length,
    groups: pr.groups,
    missing,
    missingBy: pr.missing,
    status: pr.read === pr.groups ? 'done' : 'paused',
    ms: pr.ms,
    rows: pr.rows,
    cancel: { kept: cut.read, groups: cut.groups, after: asked.length - before, at: stopped },
  };
}
fs.writeFileSync(path.join(OUT, 'batch.json'), JSON.stringify(B, null, 1));
const by = k => B.rows.reduce((m, r) => (r ? m.set(r[k], (m.get(r[k]) || 0) + 1) : m), new Map());
console.log(
  `\n${HEADLESS ? 'Node, ' : ''}${LIVE ? 'live network' : 'through the cache'}: ${B.read} of ${B.n} points read in ${(B.ms / 1000).toFixed(0)} s (${B.status}), ${B.groups} groups`,
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
