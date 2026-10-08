/**
 * Now, in the readout (M4): chips for today's snow, soil and rain and for the
 * newest Sentinel-2 pass, a line saying where they came from and when, and the
 * pass in the imagery panel (data/today, data/sentinel).
 */
import { el } from '../core/dom';
import { fmt } from '../core/math';
import { SCL, sclName } from '../engine/sentinel';
import type { PassFacts, StationFacts, TodayFacts } from '../core/types';

const chip = (k: string, v: string, title: string) => {
  const c = el('div', 'chip now');
  c.title = title;
  c.append(el('span', 'lbl', k), el('b', null, v));
  return c;
};
const SHORT: Record<number, string> = { 4: 'vegetation', 5: 'bare/built', 6: 'water', 11: 'snow' };
const day = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const ago = (d: number) => (d < 1.5 ? 'a day ago' : `${Math.round(d)} days ago`);
const clear = (p: PassFacts) => p.scl != null && !!SCL[p.scl];

function passChip(sh: StationFacts): HTMLElement[] {
  const p = sh.pass as PassFacts | null | undefined;
  if (p === undefined) return [chip('Sentinel-2', '…', 'Finding the newest clear Sentinel-2 pass')];
  if (!p) return [];
  if (!clear(p))
    return [
      chip(
        'Sentinel-2',
        'no clear view',
        `Cloud, shadow or a dark pixel over the point on the last ${p.skipped.length} passes`,
      ),
    ];
  return [
    chip(
      'Sentinel-2',
      `${day(p.date)} · ${SHORT[p.scl!]}`,
      `The newest clear pass, ${p.date} (${ago(p.days)}): scene class "${sclName(p.scl!)}" at the 20 m pixel`,
    ),
  ];
}

export function todayChips(sh: StationFacts): HTMLElement[] {
  const t = sh.today as TodayFacts | null | undefined;
  if (t === undefined)
    return [chip('Today', '…', 'Asking Open-Meteo for today’s weather here'), ...passChip(sh)];
  if (!t) return passChip(sh);
  return [
    chip(
      'Snow now',
      t.snow >= 0.005 ? `${fmt(t.snow * 100, 0)} cm` : 'none',
      `Snow depth in the Open-Meteo model; ${fmt(t.snow7, 1)} cm fell in the last week`,
    ),
    chip(
      'Soil',
      t.soil == null ? 'n/a' : `${Math.round(t.soil * 100)}% water`,
      'Water in the top centimetre of soil, by volume (Open-Meteo model)',
    ),
    chip(
      'Rain 3 d',
      `${fmt(t.rain3, 1)} mm`,
      'Rain over the last three days (Open-Meteo model); shown, not counted',
    ),
    ...passChip(sh),
  ];
}

/** where the chips came from, and when */
export function todayLine(sh: StationFacts): HTMLElement | null {
  const t = sh.today as TodayFacts | null | undefined,
    p = sh.pass as PassFacts | null | undefined,
    parts: string[] = [];
  if (t)
    parts.push(
      `Today: Open-Meteo, ${t.time.slice(11) || 'now'} local, a model on a grid a few km wide (its cell is ${fmt(t.grid.km, 1)} km away)`,
    );
  if (p && clear(p)) parts.push(`newest clear pass: Sentinel-2, ${day(p.date)} (${ago(p.days)}), 20 m pixel`);
  return parts.length ? el('div', 'nowline', parts.join(' · ')) : null;
}

/** the pass in the imagery panel: date, age and scene class (HTML) */
export function passHtml(sh: StationFacts): string {
  const p = sh.pass as PassFacts | null | undefined;
  if (p === undefined) return '<br>Newest Sentinel-2 pass: looking…';
  if (!p) return '';
  if (!clear(p))
    return `<br>Newest Sentinel-2 passes: no clear view of the point on the last ${p.skipped.length}`;
  return `<br>Newest pass: Sentinel-2 <b>${p.date}</b> (${ago(p.days)}) · <b>${sclName(p.scl!)}</b> at the 20 m pixel`;
}
