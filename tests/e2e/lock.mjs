import { chromium } from 'playwright';
import { route, settle, APP, OUT, CHROMIUM, checks } from './harness.mjs';
/* Lock: nothing a click, drag, key or touch does may change the probe or line. */
const { ok, done } = checks('lock');
const errs = [];
const b = await chromium.launch({ executablePath: CHROMIUM });
// ---------- desktop ----------
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
  await route(pg);
  await pg.goto(APP + '#m=path&s=auto&v=37.74856,-119.58683;37.7462,-119.5880;37.7445,-119.5900');
  await settle(pg, 90);
  const box = await pg.locator('#map').boundingBox();
  const V = () => pg.evaluate(() => JSON.stringify(STATE.verts));
  const v0 = await V();
  await pg.keyboard.press('k');
  let s = await pg.evaluate(() => ({
    locked: MAP.locked,
    stage: document.querySelector('#stage').classList.contains('locked'),
    btn: document.querySelector('#lockBtn').getAttribute('aria-pressed'),
    txt: document.querySelector('#lockTxt').textContent,
    hint: document.querySelector('#hint').textContent,
  }));
  ok(
    'K locks: button, map frame, hint',
    s.locked &&
      s.stage &&
      s.btn === 'true' &&
      s.txt === 'Locked' &&
      /Locked/.test(s.hint) &&
      /Unlock/.test(s.hint),
    s.hint,
  );
  await pg.mouse.click(box.x + 200, box.y + 150);
  await pg.waitForTimeout(150);
  ok('click on empty map does not extend the line', (await V()) === v0);
  const [vx, vy] = await pg.evaluate(() => toScreen(STATE.verts[1].lat, STATE.verts[1].lon));
  const c0 = await pg.evaluate(() => [MAP.lat, MAP.lon]);
  await pg.mouse.move(box.x + vx, box.y + vy);
  await pg.mouse.down();
  await pg.mouse.move(box.x + vx + 70, box.y + vy + 40, { steps: 6 });
  await pg.mouse.up();
  const c1 = await pg.evaluate(() => [MAP.lat, MAP.lon]);
  ok('dragging a vertex pans the map instead', (await V()) === v0 && (c1[0] !== c0[0] || c1[1] !== c0[1]));
  const [wx, wy] = await pg.evaluate(() => toScreen(STATE.verts[2].lat, STATE.verts[2].lon));
  await pg.mouse.click(box.x + wx, box.y + wy, { button: 'right' });
  await pg.waitForTimeout(100);
  ok('right-click does not delete a vertex', (await V()) === v0);
  await pg.keyboard.press('Backspace');
  await pg.keyboard.press('p');
  await pg.locator('#btnClear').click();
  await pg.waitForTimeout(150);
  s = await pg.evaluate(() => ({
    mode: STATE.mode,
    flash: document.querySelector('#lockGrp').classList.contains('flash'),
  }));
  ok('⌫, P and Clear are refused (lock flashes)', (await V()) === v0 && s.mode === 'path' && s.flash);
  const k = await pg.evaluate(() => Math.floor(STATE.stations.length / 2));
  const [sx, sy] = await pg.evaluate(k => toScreen(STATE.stations[k].lat, STATE.stations[k].lon), k);
  await pg.mouse.click(box.x + sx, box.y + sy);
  await pg.waitForTimeout(150);
  s = await pg.evaluate(() => STATE.sel);
  ok('clicking a station still selects it', s === k && (await V()) === v0, `sel ${s} (wanted ${k})`);
  await pg.reload();
  await pg.waitForTimeout(1500);
  ok('lock survives a reload', await pg.evaluate(() => MAP.locked && isLocked()));
  await pg.locator('#btnCoords').click();
  await pg.locator('#coordText').fill('37.7486,-119.5868');
  await pg.locator('#coordGo').click();
  await pg.waitForTimeout(300);
  s = await pg.evaluate(() => ({ mode: STATE.mode, n: STATE.verts.length, locked: MAP.locked }));
  ok(
    'pasted coordinates still load while locked',
    s.mode === 'point' && s.n === 1 && s.locked,
    JSON.stringify(s),
  );
  const p0 = await V();
  const [px, py] = await pg.evaluate(() => toScreen(STATE.verts[0].lat, STATE.verts[0].lon));
  await pg.mouse.click(box.x + px + 90, box.y + py + 60);
  await pg.mouse.move(box.x + px, box.y + py);
  await pg.mouse.down();
  await pg.mouse.move(box.x + px + 50, box.y + py + 30, { steps: 5 });
  await pg.mouse.up();
  ok('point mode: click and probe-drag leave the probe alone', (await V()) === p0);
  await pg.screenshot({ path: OUT + '/8_locked_desktop.png' });
  await pg.locator('#hint button[data-act=unlock]').click();
  await pg.waitForTimeout(100);
  await pg.mouse.click(box.x + px + 90, box.y + py + 60);
  await pg.waitForTimeout(150);
  ok('Unlock in the hint restores editing', !(await pg.evaluate(() => MAP.locked)) && (await V()) !== p0);
  await ctx.close();
}
// ---------- touch ----------
{
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await route(pg);
  await pg.goto(APP + '#m=path&s=auto&v=37.74856,-119.58683;37.7462,-119.5880;37.7445,-119.5900');
  await settle(pg, 90);
  const cdp = await ctx.newCDPSession(pg);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tap = async (x, y) => {
    await touch('touchStart', x, y);
    await pg.waitForTimeout(60);
    await touch('touchEnd');
    await pg.waitForTimeout(300);
  };
  const V = () => pg.evaluate(() => JSON.stringify(STATE.verts));
  const v0 = await V();
  await pg.locator('#lockBtn').tap();
  await pg.waitForTimeout(200);
  const mb = await pg.locator('#map').boundingBox();
  await tap(mb.x + mb.width * 0.3, mb.y + mb.height * 0.7);
  let s = await pg.evaluate(() => ({
    peek: !!MAP.peek,
    box: !document.querySelector('#cursorRead').classList.contains('hidden'),
    txt: document.querySelector('#cursorRead').textContent,
  }));
  ok(
    'touch: tap peeks at the field, line unchanged',
    (await V()) === v0 && s.peek && s.box,
    s.txt.replace(/\n/g, ' | '),
  );
  await pg.screenshot({ path: OUT + '/9_locked_mobile.png' });
  const [vx, vy] = await pg.evaluate(() => toScreen(STATE.verts[1].lat, STATE.verts[1].lon));
  await touch('touchStart', mb.x + vx, mb.y + vy);
  await pg.waitForTimeout(800);
  await touch('touchEnd');
  await pg.waitForTimeout(250);
  ok('touch: long-press on a vertex does not delete it', (await V()) === v0);
  // a station whose spot is open map (not under the tool chips)
  const pick = await pg.evaluate(() => {
    const r = document.querySelector('#map').getBoundingClientRect();
    for (let i = STATE.stations.length - 1; i >= 0; i--) {
      const [x, y] = toScreen(STATE.stations[i].lat, STATE.stations[i].lon);
      if (
        x > 20 &&
        y > 20 &&
        x < r.width - 20 &&
        y < r.height - 20 &&
        document.elementFromPoint(r.left + x, r.top + y)?.id === 'map' &&
        i !== STATE.sel
      )
        return [i, x, y];
    }
    return null;
  });
  await tap(mb.x + pick[1], mb.y + pick[2]);
  s = await pg.evaluate(() => ({ sel: STATE.sel, peek: !!MAP.peek }));
  s.want = pick[0];
  ok(
    'touch: tapping a station selects it and clears the peek',
    s.sel === s.want && !s.peek,
    JSON.stringify(s),
  );
  await pg.evaluate(() => localStorage.removeItem('snd.lock'));
  await ctx.close();
}
done(errs);
await b.close();
