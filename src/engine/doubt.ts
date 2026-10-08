/**
 * Doubt: how unsure a station's answer is, and why. Pure.
 *
 * Two things make an answer doubtful. It can be close: the call leads the
 * runner-up by little. Or its sources can disagree: the call is confident only
 * because strong sources outvote others that would rather say something else.
 * Seasonal snow over mapped bare rock reads bare at 97%, with the photo arguing
 * for snow the whole time; that's as worth a look as a 40/35 split. The score
 * counts either as a reason to look, and both together as more of one.
 */
import { CIX, K, NAME, SOURCES } from '../core/classes';
import { clamp } from '../core/math';
import type { ClassKey, Doubt, Fused, SourceId } from '../core/types';
export type { Doubt };

/* sources that see an area (a polygon, a 30 m pixel, a photo patch, a terrain
   rosette) can't resolve a 2 m tread: the engine floors their votes against
   narrow things (engine/fuse SUBPIX_FLOOR), and their "dissent" from one is
   resolution, not evidence */
const NARROW = new Set<ClassKey>(['path', 'rail', 'paved', 'building']);
const AREA = new Set(SOURCES.filter(s => s.scale === 'area').map(s => s.id));

/** a station at or above this is doubtful */
export const DOUBT_AT = 0.5;
/** a lead of this much probability or more over the runner-up isn't close at all */
const CLEAR_LEAD = 0.5;
/** nats: a source has a favourite when one class leads its others by this much */
const CLEAR_FAV = 0.25;

/* Spread is counted by direction, not strength: which way each source leans.
   The imagery model often leans only slightly (bright white reads snow 2.3,
   bare 1.9), and that lean is exactly the warning at a glacier's edge. Sources
   with no clear favourite (the line source only ever argues against classes)
   don't count either way. Area sources abstain on a crossed or followed path,
   so they tie with it rather than dissent. */
export function doubtOf(f: Fused): Doubt {
  /* at a crossing, or on a path the line follows, geometry sets the call and
     the area sources can't see it: only a close call is a reason to look */
  const exact = !!(f.exact || f.parts?.prox?.exact);
  const top = CIX[f.top],
    second = f.order[1],
    close = clamp(1 - (f.p[top] - f.p[second]) / CLEAR_LEAD, 0, 1),
    tau = f.tau || 1;
  let opinion = 0,
    dissent = 0,
    against: Doubt['against'] = null,
    backer: Doubt['backer'] = null;
  const narrow = NARROW.has(f.top);
  for (const l of exact ? [] : f.ledger || []) {
    if (l.status !== 'ok' || !l.ll || (narrow && AREA.has(l.id))) continue;
    const ll = Array.from(l.ll, v => clamp(v, -8, 8)),
      order = ll.map((_, k) => k).sort((a, b) => ll[b] - ll[a]),
      fav = order[0],
      bits = (n: number) => (n * l.w) / tau / Math.LN2;
    if (ll[fav] - ll[order[1]] < CLEAR_FAV) continue;
    opinion += l.w;
    const over = ll[fav] - ll[top];
    if (over >= CLEAR_FAV) {
      dissent += l.w;
      if (!against || bits(over) > against.bits)
        against = { id: l.id, n: l.n, cls: K[fav], bits: bits(over) };
    } else if (fav === top) {
      const lead = bits(ll[top] - ll[order[1]]);
      if (!backer || lead > backer.bits) backer = { id: l.id, n: l.n, bits: lead };
    }
  }
  const spread = opinion > 0 ? dissent / opinion : 0;
  /* either is a reason to look, and both together more so */
  const score = 1 - (1 - close) * (1 - spread);
  return { score, close, spread, against, backer, runnerUp: K[second] };
}

/** the walk check list: this many spots, at least this many metres apart along the line */
export const CHECK = { n: 5, apart: 40 };
export interface Spot {
  /** station index */
  i: number;
  /** metres along the line */
  d: number;
  score: number;
}
/**
 * The spots worth walking to: the most doubtful stations, one per stretch (a
 * station within CHECK.apart of a more doubtful pick is left out), numbered in
 * walking order. On the demo line, 15 lit stations make 5 spots.
 */
export function checkList<T extends Spot>(spots: T[], n = CHECK.n, apart = CHECK.apart): T[] {
  const out: T[] = [];
  for (const s of spots.filter(s => s.score >= DOUBT_AT).sort((a, b) => b.score - a.score || a.d - b.d)) {
    if (out.length === n) break;
    if (out.every(o => Math.abs(o.d - s.d) >= apart)) out.push(s);
  }
  return out.sort((a, b) => a.d - b.d);
}

/* what each source is, in a sentence */
const SAY: Record<SourceId, string> = {
  contain: 'the map',
  prox: 'the mapped lines',
  struct: 'the footprints',
  image: 'the photo',
  cover: 'land cover',
  canopy: 'canopy cover',
  terrain: 'the terrain',
  gaz: 'the gazetteer',
};
const say = (k: ClassKey) => NAME[k].split(' /')[0].toLowerCase();
const pct = (p: number) => Math.round(p * 100) + '%';

/**
 * Why an answer is worth a look, in plain words: the two classes when the
 * call is close, who says what when the sources disagree.
 * "grass 49% or forest 48% · the map says grass, land cover says forest"
 */
export function doubtWords(d: Doubt, f: Fused): string {
  const out: string[] = [];
  if (d.close >= 0.25)
    out.push(`${say(f.top)} ${pct(f.topP)} or ${say(d.runnerUp)} ${pct(f.p[CIX[d.runnerUp]])}`);
  if (d.against)
    out.push(
      d.backer
        ? `${SAY[d.backer.id]} says ${say(f.top)}, ${SAY[d.against.id]} says ${say(d.against.cls)}`
        : `${say(f.top)} on balance, but ${SAY[d.against.id]} says ${say(d.against.cls)}`,
    );
  return out.join(' · ') || `${say(f.top)} ${pct(f.topP)}`;
}
