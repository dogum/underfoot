/**
 * What an agent gets back: one envelope around every tool's answer. The call
 * never travels alone: its probability, the runners-up and the doubt in
 * words come with it, which sources spoke and which didn't, a link that
 * reopens the sounding in the web app, and the credit the data asks for.
 * Pure: built from a finished headless run.
 */
import { K, NAME, VERSION } from '../core/classes';
import { encodeLine, linkLine } from '../core/polyline';
import { SITE_URL } from '../core/project';
import { DOUBT_AT, doubtWords } from '../engine/doubt';
import { PRESET_IDS } from '../engine/mobility';
import type { Preset } from '../engine/mobility';
import { PHRASE } from '../engine/narrate';
import { overhead } from '../engine/overhead';
import { CROSSED, routeReport, spanBounds } from '../engine/report';
import type { Sounding } from '../headless/sound';
import type { Run } from '../sounding/run';
import type { ClassKey, Fused, LatLon, SourceId, StationResult } from '../core/types';

export type Detail = 'brief' | 'full';
const r2 = (v: number) => Math.round(v * 100) / 100;
const m1 = (v: number) => Math.round(v * 10) / 10;
const pct = (p: number) => Math.round(p * 100) + '%';
const say = (k: ClassKey) => NAME[k].toLowerCase();

export interface Call {
  class: ClassKey;
  p: number;
  runners_up: { class: ClassKey; p: number }[];
  /** 1 − entropy / its maximum: the app's gauge */
  confidence: number;
  doubt: { score: number; worth_checking: boolean; why: string };
}
/** a station's answer, with its doubt in words */
export function callOf(r: StationResult): Call | null {
  const f = r.view;
  if (!f) return null;
  const d = r.doubt;
  return {
    class: f.top,
    p: r2(f.topP),
    runners_up: f.order.slice(1, 3).map(i => ({ class: K[i], p: r2(f.p[i]) })),
    confidence: r2(f.conf),
    doubt: {
      score: r2(d?.score ?? 0),
      worth_checking: (d?.score ?? 0) >= DOUBT_AT,
      why: d && d.score >= DOUBT_AT ? doubtWords(d, f) : '',
    },
  };
}

/** why a source isn't in the answer, as an agent can quote it */
const MISSING: Record<string, string> = {
  na: 'no coverage here',
  err: 'failed',
  wait: 'timed out',
  quiet: 'had nothing to say',
};
export function sourcesOf(fs: Fused[]) {
  const used = new Set<SourceId>(),
    why = new Map<SourceId, string>(),
    order: SourceId[] = [];
  for (const f of fs)
    for (const l of f.ledger || []) {
      if (!order.includes(l.id)) order.push(l.id);
      if (l.status === 'ok') used.add(l.id);
      else if (!why.has(l.id)) why.set(l.id, MISSING[l.status] || l.status);
    }
  return {
    used: order.filter(id => used.has(id)),
    missing: order.filter(id => !used.has(id)).map(id => ({ id, why: why.get(id)! })),
  };
}
/** every source's reading, for detail "full" */
export const ledgerOf = (f: Fused) =>
  (f.ledger || []).map(l => ({
    id: l.id,
    status: l.status,
    bits: r2(l.bits),
    weight: r2(l.w),
    note: l.note || '',
  }));

/** the web app's link for the same sounding, as its URL hash spells it (io/hash) */
export function linkOf(run: Run): string {
  const v = run.verts,
    line =
      v.length > 12
        ? 'p=' + encodeLine(linkLine(v, 1500))
        : 'v=' + v.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(';');
  return `${SITE_URL}#m=${run.mode}&s=${run.spacing}${run.follow ? '' : '&f=0'}&${line}`;
}

