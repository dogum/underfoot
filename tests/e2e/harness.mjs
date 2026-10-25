/* Browser-test harness.
 *
 * Every request the app makes goes through route(): responses are cached on
 * disk (tests/e2e/.netcache) so reruns are fast and deterministic, and the
 * public APIs aren't hammered. Two ways to reach the network:
 *   UNDERFOOT_NET=direct (default)  Playwright fetches it
 *   UNDERFOOT_NET=curl              shell out to curl (for sandboxes whose proxy
 *                                  accepts curl but not Chromium)
 * The app under test defaults to the offline build, dist-single/underfoot.html;
 * set UNDERFOOT_URL to test the dev server or the live site instead.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const APP = process.env.UNDERFOOT_URL || 'file://' + path.join(ROOT, 'dist-single/underfoot.html');
export const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
export const CHROMIUM =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const MODE = process.env.UNDERFOOT_NET || 'direct';
const ALLOW =
  /(openfreemap|arcgisonline|services2\.arcgis\.com|mrlc\.gov|nationalmap\.gov|open-meteo|nominatim\.openstreetmap|opentopomap|earth-search\.aws\.element84\.com|sentinel-cogs\.s3|ic\.imagery1\.arcgis\.com|maptiles\.arcgis\.com|elevation-tiles-prod|sdmdataaccess\.sc\.egov\.usda\.gov)/;
const DISK = path.join(HERE, '.netcache');
fs.mkdirSync(DISK, { recursive: true });
const key = k => path.join(DISK, crypto.createHash('sha1').update(k).digest('hex'));

let active = 0;
const q = [];
const MAXC = 8;
const slot = () =>
  new Promise(r => {
    if (active < MAXC) {
      active++;
      r();
    } else q.push(r);
  });
const release = () => {
  active--;
  const n = q.shift();
  if (n) {
    active++;
    n();
  }
};

function curl(url, method, body, ctype, range) {
  return new Promise(res => {
    const tmp = path.join(os.tmpdir(), 'r' + Math.random().toString(36).slice(2)),
      hdr = tmp + '.h';
    const args = [
      '-s',
      '--max-time',
      '40',
      '-D',
      hdr,
      '-o',
      tmp,
      '-w',
      '%{http_code}',
      '-H',
      'Origin: null',
      '-A',
      'Mozilla/5.0 (underfoot-test)',
    ];
    if (range) args.push('-H', 'Range: ' + range);
    if (method === 'POST') {
      args.push('-X', 'POST', '--data-binary', '@-');
      if (ctype) args.push('-H', 'Content-Type: ' + ctype);
    }
    args.push(url);
    const p = execFile('curl', args, { maxBuffer: 64 << 20 }, (err, out) => {
      let b = Buffer.alloc(0),
        raw = '';
      try {
        b = fs.readFileSync(tmp);
      } catch {}
      try {
        raw = fs.readFileSync(hdr, 'utf8');
      } catch {}
      try {
        fs.unlinkSync(tmp);
      } catch {}
      try {
        fs.unlinkSync(hdr);
      } catch {}
      const headers = {};
      for (const line of raw.split(/\r?\n/)) {
        const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
        if (m && !/^(transfer-encoding|content-encoding|content-length|connection)$/i.test(m[1]))
          headers[m[1].toLowerCase()] = m[2];
      }
      res({ status: +(out || '').trim() || 502, headers, body: b });
    });
    if (method === 'POST') p.stdin.end(body || '');
  });
}
async function direct(route) {
  const r = await route.fetch({ timeout: 40000 });
  const headers = { ...r.headers() };
  for (const h of ['transfer-encoding', 'content-encoding', 'content-length', 'connection'])
    delete headers[h];
  return { status: r.status(), headers, body: await r.body() };
}

export const LOG = [];
const BLIP = /EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/;
const GONE = /context disposed|has been closed|Target closed/i;
/** Route and cache the network; expose window.underfoot's members as globals for page.evaluate.
 *  globals: false leaves the page exactly as shipped: with the globals, a module
 *  that forgot an import still works in the tests (the name resolves to the global). */
