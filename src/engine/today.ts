/**
 * Today (M4): the weather at the point, from the Open-Meteo model (data/today).
 * Pure.
 *
 * Snow that has fallen in the last week lies on top of whatever the ground
 * is, so it doesn't vote against the map: it becomes an on-top term (engine/
 * fuse), and the answer is p of snow and 1 − p of what's underneath. A lawn
 * under fresh snow is called snow, with the map's grass as runner-up.
 *
 * Snow the model carries with none fallen in a week counts only as a light
 * vote: weather models can hold a glacier under permanent snow, as at
 * Konkordia in October, where the satellite saw bare rock. Wet soil leans to
 * wetland and away from bare ground. Rain is shown, not counted. With no snow
 * and ordinary soil, the source is quiet and stays out of the fusion.
 */
import { CIX } from '../core/classes';
import { centre, fmt, zeros } from '../core/math';
import type { SourcePart, StationFacts, TodayFacts } from '../core/types';

export const TODAY = {
  /** m: less snow than this is a dusting, not a cover */
  snowFrom: 0.03,
  /** cm in the last seven days for the model's snow to count as fresh */
  freshFrom: 1,
  /** m³/m³: wetter than this leans to wetland */
  wetFrom: 0.3,
};

/** how likely the ground is under snow, from the depth of fresh snow: 3 cm → 0.61, 10 cm → 0.74, 30 cm → 0.85 */
export const snowCover = (depth: number) => 0.55 + 0.35 * (1 - Math.exp(-depth / 0.15));

const cm = (m: number) => `${fmt(m * 100, 0)} cm`;

export function srcToday(sh: StationFacts): SourcePart {
  const t = sh.today as TodayFacts | null | undefined;
  if (t === undefined) return { ll: zeros(), status: 'wait', note: 'asking Open-Meteo' };
  if (!t) return { ll: zeros(), status: 'na', note: 'Open-Meteo had no reading here' };
  const ll = zeros(),
    said: string[] = [];
  let onTop: SourcePart['onTop'] = null;
  if (t.snow >= TODAY.snowFrom) {
    if (t.snow7 >= TODAY.freshFrom) {
      onTop = { cls: 'snow', p: snowCover(t.snow) };
      said.push(
        `snow ${cm(t.snow)}, ${fmt(t.snow7, 0)} cm fallen this week → the ground is likely under snow (${Math.round(onTop.p * 100)}%)`,
      );
    } else {
      ll[CIX.snow] = Math.min(2, 1 + 4 * t.snow);
      said.push(`snow ${cm(t.snow)} in the model but none fallen this week, so it counts lightly`);
    }
  }
  if (t.soil != null && t.soil >= TODAY.wetFrom) {
    const lean = Math.min(1.5, (t.soil - TODAY.wetFrom) * 10);
    ll[CIX.wetland] += lean;
    ll[CIX.bare] -= lean;
    said.push(`soil ${Math.round(t.soil * 100)}% water → leans wetland`);
  }
  const rest = `${t.time.slice(11)} local, model cell ${fmt(t.grid.km, 1)} km away · ${fmt(t.rain3, 1)} mm rain in 3 days`;
  if (!said.length)
    return {
      ll,
      status: 'quiet',
      note: `nothing to say today: ${t.snow > 0 ? cm(t.snow) + ' of snow' : 'no snow'}, soil ${t.soil == null ? 'n/a' : Math.round(t.soil * 100) + '% water'} · ${rest}`,
    };
  return { ll: centre(ll), status: 'ok', note: `${said.join(' · ')} · ${rest}`, onTop };
}
