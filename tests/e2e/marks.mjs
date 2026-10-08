import { chromium } from 'playwright';
import { route, settle, launch, APP, OUT, checks } from './harness.mjs';
/* Marks: right / wrong / not sure on a station, kept in this browser, listed,
   edited, exported and deleted; never sent anywhere. */
const { ok, done } = checks('marks');
const errs = [];
const { b, ctx } = await launch(chromium, { width: 1400, height: 900 }, 1);
const pg = await ctx.newPage();
const sent = [];
pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
pg.on('request', r => sent.push(r.url() + ' ' + (r.postData() || '')));
await route(pg);
await pg.goto(APP);
await settle(pg, 150);
const ev = (fn, arg) => pg.evaluate(fn, arg);

// a wrong mark on the check list's third spot
const i = await ev(() => STATE.checks[2]);
await ev(i => selectStation(i), i);
await pg.locator('#verdict .mark .v.wrong').click();
const blocked = await ev(() => document.querySelector('#verdict .mark .btn.pri').disabled);
const call = await ev(i => STATE.results[i].view.top, i);
const truth = call === 'wetland' ? 'Scrub' : 'Wetland';
await pg.locator('#verdict .mark .cl', { hasText: truth }).click();
await pg.locator('#verdict .mark .chip', { hasText: 'standing here' }).click();
await pg.locator('#verdict .mark .btn.pri').click();
await pg.waitForTimeout(300);
let M = await ev(i => {
  const m = marks()[0];
  return {
    n: marks().length,
    m: m && {
      verdict: m.verdict,
      call: m.call,
      truth: m.truth,
      how: m.how,
      src: Object.keys(m.parts).length,
      at: m.link,
    },
    saved: document.querySelector('#verdict .mark .saved')?.textContent || '',
    at: markAt(STATE.stations[i])?.id === m?.id,
  };
}, i);
ok(
  "a wrong mark asks what's really there, then keeps it with the 8 readings",
  blocked &&
    M.n === 1 &&
    M.m.verdict === 'wrong' &&
    M.m.call === call &&
    M.m.truth === truth.toLowerCase() &&
    M.m.how === 'here' &&
    M.m.src === 8 &&
    /&at=\d+$/.test(M.m.at) &&
    /^✗Called .+, really /.test(M.saved) &&
    M.at,
  M.saved,
);
/* the map draws a red ✗ beside the station */
const px = await ev(i => {
  const s = STATE.stations[i],
    [x, y] = toScreen(s.lat, s.lon),
    c = document.querySelector('#map'),
    k = c.width / c.getBoundingClientRect().width,
    d = c.getContext('2d').getImageData(Math.round((x - 13 - 5) * k), Math.round((y - 13) * k), 1, 1).data;
  return [d[0], d[1], d[2]];
}, i);
ok('the map marks it ✗', px[0] > 180 && px[1] < 110 && px[2] < 110, px.join(','));

// a right mark from the check list
await ev(() => openCheckList());
const row = await ev(() =>
  [...document.querySelectorAll('#checkBody .ck')]
    .map(r => (r.querySelector('.mk .t') ? 'marked' : 'open'))
    .join(' '),
);
await pg.locator('#checkBody .ck').first().locator('.mk .v.right').click();
const E = await ev(() => ({
  open: document.querySelector('#dlgCheck').open,
  sel: STATE.sel,
  first: STATE.checks[0],
  on: document.querySelector('#verdict .mark .v.right.on') != null,
}));
await pg.locator('#verdict .mark .btn.pri').click();
await pg.waitForTimeout(300);
ok(
  'the check list marks a spot: right opens its mark under the answer',
  row === 'open open marked open open' &&
    !E.open &&
    E.sel === E.first &&
    E.on &&
    (await ev(() => marks().length)) === 2,
  row,
);

// marks survive a reload
await pg.reload();
await settle(pg, 150);
await ev(i => selectStation(i), i);
const R = await ev(() => ({
  n: marks().length,
  saved: document.querySelector('#verdict .mark .saved')?.textContent || '',
}));
ok('marks survive a reload', R.n === 2 && /really/.test(R.saved), R.saved);

