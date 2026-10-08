/* Helpers for scripts/validate-trails.mjs: geometry in a local plane, the
 * trail fixtures, and public OpenStreetMap GPS traces. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../tests/e2e/harness.mjs';

const CACHE = path.join(ROOT, 'tests/e2e/.netcache');

/* ---- small geometry, metres in a local plane ------------------------------ */
export const plane = o => {
  const kx = 111320 * Math.cos((o.lat * Math.PI) / 180),
    ky = 110540;
  const f = p => [(p.lon - o.lon) * kx, (p.lat - o.lat) * ky];
  f.inv = ([x, y]) => ({ lat: o.lat + y / ky, lon: o.lon + x / kx });
  return f;
};
/** the line moved m metres to its left */
export function shift(pts, m) {
  const P = plane(pts[0]),
    xy = pts.map(P);
  return xy.map((p, i) => {
    const a = xy[Math.max(0, i - 1)],
      b = xy[Math.min(xy.length - 1, i + 1)],
      h = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return P.inv([p[0] - (m * (b[1] - a[1])) / h, p[1] + (m * (b[0] - a[0])) / h]);
  });
}
/** the line cut down to the bends a person would click: Douglas–Peucker at tol metres */
export function simplify(pts, tol) {
  const P = plane(pts[0]),
    xy = pts.map(P),
    keep = new Set([0, xy.length - 1]);
  const dp = (i, j) => {
    let m = -1,
      k = -1;
    for (let q = i + 1; q < j; q++) {
      const [ax, ay] = xy[i],
        [bx, by] = xy[j],
        [px, py] = xy[q],
        L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9,
        t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2)),
        d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py);
      if (d > m) {
        m = d;
        k = q;
      }
    }
    if (m > tol) {
      keep.add(k);
      dp(i, k);
      dp(k, j);
    }
  };
  dp(0, xy.length - 1);
  return [...keep].sort((a, b) => a - b).map(i => pts[i]);
}
/** distance from p to the polyline, and how far along the polyline its foot is */
export function nearest(line, p, P) {
  const [x, y] = P(p);
  let best = { d: Infinity, s: 0 },
    s0 = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = P(line[i - 1]),
      [bx, by] = P(line[i]),
      dx = bx - ax,
      dy = by - ay,
      L2 = dx * dx + dy * dy || 1e-9,
      t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)),
      d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best.d) best = { d, s: s0 + t * Math.sqrt(L2) };
    s0 += Math.sqrt(L2);
  }
  return best;
}
export const length = (line, P) =>
  line.slice(1).reduce((a, p, i) => a + Math.hypot(...sub(P(p), P(line[i]))), 0);
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const quant = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

/* ---- inputs ---------------------------------------------------------------- */
export const tag = (s, t) => (new RegExp(`<${t}>([^<]*)</${t}>`).exec(s) || [])[1] || '';
export const unxml = s =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
export function readGpx(file) {
  const s = fs.readFileSync(file, 'utf8');
  const meta = (/<metadata>([\s\S]*?)<\/metadata>/.exec(s) || [])[1] || '';
  const pts = [...s.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => ({
    lat: +m[1],
    lon: +m[2],
  }));
  const [name, park] = unxml(tag(meta, 'name')).split(' · ');
  return { slug: path.basename(file, '.gpx'), name, park, surface: tag(s, 'type'), pts };
}
/** public OSM GPS traces inside a box, cached on disk like the app's own requests */
export async function osmTraces(bb) {
  const url = `https://api.openstreetmap.org/api/0.6/trackpoints?bbox=${bb.map(v => v.toFixed(5)).join(',')}&page=0`;
  const k = path.join(
    CACHE,
    crypto
      .createHash('sha1')
      .update('GET' + url)
      .digest('hex') + '.gpx',
  );
  let txt;
  try {
    txt = fs.readFileSync(k, 'utf8');
  } catch {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'underfoot-validation (github.com/dogum/underfoot)' },
    });
    if (!r.ok) throw new Error(`OSM trackpoints: HTTP ${r.status}`);
    txt = await r.text();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(k, txt);
  }
  const out = [];
  for (const [, trk] of txt.matchAll(/<trk>([\s\S]*?)<\/trk>/g)) {
    const ref = tag(trk, 'url');
    for (const [, seg] of trk.matchAll(/<trkseg>([\s\S]*?)<\/trkseg>/g)) {
      const pts = [...seg.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => ({
        lat: +m[1],
        lon: +m[2],
      }));
      if (pts.length >= 30) out.push({ ref: ref ? 'https://www.openstreetmap.org' + ref : '', pts });
    }
  }
  return out;
}
/** the stretch of a hiker's track that follows the trail: the longest run of
 *  fixes within 60 m of it, kept only if it covers most of the trail */
export function followRun(trail, track, P, L) {
  const near = track.pts.map(p => ({ p, ...nearest(trail, p, P) }));
  let best = [],
    cur = [];
  for (const n of near) {
    if (n.d < 60) cur.push(n);
    else cur = [];
    if (cur.length > best.length) best = [...cur];
  }
  // one pass, start to end: a hiker who went up and came back down the same
  // way would otherwise count twice. Fixes beyond either end are dropped.
  let i0 = 0,
    i1 = 0;
  best.forEach((n, i) => {
    if (n.s < best[i0].s) i0 = i;
    if (n.s > best[i1].s) i1 = i;
  });
  const run = (i0 <= i1 ? best.slice(i0, i1 + 1) : best.slice(i1, i0 + 1).reverse()).filter(
    n => n.s > 1 && n.s < L - 1,
  );
  if (run.length < 20 || run.at(-1).s - run[0].s < 0.7 * L) return null;
  return { ref: track.ref, pts: run.map(n => n.p), off: run.map(n => n.d) };
}
