// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The imagery classifier: patch statistics, the 20 features, and the
 * logistic-regression log-likelihoods. Must match calib/ exactly.
 */

/* -------------------------------------------------- imagery features */
/* Must match calib/fit2.py exactly: 24 px core + 48 px context at z18. */
import IMG_MODEL_JSON from '../../model/img_model.json';
/* multinomial logistic regression over 20 patch features; refit with calib/ */
export const IMG_MODEL = IMG_MODEL_JSON;
export function imgStats(d, W, cx, cy, half) {
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
  const med = a => a[n >> 1],
    pc = (a, q) => a[Math.min(n - 1, Math.floor(q * n))];
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
/* 20-vector for the window centred at pixel (cx,cy) of an RGBA raster */
export function imgFeatures(d, W, cx, cy) {
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
    ],
    core: c,
    ctx: x,
  };
}
/* calibrated log-likelihoods for the 9 classes the model knows */
export function imgLogLik(v) {
  const M = IMG_MODEL,
    z = v.map((x, i) => (x - M.mu[i]) / M.sd[i]);
  const lg = M.W.map((w, c) => w.reduce((s, wi, i) => s + wi * z[i], M.b[c]));
  const mx = Math.max(...lg),
    lse = mx + Math.log(lg.reduce((s, a) => s + Math.exp(a - mx), 0));
  const out = {};
  M.classes.forEach((c, i) => (out[c] = Math.max(-6, lg[i] - lse)));
  return out;
}