// the Marks menu lists them; edit from there
await pg.locator('#btnMarks').click();
const L = await ev(() => ({
  rows: [...document.querySelectorAll('#marksMenu .mrow b')].map(b => b.textContent),
  sum: document.querySelector('#marksMenu .mfoot small')?.textContent,
}));
ok(
  'the Marks menu lists them, newest first',
  L.rows.length === 2 && /→/.test(L.rows[1]) && L.sum === '2 marks · 1 right, 1 wrong, 0 not sure',
  L.rows.join(' | '),
);
await ev(() => selectStation(0));
await pg.locator('#marksMenu .mrow').nth(1).locator('.lnk', { hasText: 'edit' }).click();
await pg.waitForTimeout(400);
const before = await ev(() => marks().find(m => m.verdict === 'wrong'));
await pg.locator('#verdict .mark .cl', { hasText: 'Bare ground' }).click();
await pg.locator('#verdict .mark .btn.pri').click();
await pg.waitForTimeout(300);
const after = await ev(() => marks().find(m => m.verdict === 'wrong'));
ok(
  'edit opens the mark at its station and saves the change in place',
  (await ev(() => STATE.sel)) === i &&
    after.truth === 'bare' &&
    after.id === before.id &&
    after.t === before.t &&
    after.edited > 0 &&
    (await ev(() => marks().length)) === 2,
  `${before.truth} → ${after.truth}`,
);

// export
const X = await ev(async () => {
  const got = [],
    orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) got.push([this.download, this.href]);
  };
  exportMarks('geojson');
  exportMarks('csv');
  HTMLAnchorElement.prototype.click = orig;
  const [g, c] = await Promise.all(got.map(async ([, h]) => (await fetch(h)).text()));
  const j = JSON.parse(g);
  return {
    names: got.map(x => x[0]).join(', '),
    feats: j.features.length,
    readings: Object.keys(j.features[0].properties.readings).length,
    link: j.features[0].properties.link,
    csv: c.trim().split('\n').length,
  };
});
ok(
  'marks export as GeoJSON with their readings, and as CSV',
  X.feats === 2 && X.readings === 8 && /^https:\/\/.+#m=path/.test(X.link) && X.csv === 3,
  X.names,
);

const ids = await ev(() => [...marks().map(m => m.id), 'verdict', 'truth']);
// delete takes two taps
await pg.locator('#btnMarks').click();
const del = pg.locator('#marksMenu .mrow').first().locator('.lnk', { hasText: 'delete' });
await del.click();
const once = await ev(() => marks().length);
await pg.locator('#marksMenu .mrow').first().locator('.lnk', { hasText: 'sure?' }).click();
await pg.waitForTimeout(300);
ok('delete asks once more, then deletes', once === 2 && (await ev(() => marks().length)) === 1);
/* every request the app made, data sources included: none carries a mark */
const leak = sent.filter(r => ids.some(id => r.includes(id)));
ok('no request carries a mark', leak.length === 0, `${sent.length} requests checked`);
await pg.screenshot({ path: OUT + '/marks.png' });

