// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * The plain-language read under the verdict. Pure.
 */
import { CIX, K, NAME } from '../core/classes';
import { esc } from '../core/dom';
import { Phi, fmt } from '../core/math';
import { GEOM_ERR } from './evidence';
import { OBJECTS } from './smooth';

/* ---- plain-English call ---------------------------------------------------*/
export const PHRASE = {
  building: 'inside a building footprint',
  paved: 'on a paved surface',
  path: 'on a path or trail',
  rail: 'on a railway',
  forest: 'under forest canopy',
  scrub: 'in scrub or brush',
  grass: 'on grass',
  crop: 'in cropland',
  water: 'in open water',
  wetland: 'in wetland',
  bare: 'on bare ground',
  snow: 'on snow or ice',
};
export function narrate(f, sh, q) {
  if (!f) return '';
  const top = f.top,
    sec = K[f.order[1]],
    pct = v => Math.round(v * 100) + '%';
  const bits = [];
  const st = q && q.stIn && q.stIn.attr;
  if (top === 'building' && st) {
    const a = st;
    bits.push(
      [
        a.PRIM_OCC && a.PRIM_OCC !== 'Unclassified'
          ? a.PRIM_OCC.toLowerCase()
          : (a.OCC_CLS || '').toLowerCase(),
        a.HEIGHT ? `about ${fmt(a.HEIGHT, 0)} m tall` : '',
      ]
        .filter(Boolean)
        .join(', '),
    );
  }
  if ((top === 'paved' || top === 'path' || top === 'rail') && q && q.best[top]) {
    const b = q.best[top];
    bits.push(
      q.follow === top
        ? `following ${b.name || 'a mapped ' + b.what}`
        : `${b.name || b.what} ${fmt(b.d, 1)} m away`,
    );
  }
  if (['forest', 'scrub', 'grass', 'crop'].includes(top) && sh.nlcd && sh.nlcd.canopy != null)
    bits.push(`${sh.nlcd.canopy}% tree canopy`);
  if (top === 'water' && q) {
    const w = q.enclosing.find(e => e.rule === 'water' && e.name);
    if (w) bits.push(w.name);
  }
  /* the class list is one variable — the surface — but a trail under closed
     canopy is honestly both. When the geometry puts a tread right here, say so. */
  let tread = '';
  if (!OBJECTS.has(top) && q)
    for (const k of ['path', 'paved', 'rail']) {
      const b = q.best[k];
      if (b && Phi((b.w - b.d) / GEOM_ERR) > 0.5 && f.p[CIX[k]] > 0.03) {
        tread = ` The mapped ${esc(b.name || b.what)} runs ${fmt(b.d, 1)} m away — likely its tread, under the ${NAME[top].toLowerCase()}.`;
        break;
      }
    }
  const lead =
    `Most likely <b>${PHRASE[top]}</b> (${pct(f.topP)})${bits.length ? ' — ' + esc(bits.join(', ')) : ''}.` +
    tread;
  let alt = '';
  if (f.p[f.order[1]] > 0.08) {
    const why =
      (sec === 'paved' || sec === 'path' || sec === 'rail') && q && q.best[sec]
        ? ` — ${esc(q.best[sec].name || q.best[sec].what)} ${fmt(q.best[sec].d, 1)} m away`
        : sec === 'building' && q && q.stD < 25 && !q.stIn
          ? ` — a footprint ${fmt(q.stD, 1)} m away`
          : '';
    alt = ` Next is ${NAME[sec].toLowerCase()} at ${pct(f.p[f.order[1]])}${why}.`;
  }
  const dissent = (f.ledger || []).filter(l => l.status === 'ok').sort((a, b) => a.bits - b.bits)[0];
  const warn =
    dissent && dissent.bits < -1 ? ` ${esc(dissent.n)} disagrees (${fmt(dissent.bits, 1)} bits).` : '';
  return lead + alt + warn;
}
