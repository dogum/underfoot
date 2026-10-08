/**
 * Sharing marks with the community fit (M3): what a mark becomes when it
 * leaves the browser, and the post that sends it. Only what the fit needs
 * goes: the sources' readings, what was really there, how you know, the 1°
 * cell, the month, the app version and a random id for this browser. Never
 * the coordinates (unless you tick the box), the place, the link, the day or
 * the time, and never a not-sure mark.
 *
 * The store is a Supabase table that takes anonymous inserts and nothing else
 * (supabase/migrations). Until STORE is filled in, nothing is sent; the
 * dialog saves the batch as a file instead.
 */
import { K, SOURCES, VERSION } from '../core/classes';
import { STORE } from '../core/project';
import type { ClassKey, ExactTerm, SourceId, SourceStatus } from '../core/types';
import type { How, Mark } from './marks';

/** one shared mark, as the store's table has it */
export interface SharedRow {
  /** the mark's own random id: the store refuses a second copy */
  id: string;
  /** this browser's random id, so the fit can count one person as one */
  who: string;
  version: string;
  /** YYYY-MM, when it was made */
  month: string;
  /** the 1° cell it's in, e.g. N37W120 */
  cell: string;
  verdict: 'right' | 'wrong';
  call: ClassKey;
  p_call: number;
  truth: ClassKey;
  how: How | null;
  prior: string;
  /** each source's log-likelihoods by class, with its status, weight multiplier and any exact term */
  readings: Partial<
    Record<SourceId, { ll: Record<ClassKey, number>; status: SourceStatus; wmul?: number; exact?: ExactTerm }>
  >;
  /** only when the person chose to share the exact points */
  lat: number | null;
  lon: number | null;
}

/** a random id for this browser, made once and kept; not tied to anything else */
export function whoAmI(): string {
  try {
    let w = localStorage.getItem('uf.who');
    if (!w) {
      w = crypto.randomUUID();
      localStorage.setItem('uf.who', w);
    }
    return w;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2, 10);
  }
}

/** the 1° cell a point is in, named by its south-west corner like an SRTM tile: N37W120 is 37–38°N, 119–120°W */
export function cellOf(lat: number, lon: number): string {
  const a = Math.floor(lat),
    o = Math.floor(lon);
  return (
    (a < 0 ? 'S' : 'N') +
    String(Math.abs(a)).padStart(2, '0') +
    (o < 0 ? 'W' : 'E') +
    String(Math.abs(o)).padStart(3, '0')
  );
}

/** marks a share can send: right or wrong, with a truth, not sent already */
export const shareable = (list: Mark[]) => list.filter(m => m.verdict !== 'unsure' && m.truth && !m.shared);

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
/** a mark as the store gets it; the point only if `withPoint` */
export function toRow(m: Mark, who: string, withPoint = false): SharedRow {
  const readings: SharedRow['readings'] = {};
  for (const s of SOURCES) {
    const p = m.parts[s.id];
    if (!p) continue;
    readings[s.id] = {
      ll: Object.fromEntries(K.map((k, c) => [k, r4(p.ll[c])])) as Record<ClassKey, number>,
      status: p.status,
      ...(p.wmul != null ? { wmul: p.wmul } : {}),
      ...(p.exact ? { exact: p.exact } : {}),
    };
  }
  return {
    id: m.id,
    who,
    version: VERSION,
    month: new Date(m.t).toISOString().slice(0, 7),
    cell: cellOf(m.lat, m.lon),
    verdict: m.verdict as 'right' | 'wrong',
    call: m.call,
    p_call: r4(m.p),
    truth: m.truth!,
    how: m.how,
    prior: m.prior,
    readings,
    lat: withPoint ? Math.round(m.lat * 1e5) / 1e5 : null,
    lon: withPoint ? Math.round(m.lon * 1e5) / 1e5 : null,
  };
}

/** is there a store to send to? */
export const storeOn = () => !!(STORE.url && STORE.key);

/** send rows to the store: Supabase's REST insert, with the key that can only insert */
export async function postRows(rows: SharedRow[]): Promise<{ ok: boolean; status: number }> {
  if (!storeOn()) return { ok: false, status: 0 };
  try {
    const res = await fetch(`${STORE.url.replace(/\/$/, '')}/rest/v1/${STORE.table}`, {
      method: 'POST',
      headers: {
        apikey: STORE.key,
        Authorization: `Bearer ${STORE.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
