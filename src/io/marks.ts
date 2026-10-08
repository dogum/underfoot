/**
 * Right / wrong marks: what was really on the ground at a station, kept in
 * this browser (IndexedDB, a database of its own so clearing the network
 * cache never clears them). Nothing here leaves the device; a mark is shared
 * only by exporting it.
 *
 * A mark keeps the sources' readings at the moment it was made (their
 * log-likelihoods, engine/fuse computeParts), so a refit can learn from it
 * later (engine/refit), whatever the sources say by then.
 */
import { K, NAME, SOURCES, VERSION } from '../core/classes';
import { haversine } from '../core/geo';
import type { ClassKey, Parts, SourceId, SourcePart } from '../core/types';

export type Verdict = 'right' | 'wrong' | 'unsure';
export type How = 'here' | 'photo' | 'imagery' | 'local';
export const HOW: Record<How, string> = {
  here: 'standing here',
  photo: 'a photo I took',
  imagery: 'the imagery',
  local: 'local knowledge',
};

export interface Mark {
  id: string;
  /** when it was made, and last edited (ms) */
  t: number;
  edited?: number;
  lat: number;
  lon: number;
  verdict: Verdict;
  /** what Underfoot called it, and how sure */
  call: ClassKey;
  p: number;
  /** what's really there: the call when right, the chosen class when wrong, null when not sure */
  truth: ClassKey | null;
  how: How | null;
  /** the sources' readings when it was made */
  parts: Parts;
  /** the prior in use (core/classes PRIORS) */
  prior: string;
  place: string | null;
  /** the link hash that reopens the sounding at this station */
  link: string;
  /** 1-based station number, and metres along a line */
  station: number;
  d: number | null;
  /** the app version that made it */
  v: string;
  /** when it was shared with the community fit (io/contribute), if it was */
  shared?: number;
}

/** a station this close to a mark is the marked spot (m) */
export const SAME_SPOT = 2;

/* ---- pure helpers, tested in Node ------------------------------------------ */

/** the readings worth keeping: log-likelihoods to 4 places, status, weight multiplier and exact terms; not the prose */
export function keepParts(parts: Parts): Parts {
  const out: Parts = {};
  for (const [id, p] of Object.entries(parts) as [SourceId, SourcePart][]) {
    if (!p) continue;
    out[id] = {
      ll: Float64Array.from(p.ll, v => Math.round(v * 1e4) / 1e4),
      status: p.status,
      ...(p.wmul != null && p.wmul !== 1 ? { wmul: p.wmul } : {}),
      ...(p.exact ? { exact: { ...p.exact } } : {}),
    };
  }
  return out;
}

export function nearestMark(list: Mark[], lat: number, lon: number, within = SAME_SPOT): Mark | null {
  let best: Mark | null = null,
    bd = within;
  for (const m of list) {
    const d = haversine({ lat, lon }, m);
    if (d <= bd) {
      best = m;
      bd = d;
    }
  }
  return best;
}

/** marks a refit can learn from: right or wrong, with a truth */
export function fitMarks(list: Mark[]): { parts: Parts; truth: ClassKey }[] {
  return list.filter(m => m.verdict !== 'unsure' && m.truth).map(m => ({ parts: m.parts, truth: m.truth! }));
}

const say = (k: ClassKey) => NAME[k];
/** one line: "Grass → wetland", "Paved surface", "Not sure: scrub" */
export function markTitle(m: Mark): string {
  return m.verdict === 'wrong' && m.truth
    ? `${say(m.call)} → ${say(m.truth).toLowerCase()}`
    : m.verdict === 'unsure'
      ? `Not sure: ${say(m.call).toLowerCase()}`
      : say(m.call);
}

export function marksSummary(list: Mark[]): string {
  const n = (v: Verdict) => list.filter(m => m.verdict === v).length;
  return `${list.length} mark${list.length === 1 ? '' : 's'} · ${n('right')} right, ${n('wrong')} wrong, ${n('unsure')} not sure`;
}

