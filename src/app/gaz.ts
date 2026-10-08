/**
 * The gazetteer (Nominatim) for the station in focus: one request a second at
 * most, and while walking with Here, one a minute. Every reply checks the run
 * it was asked for, so an old sounding's answer never lands in a new one.
 */
import { STATE } from './state';
import { scheduleField } from './field';
import { gazAllowed } from './live';
import { tick } from './sound';
import { nominatim } from '../data/nominatim';

export function askGazLive(id: number): Promise<void> | null {
  if (gazAllowed()) return askGaz(STATE.sel, id);
  const r = STATE.results[STATE.sel];
  if (r) r.sh.gazAsked = false;
  return null;
}
export async function askGaz(i: number, id?: number | null): Promise<void> {
  const r = STATE.results[i];
  if (!r || r.sh.nom !== undefined) return;
  r.sh.gazAsked = true;
  tick();
  let g = null;
  try {
    g = await nominatim(r.station.lat, r.station.lon);
  } catch {
    g = null;
  }
  if (id != null && id !== STATE.runId) return;
  if (STATE.results[i] === r) {
    r.sh.nom = g;
    tick();
    scheduleField();
  }
}