export async function route(page, { offline = new Set(), globals = true } = {}) {
  if (globals)
    await page.addInitScript(() =>
      addEventListener('DOMContentLoaded', () => {
        if (window.underfoot) Object.assign(window, window.underfoot);
      }),
    );
  await page.route('**/*', async r => {
    const req = r.request(),
      url = req.url();
    if (
      url.startsWith('file:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('http://localhost') ||
      url.startsWith('http://127.0.0.1')
    )
      return r.continue();
    if (!ALLOW.test(url)) return r.abort();
    for (const h of offline)
      if (url.includes(h)) {
        LOG.push('OFFLINE ' + url.slice(0, 60));
        return r.abort();
      }
    /* a range request is its own response: the same file's header and tiles mustn't share an entry */
    const body = req.postData() || '',
      range = req.headers()['range'] || '',
      k = key(req.method() + url + body + (range ? ' ' + range : ''));
    try {
      const m = JSON.parse(fs.readFileSync(k + '.json', 'utf8'));
      return r
        .fulfill({ status: m.status, headers: m.headers, body: fs.readFileSync(k + '.bin') })
        .catch(() => {});
    } catch {}
    await slot();
    try {
      const get = () =>
        MODE === 'curl' ? curl(url, req.method(), body, req.headers()['content-type'], range) : direct(r);
      /* a server error, or a network blip on the way (a DNS lookup that fails, a reset), gets two more tries */
      let res;
      for (let i = 0; ; i++) {
        try {
          res = await get();
          if (res.status < 500 || i === 2) break;
        } catch (e) {
          if (i === 2 || !BLIP.test(e.message)) throw e;
        }
        await new Promise(z => setTimeout(z, 700 * (i + 1)));
      }
      if (res.status === 200 || (res.status === 206 && range)) {
        fs.writeFileSync(k + '.json', JSON.stringify({ status: res.status, headers: res.headers }));
        fs.writeFileSync(k + '.bin', res.body);
      }
      /* without CORS a browser can't read the answer: keep what the server sent, to tell a block page from an API */
      const cors = !!res.headers['access-control-allow-origin'],
        what = cors
          ? ''
          : ` NO-CORS ${res.headers['content-type'] || ''} "${res.body.toString('utf8', 0, 100).replace(/\s+/g, ' ')}"`;
      LOG.push(`${res.status} ${req.method()} ${url.slice(0, 90)}${what}`);
      await r.fulfill(res).catch(() => {});
    } catch (e) {
      /* a request still out when the test closed its page is the test's doing, not the network's */
      LOG.push(`${GONE.test(e.message) ? 'GONE' : 'ERR'} ${url.slice(0, 80)} ${e.message}`);
      await r.abort().catch(() => {});
    } finally {
      release();
    }
  });
}
/** fetch for Node through the same cache as the browser tests, so a headless run
 *  reads the very bytes the browser read (scripts/parity, --headless). A miss is
 *  asked with Origin: null, as underfoot.html from disk asks, so what it keeps
 *  carries the CORS headers a browser run will need from the cache later. */
export function useNetcache() {
  const net = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url).href,
      method = (init.method || 'GET').toUpperCase(),
      /* a form posts as its encoded text, which is what the browser's request carries */
      body = init.body == null ? '' : String(init.body),
      headers = new Headers(init.headers),
      range = headers.get('range') || '',
      k = key(method + url + body + (range ? ' ' + range : ''));
    if (!ALLOW.test(url)) throw new TypeError('blocked: ' + url.slice(0, 60));
    try {
      const m = JSON.parse(fs.readFileSync(k + '.json', 'utf8'));
      return new Response(fs.readFileSync(k + '.bin'), { status: m.status, headers: m.headers });
    } catch {}
    headers.set('origin', 'null');
    const r = await net(url, { ...init, headers }),
      buf = Buffer.from(await r.arrayBuffer()),
      kept = {};
    for (const [h, v] of r.headers)
      if (!/^(transfer-encoding|content-encoding|content-length|connection)$/i.test(h)) kept[h] = v;
    if (r.status === 200 || (r.status === 206 && range)) {
      fs.writeFileSync(k + '.json', JSON.stringify({ status: r.status, headers: kept }));
      fs.writeFileSync(k + '.bin', buf);
    }
    LOG.push(`${r.status} ${method} ${url.slice(0, 90)} (node)`);
    return new Response(buf, { status: r.status, headers: kept });
  };
}
export async function launch(chromium, vp = { width: 1500, height: 940 }, dsf = 2, extra = {}) {
  const b = await chromium.launch({
    executablePath: CHROMIUM,
    args: [
      '--disable-background-networking',
      '--no-first-run',
      '--disable-component-update',
      '--disable-sync',
    ],
  });
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dsf, ...extra });
  return { b, ctx };
}
/** Wait until every station has every source in and the field map has finished. */
export async function settle(page, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => ({
      n: STATE.stations.length,
      run: STATE.running,
      pend: STATE.results.reduce(
        (a, r) => a + (r && r.fused ? r.fused.ledger.filter(l => l.status === 'wait').length : 9),
        0,
      ),
      field: !!(
        STATE.field &&
        STATE.field.ready &&
        STATE.field.imgDone &&
        !STATE.field.stale &&
        (!STATE.field.cellsAsked || STATE.field.cellsDone)
      ),
    }));
    if (s.n && !s.run && s.pend === 0 && s.field) return { ...s, t: i + 1 };
  }
  return null;
}
/** Collect PASS/FAIL lines; exit non-zero on any failure. */
export function checks(name) {
  const R = [];
  return {
    ok: (n, c, info = '') => R.push(`${c ? 'PASS' : 'FAIL'}  ${n}${info ? '  · ' + info : ''}`),
    done(errs = []) {
      console.log(`\n── ${name}`);
      console.log(R.join('\n'));
      if (errs.length) console.log('page errors:\n' + errs.join('\n'));
      const fails = R.filter(r => r.startsWith('FAIL')).length + errs.length;
      console.log(fails ? `✗ ${fails} problem(s)` : `✓ all ${R.length} passed`);
      process.exitCode = fails ? 1 : 0;
    },
  };
}
