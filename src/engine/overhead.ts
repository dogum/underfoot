/**
 * What's overhead at a station (M5). The twelve classes name the surface, and
 * a trail under trees is both: so one plain line under the answer says what's
 * above it, from a mapped roof, tree canopy (NLCD in the lower 48) or the
 * global land cover's trees elsewhere. Go / slow / no-go reads it too. Pure.
 */
import type { ClassKey, GeoQuery, StationFacts, WorldFacts } from '../core/types';

export interface Overhead {
  kind: 'trees' | 'roof' | 'open';
  /** tree canopy, 0–100, where a raster measures it */
  canopy: number | null;
  /** plain words for the line, and where they came from */
  text: string;
  src: string;
}

/** %: under this much tree canopy, the sky is open */
export const CANOPY_FROM = 10;

export function overhead(sh: StationFacts, q: GeoQuery | null | undefined, top: ClassKey): Overhead | null {
  /* inside a building, the roof is the answer itself */
  if (top === 'building') return null;
  const enc = (q?.enclosing as { rule: string }[] | undefined) || [];
  if (q?.stIn || enc.some(e => e.rule === 'building'))
    return {
      kind: 'roof',
      canopy: null,
      text: 'a roof',
      src: 'a mapped building footprint encloses the point',
    };
  const c = sh.nlcd?.canopy as number | null | undefined;
  if (c != null)
    return c >= CANOPY_FROM
      ? { kind: 'trees', canopy: c, text: `tree canopy ${c}%`, src: 'NLCD 2021, 30 m pixel' }
      : { kind: 'open', canopy: c, text: `open sky (tree canopy ${c}%)`, src: 'NLCD 2021, 30 m pixel' };
  const w = sh.world as WorldFacts | null | undefined;
  /* clouds and no data say nothing */
  if (w && w.code !== 10 && w.code !== 0)
    return w.code === 2
      ? { kind: 'trees', canopy: null, text: 'trees', src: `World cover ${w.year}, 10 m pixel` }
      : { kind: 'open', canopy: null, text: 'open sky', src: `World cover ${w.year}, 10 m pixel` };
  return null;
}
