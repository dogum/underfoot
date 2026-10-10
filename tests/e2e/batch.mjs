import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { route, settle, APP, ROOT, CHROMIUM, checks } from './harness.mjs';
/* Batch points: a file of separate points read in groups, least sure first, kept across a closed tab. */
const { ok, done } = checks('batch');
const errs = [];
const FIX = f => path.join(ROOT, 'tests/fixtures/batch', f);
const b = await chromium.launch({ executablePath: CHROMIUM });
const until = (pg, f, arg, ms = 180000) =>
  pg
    .waitForFunction(f, arg, { timeout: ms })
    .then(() => true)
    .catch(() => false);
const page = async (ctx, url = APP + '#m=point&s=auto&v=37.74856,-119.58683') => {
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
  await route(pg);
  await pg.goto(url);
  await settle(pg, 90);
  return pg;
};
const text = async dl => fs.readFileSync(await dl.path(), 'utf8');

// ---------- desktop ----------
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  let pg = await page(ctx);

  /* a CSV could be either: it asks, with a line as the main answer */
  await pg.setInputFiles('#fileIn', FIX('twelve.csv'));
  await pg.waitForSelector('#dlgPoints[open]', { timeout: 5000 }).catch(() => {});
  let D = await pg.evaluate(() => ({
    open: document.querySelector('#dlgPoints').open,
    sub: document.querySelector('#ptsSub').textContent,
    pri: document.querySelector('#dlgPoints .btn.pri')?.id,
  }));
  ok(
    'a CSV of points asks: a line, or separate points?',
    D.open && D.sub === '12 points in twelve.csv' && D.pri === 'ptsLine',
    D.sub,
  );
  await pg.click('#ptsSep');
  const t0 = Date.now();
  ok(
    'separate points are read, every one',
    await until(pg, () => STATE.batch?.status === 'done'),
    `${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  let T = await pg.evaluate(() => {
    const B = STATE.batch,
      rows = [...document.querySelectorAll('#batchCard tr[data-i]')];
    return {
      mode: STATE.mode,
      groups: B.groups.length,
      read: B.rows.filter(Boolean).length,
      missing: B.missing,
      ps: rows.map(r => B.rows[+r.dataset.i].p),
      first: rows[0]?.textContent,
      stat: document.querySelector('#batchCard .bstat').textContent,
      others: [...document.querySelectorAll('#panels > section')].filter(
        s => s.id !== 'batchCard' && s.offsetParent,
      ).length,
      gaz: STATE.results.some(r => r.sh.gazAsked),
    };
  });
  ok(
    'nearby points read together; the table least sure first; no other panel',
    T.mode === 'batch' &&
      T.read === 12 &&
      T.groups === 6 &&
      T.ps.length === 12 &&
      T.ps.every((p, i) => !i || T.ps[i - 1] <= p) &&
      T.others === 0 &&
      /^12 points · all read in/.test(T.stat),
    `${T.groups} groups · ${T.stat} · first: ${T.first}`,
  );
  ok(
    'no gazetteer for a batch, and every source answered',
    !T.gaz && T.missing === 0,
    `${T.missing} missing`,
  );

  /* exports: the file's own columns carried, in its order */
  let [dl] = await Promise.all([
    pg.waitForEvent('download'),
    pg.click('#batchCard .bacts .btn:nth-child(1)'),
  ]);
  const csv = (await text(dl)).trim().split('\n');
  [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#batchCard .bacts .btn:nth-child(2)')]);
  const gj = JSON.parse(await text(dl));
  ok(
    'CSV and GeoJSON out, names and columns carried, in the file’s order',
    csv[0] === 'name,notes,lat,lon,call,p,then,p_then,sources,doubt' &&
      csv.length === 13 &&
      /^Gallery,"village, by the store",37\.74856,-119\.58683,building,0\.\d{3},/.test(csv[1]) &&
      gj.features.length === 12 &&
      gj.features[7].properties.name === 'Lake Louise' &&
      gj.features[7].properties.call === 'water',
    `${csv.length - 1} rows · ${csv[1].slice(0, 70)}`,
  );

  /* a click near a point on the map finds its row */
  const xy = await pg.evaluate(() => {
    const B = STATE.batch,
      i = B.pts.findIndex(p => p.name === 'Lake Louise');
    fitTo([B.pts[i]]);
    return toScreen(B.pts[i].lat, B.pts[i].lon);
  });
  const box = await pg.locator('#map').boundingBox(),
    v0 = await pg.evaluate(() => JSON.stringify(STATE.verts));
  await pg.mouse.click(box.x + xy[0] + 3, box.y + xy[1] - 2);
  await pg.waitForTimeout(300);
  T = await pg.evaluate(() => ({
    focus: STATE.batch.focus != null && STATE.batch.pts[STATE.batch.focus].name,
    row: document.querySelector('#batchCard tr.on')?.textContent,
    verts: JSON.stringify(STATE.verts),
  }));
  ok(
    'a click near a point finds its row, and adds no probe',
    T.focus === 'Lake Louise' && /Lake Louise/.test(T.row || '') && T.verts === v0,
    T.row,
  );

  /* open a row: the full answer, place name and all; then back */
  await pg.evaluate(() =>
    [...document.querySelectorAll('#batchCard tr[data-i]')].find(r => /Gallery/.test(r.textContent)).click(),
  );
  await settle(pg, 90);
  T = await pg.evaluate(() => ({
    mode: STATE.mode,
    at: STATE.verts[0],
    gaz: STATE.results[0]?.sh.gazAsked,
    verdict: !!document.querySelector('#verdict').textContent,
    bar: !document.querySelector('#batchBar').hidden && document.querySelector('#batchBar').textContent,
  }));
  ok(
    'opening a row reads that point on its own, with the place name, and the batch waits',
    T.mode === 'point' &&
      Math.abs(T.at.lat - 37.74856) < 1e-6 &&
      T.gaz &&
      T.verdict &&
      /Back to the batch/.test(T.bar || ''),
    T.bar,
  );
  await pg.click('#batchBar .btn.pri');
  await pg.waitForTimeout(300);
  T = await pg.evaluate(() => ({
    mode: STATE.mode,
    rows: document.querySelectorAll('#batchCard tr[data-i]').length,
  }));
  ok('Back to the batch brings the table back', T.mode === 'batch' && T.rows === 12, `${T.rows} rows`);

  /* close the tab partway; a new one offers to resume, and keeps what was read */
  await pg.evaluate(() => discardBatch());
  await pg.setInputFiles('#fileIn', FIX('sixty.csv'));
  await pg.waitForSelector('#dlgPoints[open]', { timeout: 5000 }).catch(() => {});
  await pg.click('#ptsSep');
  await until(pg, () => STATE.batch && STATE.batch.next >= 1);
  const kept = await pg.evaluate(() => ({
    next: STATE.batch.next,
    groups: STATE.batch.groups.length,
    rows: JSON.stringify(STATE.batch.rows),
  }));
  await pg.close();
  pg = await page(ctx);
  T = await pg.evaluate(() => ({
    bar: !document.querySelector('#batchBar').hidden && document.querySelector('#batchBar').textContent,
    mode: STATE.mode,
  }));
  ok(
    'a tab closed partway: the next one offers the batch back',
    /Batch: \d+ of 60 read, kept from last time/.test(T.bar || '') && T.mode === 'point',
    `${T.bar} (closed after ${kept.next} of ${kept.groups} groups)`,
  );
  await pg.click('#batchBar .btn.pri');
  ok('Resume reads the rest', await until(pg, () => STATE.batch?.status === 'done'));
  T = await pg.evaluate(() => ({ read: STATE.batch.rows.filter(Boolean).length, rows: STATE.batch.rows }));
  const before = JSON.parse(kept.rows);
  ok(
    'and keeps what the closed tab read',
    T.read === 60 && before.every((r, i) => !r || JSON.stringify(r) === JSON.stringify(T.rows[i])),
    `${before.filter(Boolean).length} kept, 60 read`,
  );

  /* waypoints are points: separate points is the main answer; a track is a line, unasked */
  await pg.setInputFiles('#fileIn', FIX('waypoints.gpx'));
  await pg.waitForSelector('#dlgPoints[open]', { timeout: 5000 }).catch(() => {});
  D = await pg.evaluate(() => ({
    open: document.querySelector('#dlgPoints').open,
    pri: document.querySelector('#dlgPoints .btn.pri')?.id,
  }));
  await pg.evaluate(() => document.querySelector('#dlgPoints').close());
  fs.writeFileSync(
    FIX('../../e2e/out/track.gpx'),
    '<gpx><trk><trkseg><trkpt lat="37.74" lon="-119.58"/><trkpt lat="37.741" lon="-119.581"/></trkseg></trk></gpx>',
  );
  await pg.setInputFiles('#fileIn', FIX('../../e2e/out/track.gpx'));
  await pg.waitForTimeout(300);
  const L = await pg.evaluate(() => ({ open: document.querySelector('#dlgPoints').open, mode: STATE.mode }));
  ok(
    'GPX waypoints are asked with separate points first; a track is read as a line',
    D.open && D.pri === 'ptsSep' && !L.open && L.mode === 'path',
    `${D.pri} · ${L.mode}`,
  );

  /* over the limit: the first 1,000, and it says so */
  const many = [
    'lat,lon',
    ...Array.from(
      { length: 1005 },
      (_, k) =>
        `${(37.744 + (k % 40) * 1e-5).toFixed(6)},${(-119.587 + Math.floor(k / 40) * 1e-5).toFixed(6)}`,
    ),
  ];
  fs.writeFileSync(FIX('../../e2e/out/many.csv'), many.join('\n'));
  await pg.setInputFiles('#fileIn', FIX('../../e2e/out/many.csv'));
  await pg.waitForSelector('#dlgPoints[open]', { timeout: 5000 }).catch(() => {});
  const more = await pg.evaluate(() => document.querySelector('#ptsMore').textContent);
  await pg.click('#ptsSep');
  T = await pg.evaluate(() => ({
    n: STATE.batch.pts.length,
    dropped: STATE.batch.dropped,
    card: document.querySelector('#batchCard').textContent,
  }));
  await pg.evaluate(() => discardBatch());
  ok(
    'a file over 1,000 points: the first 1,000 are read, and both the question and the card say so',
    /first 1,000/.test(more) && T.n === 1000 && T.dropped === 5 && /5 more points/.test(T.card),
    more,
  );
  await ctx.close();
}

// ---------- phone ----------
{
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const pg = await page(ctx);
  await pg.setInputFiles('#fileIn', FIX('twelve.csv'));
  await pg.waitForSelector('#dlgPoints[open]', { timeout: 5000 }).catch(() => {});
  await pg.click('#ptsSep');
  await until(pg, () => STATE.batch?.status === 'done');
  const P = await pg.evaluate(() => {
    const card = document.querySelector('#batchCard'),
      tbl = card.querySelector('table');
    return {
      fits:
        card.scrollWidth <= card.clientWidth + 1 &&
        tbl.getBoundingClientRect().right <= innerWidth + 0.5 &&
        document.documentElement.scrollWidth <= innerWidth,
      rows: card.querySelectorAll('tr[data-i]').length,
      tap: Math.min(...[...card.querySelectorAll('tr[data-i]')].map(r => r.getBoundingClientRect().height)),
    };
  });
  ok(
    'on a phone the table fits the screen, every row there to tap',
    P.fits && P.rows === 12 && P.tap >= 30,
    `${P.rows} rows, ${Math.round(P.tap)} px each`,
  );
  await ctx.close();
}
await b.close();
done(errs);
