/* Regenerate the README images in docs/assets from the offline build.
 *
 *   npm run build && node scripts/readme-assets.mjs
 *
 * Uses the e2e harness (cached network), so reruns are fast and give the same
 * pictures. Needs ffmpeg on the PATH for the animated hero. */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { route, launch, settle, APP, ROOT } from '../tests/e2e/harness.mjs';

const OUT = path.join(ROOT, 'docs/assets');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-assets-'));
fs.mkdirSync(OUT, { recursive: true });
const jpg = (src, dst, width, q = 82) =>
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    src,
    '-vf',
    `scale=${width}:-1:flags=lanczos`,
    '-q:v',
    String(Math.round((100 - q) / 4)),
    dst,
  ]);
const GALLERY = '#m=point&s=auto&v=37.748560,-119.586830'; // the Ansel Adams Gallery, Yosemite Village

async function page(vp, dsf, extra = {}) {
  const { b, ctx } = await launch(chromium, vp, dsf, extra);
  const pg = await ctx.newPage();
  await route(pg);
  return { b, pg };
}
const shot = async (pg, name, opts = {}) => {
  const p = path.join(TMP, name + '.png');
  await pg.screenshot({ path: p, ...opts });
  return p;
};

/* ---- desktop: path, point + GPS, ledger, and the animated hero ---------- */
{
  const { b, pg } = await page({ width: 1440, height: 880 }, 1);
  await pg.goto(APP);
  await pg.evaluate(() => {
    localStorage.clear();
    history.replaceState(null, '', location.pathname);
  });
  await pg.reload();
  await settle(pg, 120);

  // the animated hero: scrub along the demo line, pausing on the crossings
  const n = await pg.evaluate(() => STATE.stations.length);
  const cross = await pg.evaluate(() => STATE.stations.map((s, i) => (s.x ? i : -1)).filter(i => i >= 0));
  // warm pass: let every station's place name and field map arrive once, so the
  // capture pass shows settled answers rather than "still reporting"
  const picks = [];
  for (let i = 0; i < n; i += 2) {
    const stops = cross.filter(c => c >= i && c < i + 2);
    picks.push(...(stops.length ? stops.map(k => [k, true]) : [[i, false]]));
  }
  for (const [k] of picks) {
    await pg.evaluate(k => selectStation(k), k);
    await pg.waitForTimeout(1400);
  }
  const frames = [];
  let f = 0;
  for (const [k, isCross] of picks) {
    await pg.evaluate(k => selectStation(k), k);
    await pg.waitForTimeout(isCross ? 900 : 450);
    const p = path.join(TMP, `f${String(f++).padStart(3, '0')}.png`);
    await pg.screenshot({ path: p });
    frames.push([p, isCross ? 1.3 : 0.18]);
  }
  frames[frames.length - 1][1] = 1.6;
  const list =
    frames.map(([p, d]) => `file '${p}'\nduration ${d}`).join('\n') + `\nfile '${frames.at(-1)[0]}'\n`;
  fs.writeFileSync(path.join(TMP, 'frames.txt'), list);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(TMP, 'frames.txt'),
    '-vf',
    'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop',
    '0',
    path.join(OUT, 'hero.gif'),
  ]);

  // the trail crossing, for the path section
  const trail = await pg.evaluate(() =>
    STATE.stations.findIndex(
      (s, i) => s.x && STATE.results[i].q.best[s.x.cls]?.name?.includes('Valley Loop'),
    ),
  );
  await pg.evaluate(k => selectStation(k), trail >= 0 ? trail : Math.floor(n * 0.6));
  await pg.waitForTimeout(1500);
  jpg(await shot(pg, 'path'), path.join(OUT, 'path.jpg'), 1440);

  // the ledger with the line and imagery sources open, cropped to its own section of the console
  await pg.evaluate(() => {
    for (const id of ['prox', 'image']) UI.open.add(id);
    render();
  });
  await pg.waitForTimeout(400);
  const sect = pg.locator('#ledger').locator('xpath=ancestor::section[1]');
  await sect.scrollIntoViewIfNeeded();
  await pg.waitForTimeout(300);
  const lb = await sect.boundingBox();
  const vh = pg.viewportSize().height;
  const strip = await pg.locator('#stations').boundingBox(); // the station strip stays pinned over the console
  const top = Math.max(lb.y, strip ? strip.y + strip.height + 4 : 0);
  jpg(
    await shot(pg, 'ledger', {
      clip: {
        x: lb.x,
        y: top,
        width: lb.width,
        height: Math.min(lb.y + lb.height, vh) - top,
      },
    }),
    path.join(OUT, 'ledger.jpg'),
    440,
  );
  await pg.evaluate(() => {
    UI.open.clear();
    UI.open.add('image');
  });

  // a point with a ±5 m fix (a hash-only goto doesn't reload, so reload)
  await pg.goto(APP + GALLERY);
  await pg.reload();
  await settle(pg, 90);
  await pg.evaluate(() => {
    STATE.gps = 5;
    recompute();
    render();
    MAP.z = 19.2;
    mapDraw();
  });
  await pg.waitForTimeout(2500);
  jpg(await shot(pg, 'point'), path.join(OUT, 'point-gps.jpg'), 1440);
  await b.close();
}

/* ---- phone ---------------------------------------------------------------- */
{
  const { b, pg } = await page({ width: 390, height: 844 }, 2, { isMobile: true, hasTouch: true });
  await pg.goto(APP + GALLERY);
  await settle(pg, 90);
  await pg.waitForTimeout(1200);
  jpg(await shot(pg, 'm-point'), path.join(OUT, 'mobile-point.jpg'), 390 * 2);
  await pg.evaluate(() => {
    localStorage.clear();
    history.replaceState(null, '', location.pathname);
  });
  await pg.reload();
  await settle(pg, 120);
  await pg.waitForTimeout(1200);
  jpg(await shot(pg, 'm-path'), path.join(OUT, 'mobile-path.jpg'), 390 * 2);
  await pg.evaluate(() => setLocked(true, { quiet: true }));
  const mb = await pg.locator('#map').boundingBox();
  await pg.touchscreen.tap(mb.x + mb.width * 0.32, mb.y + mb.height * 0.72);
  await pg.waitForTimeout(800);
  jpg(await shot(pg, 'm-lock'), path.join(OUT, 'mobile-locked.jpg'), 390 * 2);
  await pg.evaluate(() => setLocked(false, { quiet: true }));
  await b.close();
}

fs.rmSync(TMP, { recursive: true, force: true });
for (const f of fs.readdirSync(OUT))
  console.log(f.padEnd(22), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0).padStart(6), 'KB');