const plainParts = (parts: Parts) =>
  Object.fromEntries(
    SOURCES.filter(s => parts[s.id]).map(s => {
      const p = parts[s.id]!;
      return [
        s.id,
        {
          status: p.status,
          ll: Object.fromEntries(K.map((k, c) => [k, p.ll[c]])),
          ...(p.wmul != null ? { wmul: p.wmul } : {}),
          ...(p.exact ? { exact: p.exact } : {}),
        },
      ];
    }),
  );

/** every mark as a GeoJSON point, readings included; links point at the public site */
export function marksGeoJSON(list: Mark[], site: string): object {
  return {
    type: 'FeatureCollection',
    properties: { generator: 'Underfoot v' + VERSION, kind: 'marks', created: new Date().toISOString() },
    features: list.map(m => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
      properties: {
        verdict: m.verdict,
        call: m.call,
        p_call: m.p,
        truth: m.truth,
        how: m.how,
        made: new Date(m.t).toISOString(),
        edited: m.edited ? new Date(m.edited).toISOString() : null,
        place: m.place,
        station: m.station,
        distance_m: m.d,
        link: site + m.link,
        prior: m.prior,
        version: m.v,
        readings: plainParts(m.parts),
      },
    })),
  };
}

export function marksCSV(list: Mark[], site: string): string {
  const cols = [
    'made',
    'lat',
    'lon',
    'verdict',
    'call',
    'p_call',
    'truth',
    'how',
    'place',
    'station',
    'distance_m',
    'link',
  ];
  const q = (v: unknown) =>
    v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = list.map(m =>
    [
      new Date(m.t).toISOString(),
      m.lat.toFixed(7),
      m.lon.toFixed(7),
      m.verdict,
      m.call,
      m.p.toFixed(4),
      m.truth,
      m.how,
      m.place,
      m.station,
      m.d == null ? null : m.d.toFixed(1),
      site + m.link,
    ]
      .map(q)
      .join(','),
  );
  return [cols.join(','), ...rows].join('\n') + '\n';
}

/* ---- the store ----------------------------------------------------------- */

let MARKS: Mark[] = [];
let version = 0;
let db: IDBDatabase | null = null;
/** false when this browser won't keep them (a private window, storage blocked) */
export let kept = true;

/** all marks, newest first */
export const marks = (): Mark[] => MARKS;
/** bumps whenever marks change, for anything that caches lookups */
export const marksVersion = () => version;

function open(): Promise<IDBDatabase | null> {
  if (db || !kept) return Promise.resolve(db);
  return new Promise(res => {
    try {
      const rq = indexedDB.open('underfoot-marks', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('marks', { keyPath: 'id' });
      rq.onsuccess = () => res((db = rq.result));
      rq.onerror = () => {
        kept = false;
        res(null);
      };
    } catch {
      kept = false;
      res(null);
    }
  });
}
function tx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return open().then(
    d =>
      new Promise(res => {
        if (!d) return res(null);
        try {
          const rq = fn(d.transaction('marks', mode).objectStore('marks'));
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => res(null);
        } catch {
          res(null);
        }
      }),
  );
}

const changed = () => {
  MARKS.sort((a, b) => b.t - a.t);
  version++;
  for (const fn of listeners) fn();
};
const listeners: (() => void)[] = [];
/** call fn whenever marks change */
export function onMarks(fn: () => void) {
  listeners.push(fn);
}

export async function loadMarks(): Promise<Mark[]> {
  const got = await tx('readonly', s => s.getAll());
  MARKS = Array.isArray(got) ? (got as Mark[]) : [];
  changed();
  return MARKS;
}
/** adds or replaces (by id) */
export async function saveMark(m: Mark): Promise<void> {
  MARKS = [m, ...MARKS.filter(x => x.id !== m.id)];
  changed();
  await tx('readwrite', s => s.put(m));
}
export async function deleteMark(id: string): Promise<void> {
  MARKS = MARKS.filter(x => x.id !== id);
  changed();
  await tx('readwrite', s => s.delete(id));
}
export const newMarkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