/** the credit each source asks for, as the map shows it (map/credit) and the README lists it */
const CREDIT: Partial<Record<SourceId, string>> = {
  contain: '© OpenStreetMap contributors (ODbL), via OpenFreeMap',
  prox: '© OpenStreetMap contributors (ODbL), via OpenFreeMap',
  image: 'Imagery © Esri, Maxar, Earthstar Geographics',
  struct: 'FEMA USA Structures',
  cover: 'NLCD 2021 (MRLC, USGS)',
  canopy: 'NLCD 2021 (MRLC, USGS)',
  gaz: 'Nominatim, © OpenStreetMap contributors',
  today: 'Open-Meteo (CC BY 4.0)',
  pass: 'contains modified Copernicus Sentinel data, via Earth Search',
  world: 'land cover: Impact Observatory, Microsoft, Esri',
};
export function attributionOf(run: Run, going: boolean): string {
  const out = new Set<string>();
  for (const r of run.results) {
    for (const l of r.view?.ledger || []) if (l.status === 'ok' && CREDIT[l.id]) out.add(CREDIT[l.id]!);
    const src = r.sh.terr?.src || '';
    if (/3DEP/.test(src)) out.add('elevation: USGS 3DEP');
    else if (/^Terrain Tiles/.test(src))
      out.add('elevation: Terrain Tiles (Mapzen on AWS; SRTM courtesy of the USGS)');
    else if (/Open-Meteo/.test(src)) out.add('elevation: Open-Meteo (CC BY 4.0)');
    if (going && r.sh.soil) out.add('soils: USDA NRCS Soil Survey');
  }
  return [...out].join(' · ');
}

export const CAVEAT =
  'Calibrated opinion, not measurement. Imagery can be years old, and accuracy is lower outside the contiguous US.';

/** what wraps every answer */
function wrap(so: Sounding, going: boolean) {
  return {
    link: linkOf(so.run),
    weights: so.weights.label,
    version: VERSION,
    as_of: new Date().toISOString(),
    complete: so.complete,
    attribution: attributionOf(so.run, going),
    caveat: CAVEAT,
  };
}

/* ---- a point ------------------------------------------------------------- */
export function pointAnswer(so: Sounding, opt: { detail?: Detail; going?: Preset[] } = {}) {
  const r = so.run.results[0],
    f = r?.view,
    call = r && callOf(r);
  if (!r || !f || !call) throw new Error('no answer for that point');
  const place = r.sh.nom && !r.sh.nom.error ? r.sh.nom.display_name || null : null,
    over = overhead(r.sh, r.q, f.top),
    going = goingAt(so.run, 0, opt.going),
    gps = so.gps.applied ? ` with GPS ±${so.gps.m} m` : '';
  const summary =
    `${cap(PHRASE[f.top])}, ${pct(f.topP)}${gps}${place ? ` (${short(place)})` : ''}; then ${say(K[f.order[1]])} ${pct(f.p[f.order[1]])}.` +
    (call.doubt.worth_checking ? ` Worth a second look: ${call.doubt.why}.` : '');
  return {
    summary,
    point: { lat: r.station.lat, lon: r.station.lon },
    call,
    place,
    overhead: over ? over.text : null,
    gps_accuracy_m: so.gps.applied ? so.gps.m : 0,
    ...(going ? { going } : {}),
    sources: sourcesOf([f]),
    ...(opt.detail === 'full' ? { ledger: ledgerOf(f), facts: factsOf(r) } : {}),
    ...wrap(so, !!going),
  };
}

/** go / slow / no-go at a station, per preset asked for */
function goingAt(run: Run, i: number, presets?: Preset[]) {
  if (!presets?.length || !run.going) return null;
  const out: Partial<Record<Preset, { km_h: number; band: string; why: string }>> = {};
  for (const p of presets) {
    const g = run.going.st[p]?.[i];
    if (g) out[p] = { km_h: m1(g.v), band: g.band, why: g.why.join('; ') };
  }
  return out;
}
/** what the data layer read at a station, for detail "full" */
function factsOf(r: StationResult) {
  const sh = r.sh;
  return {
    elevation_m: sh.terr ? m1(sh.terr.z) : null,
    slope_deg: sh.terr ? m1(sh.terr.slope) : null,
    canopy_pct: sh.nlcd?.canopy ?? null,
    impervious_pct: sh.nlcd?.imperv ?? null,
    nlcd: sh.nlcd?.name ?? null,
    photo_date: sh.imeta?.date ?? null,
    snow_m: sh.today?.snow ?? null,
    newest_pass: sh.pass ? sh.pass.date : null,
  };
}

