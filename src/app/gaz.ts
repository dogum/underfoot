/**
 * The gazetteer (Nominatim) for the station in focus: one request a second at
 * most, and while walking with Here, one a minute. Every reply checks the run
 * it was asked for, so an old sounding's answer never lands in a new one
 * (sounding/read).
 */
import { STATE } from './state';
import { gazAllowed } from './live';
import { HOOKS } from './sound';
import { readGaz } from '../sounding/read';

export function askGazLive(id: number): Promise<void> | null {
  if (gazAllowed()) return askGaz(STATE.sel, id);
  const r = STATE.results[STATE.sel];
  if (r) r.sh.gazAsked = false;
  return null;
}
export const askGaz = (i: number, id?: number | null): Promise<void> => readGaz(STATE, i, id, HOOKS);
