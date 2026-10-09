/**
 * The imagery classifier: patch statistics, the 23 features, and the
 * logistic-regression log-likelihoods. Must match calib/features.py exactly
 * (tests/unit/imagery.test.ts holds them to it): a 24 px core and a 48 px
 * context at z18.
 */
import type { ImgFeatures, ImgStats } from '../core/types';
import IMG_MODEL_JSON from '../../model/img_model.json';

/* multinomial logistic regression over 23 patch features; refit with calib/fit4.py */
export const IMG_MODEL = IMG_MODEL_JSON;

/** colour and texture statistics of the (2·half)² window centred at pixel (cx, cy) of an RGBA raster */
export function imgStats(d: ArrayLike<number>, W: number, cx: number, cy: number, half: number): ImgStats {
  const n = 2 * half * (2 * half),
    Ls = new Float32Array(n),
    Ss = new Float32Array(n),
    Gs = new Float32Array(n),
    Bs = new Float32Array(n),
    Rs = new Float32Array(n);
  const lum = new Float32Array(n);
  let k = 0,
    s = 0,
    s2 = 0,
    dark = 0;
  for (let y = cy - half; y < cy + half; y++)
    for (let x = cx - half; x < cx + half; x++) {
      const p = (y * W + x) * 4,
        r = d[p] / 255,
        g = d[p + 1] / 255,
        b = d[p + 2] / 255;
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b,
        tot = Math.max(r + g + b, 1e-4),
        mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      lum[k] = L;
      Ls[k] = L;
      Ss[k] = mx > 1e-4 ? (mx - mn) / mx : 0;
      Gs[k] = (2 * g - r - b) / tot;
      Bs[k] = (b - (r + g) / 2) / tot;
      Rs[k] = (r - (g + b) / 2) / tot;
      s += L;
      s2 += L * L;
      if (L < 0.1) dark++;
      k++;
    }
  const side = 2 * half;
  let ge = 0;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side - 1; x++) ge += Math.abs(lum[y * side + x + 1] - lum[y * side + x]);
  for (let y = 0; y < side - 1; y++)
    for (let x = 0; x < side; x++) ge += Math.abs(lum[(y + 1) * side + x] - lum[y * side + x]);
  const cnt = side * (side - 1) * 2,
    m = s / n,
    sd = Math.sqrt(Math.max(0, s2 / n - m * m));
  Ls.sort();
  Ss.sort();
  Gs.sort();
  Bs.sort();
  Rs.sort();
  const med = (a: Float32Array) => a[n >> 1],
    pc = (a: Float32Array, q: number) => a[Math.min(n - 1, Math.floor(q * n))];
  return {
    L: med(Ls),
    L10: pc(Ls, 0.1),
    L90: pc(Ls, 0.9),
    S: med(Ss),
    G: med(Gs),
    G10: pc(Gs, 0.1),
    G90: pc(Gs, 0.9),
    B: med(Bs),
    R: med(Rs),
    T: Math.log(sd + 0.004),
    E: Math.log(ge / cnt + 0.003),
    D: dark / n,
    sd,
    edge: ge / cnt,
  };
}

/**
 * The three shape features of the 48 px window centred at (cx, cy), for flat
 * roofs: square-edgedness (edge energy along the two strongest perpendicular
 * directions), flatness (share of the 24 px core near its median brightness)
 * and edge concentration (edge energy in the strongest 10% of pixels).
 */
export function imgShape(d: ArrayLike<number>, W: number, cx: number, cy: number): [number, number, number] {
  const side = 48,
    lum = new Float64Array(side * side);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const p = ((cy - 24 + y) * W + cx - 24 + x) * 4;
      lum[y * side + x] = 0.2126 * (d[p] / 255) + 0.7152 * (d[p + 1] / 255) + 0.0722 * (d[p + 2] / 255);
    }
  const bins = new Float64Array(18),
    mags = new Float64Array((side - 2) * (side - 2));
  let k = 0;
  for (let y = 1; y < side - 1; y++)
    for (let x = 1; x < side - 1; x++) {
      const gx = lum[y * side + x + 1] - lum[y * side + x - 1],
        gy = lum[(y + 1) * side + x] - lum[(y - 1) * side + x],
        m = Math.hypot(gx, gy);
      mags[k++] = m;
      if (m <= 0.02) continue;
      /* direction folded into [0, π) the way numpy's mod does it */
      let th = Math.atan2(gy, gx) % Math.PI;
      if (th < 0) th += Math.PI;
      bins[Math.floor((th / Math.PI) * 18) % 18] += m;
    }
  let inBins = 0,
    best = 0;
  for (let b = 0; b < 18; b++) inBins += bins[b];
  for (let b = 0; b < 18; b++) best = Math.max(best, bins[b] + bins[(b + 9) % 18]);
  const rect = inBins > 0 ? best / inBins : 2 / 18;

  const core = new Float64Array(24 * 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) core[y * 24 + x] = lum[(y + 12) * side + x + 12];
  const md = Float64Array.from(core).sort()[core.length >> 1];
  let near = 0;
  for (const v of core) if (Math.abs(v - md) < 0.04) near++;
  const flat = near / core.length;

  mags.sort();
  let all = 0,
    top = 0;
  const cut = mags.length - Math.floor(mags.length / 10);
  for (let i = 0; i < mags.length; i++) {
    all += mags[i];
    if (i >= cut) top += mags[i];
  }
  const sparse = all > 0 ? top / all : 0.1;
  return [rect, flat, sparse];
}

/** the 23-vector for the window centred at pixel (cx, cy) of an RGBA raster */
export function imgFeatures(d: ArrayLike<number>, W: number, cx: number, cy: number): ImgFeatures {
  const c = imgStats(d, W, cx, cy, 12),
    x = imgStats(d, W, cx, cy, 24);
  return {
    v: [
      c.L,
      c.L10,
      c.L90,
      c.S,
      c.G,
      c.G10,
      c.G90,
      c.B,
      c.R,
      c.T,
      c.E,
      c.D,
      x.L,
      x.G,
      x.T,
      x.E,
      x.B,
      c.G - x.G,
      c.L - x.L,
      c.T - x.T,
      ...imgShape(d, W, cx, cy),
    ],
    core: c,
    ctx: x,
  };
}

/** calibrated log-likelihoods for the 9 classes the model knows */
export function imgLogLik(v: number[]): Record<string, number> {
  const M = IMG_MODEL,
    z = v.map((x, i) => (x - M.mu[i]) / M.sd[i]);
  const lg = M.W.map((w, c) => w.reduce((s, wi, i) => s + wi * z[i], M.b[c]));
  const mx = Math.max(...lg),
    lse = mx + Math.log(lg.reduce((s, a) => s + Math.exp(a - mx), 0));
  const out: Record<string, number> = {};
  M.classes.forEach((c, i) => (out[c] = Math.max(-6, lg[i] - lse)));
  return out;
}
