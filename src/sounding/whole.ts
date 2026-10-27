/**
 * The sources asked once for every station on the line: today's weather, the
 * newest clear Sentinel-2 pass, the global land cover where NLCD has no
 * class, and the soil survey for go / slow / no-go. Each reply checks the run
 * it was asked for, and re-fuses the field map as well as the stations: a
 * GPS-disc answer averages the field, so a source that lands after the field
 * was drawn must reach it too.
 */
import { current } from './run';
import type { Hooks, Run } from './run';
import { inCONUS, inUS } from '../core/geo';
import { passFor } from '../data/sentinel';
import { soilsFor } from '../data/soils';
import { todayFor } from '../data/today';
import { worldCoverFor } from '../data/worldcover';
import type { Station } from '../core/types';

function land(
  run: Run,
  id: number,
  hooks: Hooks,
  idx: number[],
  key: 'today' | 'pass' | 'world' | 'soil',
  v: unknown[],
) {
  if (!current(run, id)) return;
  idx.forEach((i, k) => {
    const r = run.results[i];
    if (r) Object.assign(r.sh, { [key]: v[k] });
  });
  hooks.tick();
  hooks.field();
}
const every = (st: Station[]) => st.map((_, i) => i);

/** today's weather at each station (data/today) */
export const readToday = (run: Run, st: Station[], id: number, hooks: Hooks) =>
  todayFor(st).then(v => land(run, id, hooks, every(st), 'today', v));

/** the newest clear Sentinel-2 pass at each station (data/sentinel) */
export const readPass = (run: Run, st: Station[], id: number, hooks: Hooks) =>
  passFor(st, Date.now(), () => current(run, id)).then(v => land(run, id, hooks, every(st), 'pass', v));

/** the global land cover where NLCD has no class: abroad at once, and in the
 *  lower-48 box once NLCD (`nlcdDone`) has answered with nothing (data/worldcover) */
export async function readWorld(
  run: Run,
  st: Station[],
  id: number,
  hooks: Hooks,
  nlcdDone: Promise<unknown>,
) {
  const ask = async (idx: number[]) => {
    if (idx.length) land(run, id, hooks, idx, 'world', await worldCoverFor(idx.map(i => st[i])));
  };
  await ask(every(st).filter(i => !inCONUS(st[i])));
  await nlcdDone;
  if (current(run, id))
    await ask(every(st).filter(i => inCONUS(st[i]) && run.results[i]?.sh.nlcd?.code == null));
}

/** the soil under each US station, for go / slow / no-go (data/soils); none abroad */
export async function readSoils(run: Run, st: Station[], id: number, hooks: Hooks) {
  const idx = every(st).filter(i => inUS(st[i]));
  if (idx.length) land(run, id, hooks, idx, 'soil', await soilsFor(idx.map(i => st[i])));
}
