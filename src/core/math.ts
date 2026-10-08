/**
 * Numeric helpers over class vectors: centring, softmax, entropy, the normal CDF.
 */
import { CIX, K } from './classes';
import type { ClassVec } from './types';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fmt = (v: number | string, d = 1) => Number(v).toFixed(d);
export const LN2 = Math.LN2;

/** a fresh zero vector over the classes */
export const zeros = (): ClassVec => new Float64Array(K.length);
/** subtract the mean in place: log-likelihoods only matter up to a constant */
export function centre<T extends { length: number; [i: number]: number }>(v: T): T {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i];
  m /= v.length;
  for (let i = 0; i < v.length; i++) v[i] -= m;
  return v;
}
export function softmax(s: ArrayLike<number>): number[] {
  let mx = -Infinity;
  for (let i = 0; i < s.length; i++) if (s[i] > mx) mx = s[i];
  const e = Array.from(s, x => Math.exp(x - mx));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map(x => x / z);
}
export function entropyBits(p: ArrayLike<number>) {
  let h = 0;
  for (let i = 0; i < p.length; i++) if (p[i] > 1e-12) h -= p[i] * Math.log2(p[i]);
  return h;
}
/** a class vector from a sparse {class: value} object; unknown keys are ignored */
export function V(o: Record<string, number>): ClassVec {
  const v = zeros();
  for (const k in o) if (k in CIX) v[(CIX as Record<string, number>)[k]] = o[k];
  return v;
}
/** v += s · o, for a sparse {class: value} object */
export function add(v: ClassVec, o: Record<string, number>, s = 1): ClassVec {
  for (const k in o) if (k in CIX) v[(CIX as Record<string, number>)[k]] += o[k] * s;
  return v;
}

/** Abramowitz–Stegun 7.1.26, |error| < 1.5e-7 */
export const erf = (x: number) => {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return (
    s *
    (1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-x * x))
  );
};
/** standard normal CDF */
export const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
