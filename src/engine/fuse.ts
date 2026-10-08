/**
 * Fusion: turn per-source evidence into a posterior. Sub-pixel floor, the
 * correlation discount τ, crossing stations as exact terms, the ε mixture,
 * and the ledger of who said what. Pure.
 */
import { CIX, K, PRIOR, SOURCES } from '../core/classes';
import { LN2, centre, clamp, entropyBits, softmax, zeros } from '../core/math';
import {
  srcCanopy,
  srcContain,
  srcCover,
  srcGaz,
  srcImage,
  srcProx,
  srcStruct,
  srcTerrain,
} from './evidence';
import type {
  ClassKey,
  ClassVec,
  ExactTerm,
  Fused,
  FuseOptions,
  GeoQuery,
  LedgerRow,
  Parts,
  PosteriorExtras,
  SourceId,
  SourcePart,
  StationFacts,
} from '../core/types';

/* ---- sub-resolution floor --------------------------------------------------
 * A trail through woods is inside the wood polygon, under the canopy and
 * inside a "deciduous forest" pixel, so every area-scale source votes against
 * it — at a scale it cannot resolve. Area-scale sources may support a narrow
 * class but not refute it: their negative evidence is floored below their own
 * favourite. Two gates keep that honest:
 *   - only for a class something has actually seen nearby (or where the map is
 *     too thin for absence to mean anything, at a fraction of the strength);
 *   - never when the source's verdict physically cannot host a tread (water,
 *     ice) — "you are in a reservoir" is authoritative at any resolution.
 * ------------------------------------------------------------------------ */
export const SUBPIX_FLOOR: Partial<Record<ClassKey, number>> = {
  path: 0.6,
  rail: 0.6,
  paved: 1.4,
  building: 1.8,
  water: 0.8,
};
export const CANDIDATE_R: Partial<Record<ClassKey, number>> = {
  path: 12,
  rail: 14,
  paved: 18,
  building: 25,
  water: 6,
}; // water: a mapped stream right here, not a lake
export const CANNOT_HOST = new Set<ClassKey>(['water', 'snow']);
export function plausibleTreads(q: GeoQuery | null | undefined): Map<ClassKey, number> {
  const out = new Map<ClassKey, number>();
  if (!q) return out;
  const sparse = q.density < 5;
  for (const k of Object.keys(SUBPIX_FLOOR) as ClassKey[]) {
    const seen =
      k === 'building'
        ? q.bD < CANDIDATE_R.building! || q.stD < CANDIDATE_R.building! || !!q.stIn
        : !!(q.best[k] && q.best[k]!.d < CANDIDATE_R[k]!);
    if (seen) out.set(k, 1);
    else if (sparse) out.set(k, 0.4);
  }
  if (q.crossing) out.set(q.crossing, Infinity); // at a defined crossing, area sources abstain on that class
  return out;
}
export function applyFloor(ll: ClassVec, plaus: Map<ClassKey, number>): ClassVec {
  if (!plaus.size) return ll;
  let mx = -Infinity,
    arg = 0;
  for (let i = 0; i < ll.length; i++)
    if (ll[i] > mx) {
      mx = ll[i];
      arg = i;
    }
  if (CANNOT_HOST.has(K[arg])) return ll;
  const o = Float64Array.from(ll);
  for (const [k, str] of plaus) {
    const i = CIX[k],
      lo = str === Infinity ? mx : mx - SUBPIX_FLOOR[k]! / str;
    if (o[i] < lo) o[i] = lo;
  }
  return centre(o);
}

/* ---- the eight sources for one location ----
 * sh: station-level facts (rasters, terrain, gazetteer, service states)
 * q : geometry at the location (geoAt), feat: imagery feature vector */
export const AREA = new Set<SourceId>(SOURCES.filter(s => s.scale === 'area').map(s => s.id));
export function computeParts(sh: StationFacts, q: GeoQuery | null | undefined, feat: unknown): Parts {
  const plaus = plausibleTreads(q);
  const raw = {
    contain: srcContain(sh, q),
    prox: srcProx(sh, q),
    struct: srcStruct(sh, q),
    image: srcImage(sh, feat),
    cover: srcCover(sh),
    canopy: srcCanopy(sh),
    terrain: srcTerrain(sh),
    gaz: srcGaz(sh),
  } as Record<SourceId, SourcePart>;
  for (const id of Object.keys(raw) as SourceId[]) {
    const r = raw[id];
    if (r.status === 'ok' && AREA.has(id) && id !== 'terrain') r.ll = applyFloor(r.ll, plaus);
  }
  return raw;
}