/* ---- a line -------------------------------------------------------------- */
export function pathAnswer(so: Sounding, opt: { detail?: Detail; going?: Preset[] } = {}) {
  const run = so.run,
    R = run.results;
  const rep = routeReport(
    run.stations,
    R.map(r => r?.view && { top: r.view.top, topP: r.view.topP, conf: r.view.conf, doubt: r.doubt?.score }),
    run.profile,
    run.stations.map((s, i) => (s.x ? R[i]?.q?.best[s.x.cls]?.name : null)),
  );
  const runs = groundRuns(run, rep.length);
  const going = lineGoing(run, opt.going),
    shares = rep.classes.map(c => ({ class: c.cls, m: Math.round(c.m), share: r2(c.share) })),
    follows = run.stretches.map(s => ({
      from_m: Math.round(s.d0),
      to_m: Math.round(s.d1),
      what: s.what,
      name: s.name,
    })),
    checks = rep.checks.map(c => {
      const s = run.stations[c.i];
      return { at_m: Math.round(c.d), point: { lat: s.lat, lon: s.lon }, class: c.top, doubt: r2(c.score) };
    });
  const crossed = rep.crossings.map(
    c => `${c.n} ${(CROSSED[c.cls] || [say(c.cls), say(c.cls)])[c.n === 1 ? 0 : 1]}`,
  );
  const summary =
    `A ${km(rep.length)} line: ${shares
      .slice(0, 3)
      .map(s => `${say(s.class)} ${pct(s.share)}`)
      .join(', ')}.` +
    (follows.length
      ? ` Follows ${follows[0].name || 'a mapped ' + follows[0].what} for ${km(follows.reduce((a, s) => a + s.to_m - s.from_m, 0))}.`
      : '') +
    (crossed.length ? ` Crosses ${crossed.join(', ')}.` : '') +
    (checks.length ? ` ${checks.length} spot${checks.length === 1 ? '' : 's'} worth a look.` : '');
  return {
    summary,
    length_m: Math.round(rep.length),
    climb_m: rep.climb == null ? null : Math.round(rep.climb),
    descent_m: rep.descent == null ? null : Math.round(rep.descent),
    steepest: rep.steepest
      ? {
          grade: r2(rep.steepest.grade),
          from_m: Math.round(rep.steepest.d0),
          to_m: Math.round(rep.steepest.d1),
        }
      : null,
    shares,
    runs,
    follows,
    crossings: rep.crossings.map(c => ({ class: c.cls, count: c.n, names: c.names })),
    checks,
    ...(going ? { going } : {}),
    sources: sourcesOf(R.flatMap(r => (r?.view ? [r.view] : []))),
    ...(opt.detail === 'full'
      ? {
          stations: run.stations.map((s, i) => ({
            lat: s.lat,
            lon: s.lon,
            at_m: Math.round(s.d),
            crossing: s.x ? s.x.what : null,
            call: R[i] ? callOf(R[i]) : null,
          })),
        }
      : {}),
    ...wrap(so, !!going),
  };
}

/** the ground along a line as runs of one call: crossings are left out, since they're listed on their own */
export function groundRuns(run: Run, L: number) {
  const idx = run.stations.flatMap((s, i) => (!s.x && run.results[i]?.view ? [i] : []));
  if (!idx.length) return [];
  const B = spanBounds(idx.map(i => run.stations[i]));
  B[0] = 0;
  B[B.length - 1] = L;
  const out: { class: ClassKey; from: number; to: number; ps: number[] }[] = [];
  idx.forEach((i, k) => {
    const v = run.results[i].view!,
      last = out[out.length - 1];
    if (last && last.class === v.top) {
      last.to = B[k + 1];
      last.ps.push(v.topP);
    } else out.push({ class: v.top, from: B[k], to: B[k + 1], ps: [v.topP] });
  });
  return out.map(x => ({
    class: x.class,
    from_m: Math.round(x.from),
    to_m: Math.round(x.to),
    p_mean: r2(x.ps.reduce((a, b) => a + b, 0) / x.ps.length),
  }));
}

/** the line summed per preset: how far it can go, how long that takes, what stops it */
function lineGoing(run: Run, presets?: Preset[]) {
  const line = run.going?.line;
  if (!presets?.length || !line) return null;
  const out: Partial<Record<Preset, unknown>> = {};
  for (const p of presets.filter(x => PRESET_IDS.includes(x))) {
    const l = line[p];
    out[p] = {
      usable_m: Math.round(l.usable),
      hours: r2(l.hours),
      km_h: l.smg == null ? null : m1(l.smg),
      blocked: l.blocked.map(b => ({ from_m: Math.round(b.d0), to_m: Math.round(b.d1), why: b.why })),
    };
  }
  return out;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const short = (place: string) => place.split(',').slice(0, 2).join(',').trim();
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export const pointOf = (p: LatLon) => ({ lat: p.lat, lon: p.lon });