// refit: too few marks, then fourteen whose truth is what land cover says
await ev(() => openRefit());
const few = await ev(() => document.querySelector('#refitBody').textContent);
await ev(() => document.querySelector('#dlgRefit').close());
ok('with too few marks, refit says what it needs', /needs 10; you have [0-9]\./.test(few), few.slice(-40));
const k = await ev(() => STATE.checks[1]);
const p0 = await ev(k => Array.from(STATE.results[k].view.p), k);
const made = await ev(async () => {
  const pick = STATE.results
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r, i }) =>
        r &&
        r.parts &&
        !STATE.stations[i].x &&
        r.parts.cover?.status === 'ok' &&
        !Object.values(r.parts).some(p => p?.exact),
    )
    .slice(0, 14);
  for (const { r, i } of pick) {
    const ll = r.parts.cover.ll;
    let best = 0;
    for (let c = 1; c < ll.length; c++) if (ll[c] > ll[best]) best = c;
    const truth = K[best],
      s = STATE.stations[i];
    await saveMark({
      id: 'fit' + i,
      t: Date.now() - i,
      lat: s.lat,
      lon: s.lon,
      verdict: truth === r.view.top ? 'right' : 'wrong',
      call: r.view.top,
      p: r.view.topP,
      truth,
      how: 'here',
      parts: keepParts(r.parts),
      prior: STATE.priorName,
      place: null,
      link: location.hash + '&at=' + Math.round(s.d),
      station: i + 1,
      d: s.d,
      v: 'test',
    });
  }
  return pick.length;
});
await ev(() => closeMenus());
await pg.locator('#btnMarks').click();
await pg.locator('#marksMenu .btn', { hasText: 'Refit' }).click();
await pg.waitForSelector('#refitBody .acc', { timeout: 10000 });
const F = await ev(() => ({
  acc: [...document.querySelectorAll('#refitBody .acc b')].map(b => b.textContent),
  moved: [...document.querySelectorAll('#refitBody .wt')].map(r => r.textContent),
}));
await pg.locator('#refitFoot .btn', { hasText: 'Use my weights' }).click();
await pg.waitForTimeout(300);
const U = await ev(
  ([k, p0]) => ({
    cover: STATE.weights.cover,
    saved: !!localStorage.getItem('uf.fit'),
    who: document.querySelector('#ledger .who b')?.textContent,
    moved: Array.from(STATE.results[k].view.p).some((v, c) => v !== p0[c]),
  }),
  [k, p0],
);
ok(
  'refit: before and after on held-out marks; land cover gains weight',
  made === 14 &&
    F.acc.length === 2 &&
    / of 1[0-9]$/.test(F.acc[1]) &&
    U.cover > 0.75 &&
    U.saved &&
    U.moved &&
    /^yours · 1[0-9] marks$/.test(U.who),
  `${F.acc.join(' → ')} · ${F.moved.slice(0, 2).join(' · ')}`,
);
const reset = () => pg.locator('#ledger .who .lnk', { hasText: 'Reset' }).click();
await reset();
await pg.waitForTimeout(300);
const Z = await ev(
  ([k, p0]) => ({
    who: document.querySelector('#ledger .who b')?.textContent,
    exact: SOURCES.every(s => STATE.weights[s.id] === s.w) && STATE.neff === 3.5,
    gone: !localStorage.getItem('uf.fit'),
    diff: Math.max(...Array.from(STATE.results[k].view.p).map((v, c) => Math.abs(v - p0[c]))),
  }),
  [k, p0],
);
ok(
  'Reset restores the defaults exactly, and the answers with them',
  Z.who === 'defaults' && Z.exact && Z.gone && Z.diff === 0,
  `max |Δp| ${Z.diff}`,
);
await pg.locator('#btnMarks').click();
await pg.locator('#marksMenu .btn', { hasText: 'Refit' }).click();
await pg.waitForSelector('#refitBody .acc', { timeout: 10000 });
await pg.locator('#refitFoot .btn', { hasText: 'Use my weights' }).click();
await pg.reload();
await settle(pg, 150);
const P = await ev(() => ({
  who: document.querySelector('#ledger .who b')?.textContent,
  cover: STATE.weights.cover,
}));
await reset();
await pg.waitForTimeout(300);
const back = await ev(() => SOURCES.every(s => STATE.weights[s.id] === s.w) && STATE.neff === 3.5);
ok(
  'your weights are kept across a reload, and Reset still undoes them',
  /^yours/.test(P.who) && P.cover === U.cover && back,
  P.who,
);

// on a phone, the menu stays on screen
{
  const { b: b2, ctx: c2 } = await launch(chromium, { width: 390, height: 844 }, 2, {
    isMobile: true,
    hasTouch: true,
  });
  const ph = await c2.newPage();
  ph.on('pageerror', e => errs.push('PHONE ' + e.message));
  await route(ph);
  await ph.goto(APP);
  await settle(ph, 150);
  await ph.evaluate(() => startMark(STATE.sel, 'unsure'));
  await ph.locator('#verdict .mark .btn.pri').tap();
  await ph.waitForTimeout(300);
  await ph.locator('#btnMarks').tap();
  const r = await ph.evaluate(() => {
    const b = document.querySelector('#marksMenu').getBoundingClientRect();
    return {
      l: Math.round(b.left),
      r: Math.round(b.right),
      rows: document.querySelectorAll('#marksMenu .mrow').length,
    };
  });
  ok('on a phone the Marks menu stays on screen', r.rows === 1 && r.l >= 0 && r.r <= 390, `${r.l}–${r.r} px`);
  await b2.close();
}

await b.close();
done(errs);
