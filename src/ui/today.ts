/**
 * Today, in the readout (M4): "now" chips for snow, soil and rain, and a line
 * saying where they came from and when (data/today, engine/today).
 */
import { el } from '../core/dom';
import { fmt } from '../core/math';
import type { StationFacts, TodayFacts } from '../core/types';

const chip = (k: string, v: string, title: string) => {
  const c = el('div', 'chip now');
  c.title = title;
  c.append(el('span', 'lbl', k), el('b', null, v));
  return c;
};

export function todayChips(sh: StationFacts): HTMLElement[] {
  const t = sh.today as TodayFacts | null | undefined;
  if (t === undefined) return [chip('Today', '…', 'Asking Open-Meteo for today’s weather here')];
  if (!t) return [];
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
  ];
}

/** where today's chips came from, and when */
export function todayLine(sh: StationFacts): HTMLElement | null {
  const t = sh.today as TodayFacts | null | undefined;
  if (!t) return null;
  return el(
    'div',
    'nowline',
    `Today: Open-Meteo, ${t.time.slice(11) || 'now'} local, a model on a grid a few km wide (its cell is ${fmt(t.grid.km, 1)} km away)`,
  );
}
