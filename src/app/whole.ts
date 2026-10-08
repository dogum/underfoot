/**
 * The sources asked once for every station on the line: today's weather, the
 * newest clear Sentinel-2 pass, and the global land cover where NLCD has no
 * class. Each reply checks the run it was asked for, and re-fuses the field
 * map as well as the stations: a GPS-disc answer averages the field, so a
 * source that lands after the field was drawn must reach it too.
 */
import { STATE } from './state';
import { scheduleField } from './field';
import { tick } from './sound';
import { inCONUS } from '../core/geo';
import { passFor } from '../data/sentinel';
import { todayFor } from '../data/today';
import { worldCoverFor } from '../data/worldcover';
import type { Station } from '../core/types';

function land(id: number, idx: number[], key: 'today' | 'pass' | 'world', v: unknown[]) {
  if (id !== STATE.runId) return;
  idx.forEach((i, k) => {
    const r = STATE.results[i];
    if (r) r.sh[key] = v[k];
  });
  tick();
  scheduleField();
}
const every = (st: Station[]) => st.map((_, i) => i);

/** today's weather at each station (data/today) */
export const askToday = (st: Station[], id: number) =>
  todayFor(st).then(v => land(id, every(st), 'today', v));

/** the newest clear Sentinel-2 pass at each station (data/sentinel) */
export const askPass = (st: Station[], id: number) => passFor(st).then(v => land(id, every(st), 'pass', v));

/** the global land cover where NLCD has no class: abroad at once, and in the
 *  lower-48 box once NLCD (`nlcdDone`) has answered with nothing (data/worldcover) */
export async function askWorld(st: Station[], id: number, nlcdDone: Promise<unknown>) {
  const ask = async (idx: number[]) => {
    if (idx.length) land(id, idx, 'world', await worldCoverFor(idx.map(i => st[i])));
  };
  await ask(every(st).filter(i => !inCONUS(st[i])));
  await nlcdDone;
  if (id === STATE.runId)
    await ask(every(st).filter(i => inCONUS(st[i]) && STATE.results[i]?.sh.nlcd?.code == null));
}
