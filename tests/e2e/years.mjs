import { chromium } from 'playwright';
import { route, settle, APP, CHROMIUM, checks } from './harness.mjs';
/* Over the years: the time machine under the answer (app/years, ui/years). */
const { ok, done } = checks('years');
const errs = [];
const b = await chromium.launch({ executablePath: CHROMIUM });
const ready = (pg, key) =>
  pg
    .waitForFunction(
      k =>
        STATE.years && (!k || STATE.years.key === k) && ['done', 'none', 'err'].includes(STATE.years.status),
      key,
      { timeout: 120000 },
    )
    .then(() => true)
    .catch(() => false);

// ---------- desktop ----------
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
  const asked = [];
  pg.on('request', r => {
    const u = r.url();
    if (/maptiles\.arcgis\.com/.test(u)) asked.push(u);
  });
  await route(pg);
  /* Giga Texas: farmland cleared in 2020, the factory's roof by January 2022 */
  await pg.goto(APP + '#m=point&s=auto&z=17&v=30.2222,-97.617');
  await settle(pg, 120);
  const t0 = Date.now();
  ok(
    'a point reads its history',
    await ready(pg),
    `${((Date.now() - t0) / 1000).toFixed(1)} s after the answer settled`,
  );
  let H = await pg.evaluate(() => {
    const hs = STATE.years,
      box = document.querySelector('#years');
    return {
      shown: !box.hidden,
      hint: box.querySelector('.hint')?.textContent,
      bars: box.querySelectorAll('.histbars .yr').length,
      lines: box.querySelectorAll('.histbars .chg').length,
      flag: box.querySelector('.histflag')?.textContent,
      chips: box.querySelectorAll('.histstrip .cap:not(.today)').length,
      dates: hs.h.caps.map(c => c.date),
      asked: hs.asked,
    };
  });
  ok(
    'Over the years: nine captures 2010–2024, a bar and a picture each',
    H.shown && H.hint === '9 captures · 2010–2024' && H.bars === 9 && H.chips === 9,
    `${H.hint} · ${H.bars} bars · ${H.chips} pictures`,
  );
  ok(
    'the roof is flagged between the two captures either side of it',
    /^Changed between Nov 2020 and Jan 2022: bare ground → building, and it stayed building\. Imagery only/.test(
      H.flag,
    ) && H.lines === 1,
    H.flag,
  );
  const tilemaps = asked.filter(u => /\/tilemap\//.test(u)).length;
  ok(
    'only releases that changed the tile are read, each capture once, in date order',
    H.asked < 30 &&
      tilemaps <= H.asked &&
      new Set(H.dates).size === H.dates.length &&
      H.dates.every((d, i) => !i || H.dates[i - 1] < d),
    `${H.asked} of 197 releases asked · ${H.dates.length} distinct captures`,
  );
  /* a picture shows that capture on the map; Today brings today's back */
  await pg.evaluate(() =>
    [...document.querySelectorAll('#years .cap')].find(b => /2022-01/.test(b.textContent)).click(),
  );
  await pg.waitForTimeout(1500);
  const rel = await pg.evaluate(() => STATE.years.h.caps.find(c => c.date.startsWith('2022-01')).rel);
  let M = await pg.evaluate(() => ({
    src: MAP.src,
    badge: document.querySelector('#capBadge').hidden ? '' : document.querySelector('#capBadge').textContent,
    legend: document.querySelector('#fieldLegend').hidden,
    credit: document.querySelector('#attrib').textContent,
    pressed: document.querySelector('#years .cap[aria-pressed="true"]')?.textContent,
  }));
  ok(
    'a picture shows its capture on the map, dated, credited, with the field set aside',
    M.src === `wb:${rel}` &&
      /Captured Jan 2022/.test(M.badge) &&
      M.legend &&
      /Wayback/.test(M.credit) &&
      /2022-01/.test(M.pressed || '') &&
      asked.some(u => u.includes(`/tile/${rel}/`)),
    `${M.src} · ${M.badge}`,
  );
  await pg.evaluate(() => document.querySelector('#capBadge button').click());
  await pg.waitForTimeout(400);
  M = await pg.evaluate(() => ({
    src: MAP.src,
    badge: document.querySelector('#capBadge').hidden,
    legend: document.querySelector('#fieldLegend').hidden,
  }));
  ok('Today returns to today’s imagery and the field', M.src === 'sat' && M.badge && !M.legend, M.src);

  /* a new spot doesn't keep an old spot's capture on the map */
  await pg.evaluate(() => [...document.querySelectorAll('#years .cap')][2].click());
  const was = await pg.evaluate(() => MAP.src);
  await pg.evaluate(() => (location.hash = '#m=point&s=auto&z=16&v=39.09,-120.03'));
  await settle(pg, 120);
  await ready(pg, '39.09000,-120.03000');
  H = await pg.evaluate(() => ({
    src: MAP.src,
    flag: document.querySelector('#years .histflag')?.textContent,
    n: STATE.years.h?.caps.length,
  }));
  ok(
    'a new spot puts today’s imagery back; open water: no change, said plainly',
    /^wb:/.test(was) && H.src === 'sat' && /^No change found: water in all \d+ captures\./.test(H.flag || ''),
    `${was} → ${H.src} · ${H.flag}`,
  );

  /* on a line, the station in focus */
  await pg.goto(APP + '#m=path&s=auto&v=37.74856,-119.58683;37.7462,-119.5880;37.7445,-119.5900');
  await pg.reload();
  await settle(pg, 120);
  await pg.evaluate(() => selectStation(5));
  const want = await pg.evaluate(
    () => `${STATE.stations[5].lat.toFixed(5)},${STATE.stations[5].lon.toFixed(5)}`,
  );
  ok('on a line, the history is the selected station’s', await ready(pg, want), want);

  /* an area has no single spot */
  await pg.goto(APP + '#m=area&v=37.7455,-119.5905;37.7455,-119.5885;37.7440,-119.5885;37.7440,-119.5905');
  await pg.reload();
  await settle(pg, 150);
  ok('area mode leaves it out', await pg.evaluate(() => document.querySelector('#years').hidden));
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
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
  await route(pg);
  await pg.goto(APP + '#m=point&s=auto&z=17&v=30.2222,-97.617');
  await settle(pg, 120);
  await ready(pg);
  const P = await pg.evaluate(() => {
    const box = document.querySelector('#years'),
      strip = box.querySelector('.histstrip'),
      r = box.getBoundingClientRect(),
      caps = [...strip.querySelectorAll('.cap')].map(c => c.getBoundingClientRect());
    return {
      fits: box.scrollWidth <= box.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth,
      inside: caps.every(c => c.left >= r.left - 0.5 && c.right <= r.right + 0.5),
      rows: new Set(caps.map(c => Math.round(c.top))).size,
      tap: Math.min(...caps.map(c => Math.min(c.width, c.height))),
    };
  });
  ok(
    'on a phone the panel fits, its pictures wrap and are big enough to tap',
    P.fits && P.inside && P.rows >= 2 && P.tap >= 44,
    `${P.rows} rows, smallest ${Math.round(P.tap)} px`,
  );
  await ctx.close();
}
await b.close();
done(errs);