/* ---- correlation discount, done as an effective sample size -------------
 * The sources overlap — OSM, the three NLCD rasters and the photo all partly
 * see the same trees. Rather than a fixed divisor, the summed evidence is
 * divided by τ = (total active weight) / N_eff: eight overlapping voices count
 * as about 3.5 independent ones. When half the sources drop out (outside the
 * US) τ falls on its own, instead of over-discounting what is left. */
export const DEFAULT_NEFF = 3.5;
export const EPSILON = 0.02; // irreducible error: any source can simply be wrong, so nothing reads 100%
export function fuseParts(parts: Parts, opt: FuseOptions & { lite: true }): { p: number[] };
export function fuseParts(parts: Parts, opt: FuseOptions): Fused;
export function fuseParts(parts: Parts, opt: FuseOptions): Fused | { p: number[] } {
  const W = opt.weights,
    prior = opt.prior || PRIOR;
  let wsum = 0;
  for (const s of SOURCES) {
    const r = parts[s.id];
    if (r && r.status === 'ok') wsum += (W[s.id] ?? s.w) * (r.wmul || 1);
  }
  const tau = Math.max(1, wsum / (opt.neff || DEFAULT_NEFF));
  const s = zeros();
  for (const k of K) s[CIX[k]] = Math.log(prior[k]);
  let exact: ExactTerm | null = null;
  for (const src of SOURCES) {
    const r = parts[src.id];
    if (!r || r.status !== 'ok') continue;
    const w = (W[src.id] ?? src.w) * (r.wmul || 1);
    for (let i = 0; i < s.length; i++) s[i] += (w * clamp(r.ll[i], -8, 8)) / tau;
    if (r.exact) exact = r.exact;
  }
  /* a defined crossing is a geometric fact, not one more correlated vote:
     it sets the crossed class's odds directly, outside the discount */
  if (exact) {
    const i = CIX[exact.cls];
    let mx = -Infinity;
    for (let j = 0; j < s.length; j++) if (j !== i && s[j] > mx) mx = s[j];
    let z = 0;
    for (let j = 0; j < s.length; j++) if (j !== i) z += Math.exp(s[j] - mx);
    s[i] = Math.log(exact.p / (1 - exact.p)) + mx + Math.log(z);
  } // P(crossed class) = its existence probability; the rest shared by the evidence
  const raw = softmax(s),
    p = raw.map(v => (1 - EPSILON) * v + EPSILON / K.length);
  if (opt.lite) return { p };
  return finishPosterior(p, { parts, tau, wsum, W, exact, prior });
}
export function finishPosterior(p: number[], ex: PosteriorExtras = {}): Fused {
  const order = [...p.keys()].sort((a, b) => p[b] - p[a]);
  const H = entropyBits(p),
    Hmax = Math.log2(K.length);
  const out: Fused = {
    p,
    order,
    top: K[order[0]],
    topP: p[order[0]],
    margin: p[order[0]] - p[order[1]],
    bits: H,
    conf: clamp(1 - H / Hmax, 0, 1),
    ...ex,
  };
  const parts = ex.parts,
    W = ex.W || {},
    tau = ex.tau || 1,
    prior = ex.prior || PRIOR;
  if (parts)
    out.ledger = SOURCES.map((src): LedgerRow => {
      const r: Partial<SourcePart> = parts[src.id] || { status: 'na' };
      const w = (W[src.id] ?? src.w) * (r.wmul || 1);
      const exactBonus =
        r.exact && K[order[0]] === r.exact.cls
          ? Math.log(r.exact.p / (1 - r.exact.p)) - Math.log(prior[r.exact.cls] / (1 - prior[r.exact.cls]))
          : 0;
      return {
        id: src.id,
        n: src.n,
        d: src.d,
        w,
        wbase: W[src.id] ?? src.w,
        status: r.status || 'na',
        note: r.note,
        bits: r.status === 'ok' && r.ll ? ((w * clamp(r.ll[order[0]], -8, 8)) / tau + exactBonus) / LN2 : 0,
        ll: r.ll,
      };
    });
  return out;
}
