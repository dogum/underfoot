/**
 * Go / slow / no-go for the point or line on screen (engine/mobility): each
 * station's inputs gathered from what the sounding knows, rated for foot, ATV
 * and truck, and the line summed. Rerun with every recompute (app/sound), so
 * it follows the answers as they land.
 */
import { STATE } from './state';
import { drainsPoorly } from '../data/soils';
import { GEOM_ERR } from '../engine/evidence';
import { PRESET_IDS, rateLine, rateStation } from '../engine/mobility';
import type { GoingIn, LineGoing, Preset, Rating } from '../engine/mobility';
import { overhead } from '../engine/overhead';
import { spanBounds } from '../engine/report';
import type { SoilFacts, TodayFacts } from '../core/types';

export interface Going {
  /** each preset's rating at each station (null until the station has an answer) */
  st: Record<Preset, (Rating | null)[]>;
  /** each station's inputs, for the panel that shows every factor */
  inputs: (GoingIn | null)[];
  /** the line summed, per preset; null for a point */
  line: Record<Preset, LineGoing> | null;
}

/** % of soil water in the top centimetre above which soil counts as wet */
export const WET_FROM = 0.3;

function inputs(i: number): GoingIn | null {
  const r = STATE.results[i],
    st = STATE.stations;
  if (!r || !r.view) return null;
  /* grade along the line, from the stations either side, in the direction it was drawn */
  let grade = 0;
  if (STATE.mode === 'path' && st.length > 1) {
    const a = Math.max(0, i - 1),
      b = Math.min(st.length - 1, i + 1),
      za = STATE.results[a]?.sh.terr?.z,
      zb = STATE.results[b]?.sh.terr?.z,
      run = st[b].d - st[a].d;
    if (za != null && zb != null && run > 0) grade = (zb - za) / run;
  }
  const t = r.sh.terr,
    today = r.sh.today as TodayFacts | null | undefined,
    soil = r.sh.soil as SoilFacts | null | undefined,
    ov = overhead(r.sh, r.q, r.view.top),
    path = r.q?.best?.path,
    x = r.station.x;
  return {
    p: r.view.p,
    grade,
    slope: t?.slope ?? null,
    rough: t?.rough ?? null,
    canopy: ov?.canopy ?? null,
    /* wet today, on ground that drains poorly, or with no survey to say it doesn't */
    wet: !!today && today.soil != null && today.soil >= WET_FROM && (!soil || drainsPoorly(soil)),
    /* on a mapped path: the matched one, or one whose tread the point is within */
    tread: path && path.d <= path.w + GEOM_ERR ? path.what : null,
    cross: x ? { cls: x.cls, what: x.what, over: x.over } : null,
  };
}

export function rateAll(): Going {
  const n = STATE.stations.length,
    ins = Array.from({ length: n }, (_, i) => inputs(i));
  const st = Object.fromEntries(
    PRESET_IDS.map(p => [p, ins.map(x => (x ? rateStation(x, p) : null))]),
  ) as Going['st'];
  let line: Going['line'] = null;
  if (STATE.mode === 'path' && n > 1 && ins.every(Boolean)) {
    const B = spanBounds(STATE.stations);
    line = Object.fromEntries(PRESET_IDS.map(p => [p, rateLine(B, st[p] as Rating[], p)])) as Going['line'];
  }
  return { st, inputs: ins, line };
}
