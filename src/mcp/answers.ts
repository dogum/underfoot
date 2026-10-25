/**
 * The envelopes for the longer jobs (mcp/jobs): many points, an area, a
 * spot's history. The same parts as a point's or a line's (mcp/envelope),
 * with what each job adds: rows and the points worth a look, acres per
 * class, the captures and the changes found. Pure.
 */
import { K, VERSION } from '../core/classes';
import { DOUBT_AT } from '../engine/doubt';
import { ACRE } from '../engine/area';
import { leastSureFirst } from '../engine/batch';
import { IMG_MODEL } from '../engine/imagery-model';
import { YEAR_CLASSES, monthYear, yearsWords } from '../engine/years';
import type { PointsRead } from '../headless/batch';
import type { Sounding } from '../headless/sound';
import type { History } from '../sounding/years';
import { CAVEAT, callOf, cap, linkAt, m1, pct, r2, say, sourcesOf, wrap } from './envelope';
import type { Detail } from './envelope';
import type { ClassKey, Fused, LatLon } from '../core/types';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const counted = (byClass: Map<ClassKey, number>) =>
  [...byClass].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ class: k, n }));

/* ---- many points ---------------------------------------------------------- */
export interface PointIn extends LatLon {
  name?: string;
}
/** what the groups' soundings gave besides their rows: every answer's ledger, and the credits */
export interface PointsSeen {
  views: Fused[];
  credit: Set<string>;
}
export function pointsAnswer(pr: PointsRead, pts: PointIn[], seen: PointsSeen, detail?: Detail) {
  const read = pr.rows.filter(Boolean).length,
    by = new Map<ClassKey, number>();
  for (const r of pr.rows) if (r) by.set(r.call, (by.get(r.call) || 0) + 1);
  const rows = pr.rows.map((r, i) =>
    r
      ? {
          ...(pts[i].name ? { name: pts[i].name } : {}),
          class: r.call,
          p: r2(r.p),
          then: r.then,
          p_then: r2(r.pThen),
          doubt: r2(r.doubt),
          ...(detail === 'full' ? { sources: r.src, link: linkAt(pts[i]) } : {}),
        }
      : null,
  );
  const look = leastSureFirst(pr.rows)
    .filter(i => pr.rows[i] && pr.rows[i]!.doubt >= DOUBT_AT)
    .map(i => ({
      i,
      ...(pts[i].name ? { name: pts[i].name } : {}),
      point: { lat: pts[i].lat, lon: pts[i].lon },
      class: pr.rows[i]!.call,
      p: r2(pr.rows[i]!.p),
      doubt: r2(pr.rows[i]!.doubt),
      link: linkAt(pts[i]),
    }));
  const ps = pr.rows.flatMap(r => (r ? [r.p] : [])).sort((a, b) => a - b),
    calls = counted(by);
  const summary =
    `${read === pts.length ? plural(read, 'point') : `${read} of ${pts.length} points`} read: ` +
    calls
      .slice(0, 4)
      .map(c => `${say(c.class)} ${c.n}`)
      .join(', ') +
    '.' +
    (ps.length ? ` Median call ${pct(ps[ps.length >> 1])}.` : '') +
    (look.length ? ` ${plural(look.length, 'is', 'are')} worth a second look (worth_checking).` : '') +
    (pr.dropped ? ` The first ${pts.length} were read; ${pr.dropped} more were left out.` : '');
  const b = pr.weights;
  return {
    summary,
    count: pts.length,
    read,
    calls,
    rows,
    worth_checking: look.slice(0, 20),
    sources: { ...sourcesOf(seen.views), timed_out: pr.missing },
    weights: b ? b.label : '',
    version: VERSION,
    as_of: new Date().toISOString(),
    complete: pr.complete,
    attribution: [...seen.credit].join(' · '),
    caveat: CAVEAT,
  };
}

/* ---- an area -------------------------------------------------------------- */
export function areaAnswer(so: Sounding, detail?: Detail) {
  const A = so.area,
    S = A?.sum;
  if (!A || !S || !S.cells) throw new Error('no answer for that outline: none of its tiles could be read');
  const m2 = S.m2,
    share = (v: number[]) =>
      K.map((k, c) => ({ class: k, share: v[c] / m2, m2: v[c] }))
        .filter(x => x.share >= 0.005)
        .sort((a, b) => b.share - a.share);
  const classes = share(S.byClass).map(x => ({
      class: x.class,
      share: r2(x.share),
      acres: m1(x.m2 / ACRE),
      hectares: r2(x.m2 / 1e4),
    })),
    byCall = share(S.mosaic).map(x => ({ class: x.class, share: r2(x.share) })),
    R = so.run.results,
    checks = R.flatMap((r, t) => {
      const c = r?.view && callOf(r);
      return c && c.doubt.worth_checking
        ? [{ point: { lat: r.station.lat, lon: r.station.lon }, class: c.class, doubt: c.doubt.score, t }]
        : [];
    })
      .sort((a, b) => b.doubt - a.doubt)
      .slice(0, 5)
      .map(({ t, ...c }) => ({ ...c, link: linkAt(R[t].station) })),
    coverage = S.cells / Math.max(S.expectedCells, 1);
  const summary =
    `${m1(m2 / ACRE)} acres (${m1(m2 / 1e4)} ha): ` +
    classes
      .slice(0, 4)
      .map(c => `${say(c.class)} ${pct(c.share)}${c.acres >= 0.1 ? ` (${c.acres} acres)` : ''}`)
      .join(', ') +
    '.' +
    (coverage < 0.995 ? ` ${cap(pct(coverage))} of it was read before the deadline.` : '') +
    (checks.length ? ` ${plural(checks.length, 'tile')} worth a second look.` : '');
  return {
    summary,
    area_m2: Math.round(m2),
    acres: m1(m2 / ACRE),
    hectares: r2(m2 / 1e4),
    classes,
    by_call: byCall,
    tiles: A.centres.length,
    tiles_read: A.tiles.filter(Boolean).length,
    coverage: r2(coverage),
    checks,
    sources: sourcesOf(R.flatMap(r => (r?.view ? [r.view] : []))),
    ...(detail === 'full'
      ? {
          tile_calls: R.map(r => ({
            point: { lat: r.station.lat, lon: r.station.lon },
            call: r.view ? callOf(r) : null,
          })),
        }
      : {}),
    ...wrap(so, false),
  };
}

/* ---- a spot's history ----------------------------------------------------- */
const top = (v: number[]) => v.indexOf(Math.max(...v));
export const HISTORY_CAVEAT =
  `Read from the pictures alone by the imagery classifier, which knows ${YEAR_CLASSES.length} classes ` +
  `(${YEAR_CLASSES.map(say).join(', ')}); shadows, seasons and parked cars can look like change. ` +
  'On eleven places with known histories it found 5 of 10 changes, flagged nothing at the five that ' +
  "didn't change, and flagged two that weren't there at one gravel lot.";

export function historyAnswer(got: History, p: LatLon, complete: boolean) {
  const H = got.h,
    n = H.caps.length;
  const captures = H.caps.map((c, t) => {
    const k = top(H.g[t]);
    return {
      date: c.date,
      provider: c.src ?? null,
      resolution_m: c.res ?? null,
      class: YEAR_CLASSES[k],
      p: r2(H.g[t][k]),
    };
  });
  const changes = H.flags.map(f => ({
    between: [H.caps[f.i].date, H.caps[f.i + 1].date],
    p: r2(f.p),
    was: f.from,
    became: f.to,
  }));
  const summary = n
    ? `${yearsWords(H)} ${n} capture${n === 1 ? '' : 's'}, ${monthYear(H.caps[0].date)} to ${monthYear(H.caps[n - 1].date)}.`
    : "Esri's archive has no picture of this spot that could be read.";
  const providers = [...new Set(H.caps.flatMap(c => (c.src ? [c.src] : [])))];
  return {
    summary,
    point: { lat: p.lat, lon: p.lon },
    captures,
    changes,
    tile_maps_asked: got.asked,
    link: linkAt(p),
    model: `imagery classifier v${IMG_MODEL.version}`,
    version: VERSION,
    as_of: new Date().toISOString(),
    complete,
    attribution:
      'World Imagery Wayback © Esri' + (providers.length ? `; pictures by ${providers.join(', ')}` : ''),
    caveat: HISTORY_CAVEAT,
  };
}
