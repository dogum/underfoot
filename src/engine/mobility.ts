/**
 * Go / slow / no-go (M5): how fast you could cross each station on foot, on an
 * ATV or in a truck, from what the ground probably is, how steep and rough it
 * is, how wet its soil is today, what's overhead and what the line crosses.
 * Pure.
 *
 * Each preset has a speed on good, level ground and a factor for each class.
 * Grade, steepness, roughness, wet soil, canopy and crossings scale a factor
 * or stop it. A station's speed is averaged over its class probabilities by
 * time, so a station that might be road or marsh is slow, not medium; the
 * chance that its ground stops you is kept apart. Every number, and where it
 * came from, is in docs/mobility.md.
 */
import { CIX, K } from '../core/classes';
import type { ClassKey } from '../core/types';

export type Preset = 'foot' | 'atv' | 'truck';
export type Band = 'go' | 'slow' | 'nogo';

export interface PresetDef {
  id: Preset;
  n: string;
  /** km/h moving on good, level ground */
  base: number;
  /** the share of that kept over a trip, stops included: walking times are matched to posted park times */
  pace: number;
  /** speed factor on each class; 0 stops it */
  surf: Record<ClassKey, number>;
  /** degrees: steeper ground than this stops it (on a built tread, the tread's own grade) */
  steep: number;
  /** m: ground rougher than this, off a tread, halves the speed */
  rough: number;
  /** factor on wet, poorly drained ground off a tread */
  wet: number;
  /** factor fording a stream, ditch or drain the line crosses */
  ford: number;
  /** tree canopy (%) off a tread above which trees are too close, and the factor then */
  canopy: [number, number];
  /** on a mapped path, its type sets the factor instead of the class (OSM keeps track, footway, steps apart) */
  tread: Record<string, number>;
}

const ALL = (o: Partial<Record<ClassKey, number>>) =>
  Object.fromEntries(K.map(k => [k, o[k] ?? 0])) as Record<ClassKey, number>;
const NARROW = { footway: 0, steps: 0, pedestrian: 0, corridor: 0, platform: 0 };

export const PRESETS: Record<Preset, PresetDef> = {
  foot: {
    id: 'foot',
    n: 'On foot',
    base: 5,
    pace: 0.75,
    surf: ALL({
      paved: 1,
      path: 1,
      grass: 0.85,
      bare: 0.8,
      rail: 0.8,
      crop: 0.7,
      forest: 0.6,
      scrub: 0.5,
      snow: 0.5,
      wetland: 0.35,
      building: 0.3,
    }),
    steep: 40,
    rough: Infinity,
    wet: 0.85,
    ford: 0.4,
    canopy: [101, 1],
    tread: { steps: 0.6 },
  },
  atv: {
    id: 'atv',
    n: 'ATV',
    base: 30,
    pace: 1,
    surf: ALL({
      paved: 1,
      path: 0.4,
      grass: 0.6,
      bare: 0.6,
      crop: 0.4,
      forest: 0.2,
      scrub: 0.3,
      snow: 0.3,
      wetland: 0.1,
    }),
    steep: 25,
    rough: 0.5,
    wet: 0.5,
    ford: 0.3,
    canopy: [60, 0.5],
    tread: { track: 0.6, path: 0.4, bridleway: 0.4, cycleway: 0.4, ...NARROW },
  },
  truck: {
    id: 'truck',
    n: 'Truck',
    base: 50,
    pace: 1,
    surf: ALL({ paved: 1, grass: 0.4, bare: 0.4, crop: 0.25, scrub: 0.1, snow: 0.15 }),
    steep: 20,
    rough: 0.4,
    wet: 0.4,
    ford: 0.2,
    canopy: [40, 0],
    tread: { track: 0.4, path: 0, bridleway: 0, cycleway: 0, ...NARROW },
  },
};
export const PRESET_IDS: Preset[] = ['foot', 'atv', 'truck'];

/** what's known at one station */
export interface GoingIn {
  /** the answer's probabilities, by class */
  p: ArrayLike<number>;
  /** rise over run along the line, in the direction it was drawn (0 for a point) */
  grade: number;
  /** degrees: the ground's own steepest slope (terrain), when known */
  slope: number | null;
  /** m: the ground's roughness (terrain), when known */
  rough: number | null;
  /** %: tree canopy overhead, when known (engine/overhead) */
  canopy: number | null;
  /** wet soil today on ground that drains poorly (or with no soil survey) */
  wet: boolean;
  /** the mapped path type the station is on (track, footway, steps…), if any */
  tread: string | null;
  /** what the line crosses here, if it's a crossing station */
  cross: { cls: ClassKey; what: string; over?: string } | null;
}
export interface Rating {
  /** km/h over the ground that lets you through; 0 when none does */
  v: number;
  /** probability that the ground here stops you */
  nogo: number;
  band: Band;
  /** plain words for what slows or stops it, most important first */
  why: string[];
}

/** Tobler's hiking function, relative to level ground: fastest on a slight descent */
export const tobler = (g: number) => {
  const x = Math.max(-1, Math.min(1, g));
  return Math.exp(-3.5 * Math.abs(x + 0.05)) / Math.exp(-3.5 * 0.05);
};
const DEG = 180 / Math.PI;
const TREADS = new Set<ClassKey>(['paved', 'path', 'rail']);
const FORD = /stream|ditch|drain|brook/i;
const pc = (v: number) => Math.round(v * 100) + '%';
/** what stops you, in plain words */
const STOPS: Record<ClassKey, string> = {
  building: 'a building',
  paved: 'pavement',
  path: 'a path',
  rail: 'the railway',
  forest: 'forest',
  scrub: 'scrub',
  grass: 'grass',
  crop: 'crops',
  water: 'water',
  wetland: 'wetland',
  bare: 'bare ground',
  snow: 'snow',
};

export function rateStation(s: GoingIn, preset: Preset): Rating {
  const P = PRESETS[preset],
    gradeDeg = Math.atan(Math.abs(s.grade)) * DEG;
  let go = 0,
    t = 0,
    nogo = 0;
  const stop = new Map<string, number>(),
    slow = new Map<string, number>(),
    /* time spent on each kind of ground, for when nothing else explains a slow speed */
    spent = new Map<string, number>();
  const note = (m: Map<string, number>, k: string, p: number) => m.set(k, (m.get(k) || 0) + p);
  for (const k of K) {
    const p = s.p[CIX[k]];
    if (!(p > 1e-4)) continue;
    /* built ground: a road, path or railway class, or anywhere on a mapped path, where the
       answer's other classes are doubt about the tread's surface, not the hillside beside it */
    const tread = TREADS.has(k) || !!s.tread;
    let f = P.surf[k];
    let stopWhy = STOPS[k];
    if (s.tread && P.tread[s.tread] != null && k === 'path') {
      f = P.tread[s.tread];
      stopWhy = `a ${s.tread === 'path' ? 'footpath' : s.tread}`;
    }
    if (k === 'water' && s.cross?.cls === 'water') {
      if (FORD.test(s.cross.what)) {
        f = P.ford;
        note(slow, `fording a ${s.cross.what.replace(' (intermittent)', '')}`, p);
      } else stopWhy = `the ${s.cross.what}, no bridge`;
    }
    if (f > 0) {
      /* on built ground only its grade counts; off it, the ground's own slope too */
      const steep = tread ? gradeDeg : Math.max(s.slope ?? 0, gradeDeg);
      if (steep > P.steep) {
        f = 0;
        stopWhy = `too steep (${Math.round(steep)}°)`;
      } else {
        if (preset === 'foot') {
          const r = tobler(s.grade);
          if (r < 0.7) note(slow, `a ${pc(Math.abs(s.grade))} ${s.grade > 0 ? 'climb' : 'descent'}`, p);
          f *= r;
        } else {
          const r = 1 - steep / (P.steep * 1.25);
          if (r < 0.6) note(slow, `a ${Math.round(steep)}° slope`, p);
          f *= r;
        }
        if (!tread) {
          if ((s.rough ?? 0) > P.rough) {
            f *= 0.5;
            note(slow, `rough ground (±${s.rough!.toFixed(2)} m)`, p);
          }
          if (s.wet) {
            f *= P.wet;
            note(slow, 'wet soil that drains poorly', p);
          }
          if ((s.canopy ?? 0) >= P.canopy[0]) {
            f *= P.canopy[1];
            if (f > 0) note(slow, `trees close together (canopy ${s.canopy}%)`, p);
            else stopWhy = `trees too close (canopy ${s.canopy}%)`;
          }
        }
      }
    }
    if (f > 0) {
      go += p;
      t += p / (P.base * P.pace * f);
      if (P.surf[k] < 0.7 || (k === 'path' && s.tread && (P.tread[s.tread] ?? 1) < 0.7))
        note(spent, stopWhy, p / f);
    } else {
      nogo += p;
      note(stop, stopWhy, p);
    }
  }
  const v = go > 0 ? go / t : 0;
  const band: Band = nogo >= 0.5 ? 'nogo' : v < 0.5 * P.base * P.pace || nogo >= 0.2 ? 'slow' : 'go';
  const ranked = (m: Map<string, number>, withP: boolean) =>
    [...m]
      .filter(([, p]) => p >= 0.1)
      .sort((a, b) => b[1] - a[1])
      .map(([k, p]) => (withP ? `${k} (${pc(p)})` : k));
  let why = [...ranked(stop, true), ...ranked(slow, false)];
  /* slow on the ground itself: name the ground the time goes to */
  if (band === 'slow' && !slow.size && spent.size)
    why = [...why, [...spent].sort((a, b) => b[1] - a[1])[0][0]];
  return { v, nogo, band, why: why.slice(0, 3) };
}

/** one stretch of a line where the ground stops this preset */
export interface Blocked {
  d0: number;
  d1: number;
  why: string;
}
export interface LineGoing {
  preset: Preset;
  /** m of the line it can travel, and the hours that takes */
  usable: number;
  hours: number;
  /** km/h over the usable part: its length over its time */
  smg: number | null;
  blocked: Blocked[];
  /** stations in each band */
  counts: Record<Band, number>;
}

/** a line's going for one preset; station i covers [B[i], B[i + 1]] (engine/report spanBounds) */
export function rateLine(B: number[], ratings: Rating[], preset: Preset): LineGoing {
  let usable = 0,
    hours = 0;
  const blocked: Blocked[] = [],
    counts: Record<Band, number> = { go: 0, slow: 0, nogo: 0 };
  ratings.forEach((r, i) => {
    const b0 = B[i],
      b1 = B[i + 1],
      m = Math.max(0, b1 - b0);
    counts[r.band]++;
    if (r.band === 'nogo') {
      const last = blocked.at(-1);
      if (last && Math.abs(last.d1 - b0) < 1e-6) last.d1 = b1;
      else blocked.push({ d0: b0, d1: b1, why: r.why[0]?.replace(/ \(\d+%\)$/, '') || 'the ground' });
    } else if (r.v > 0) {
      usable += m;
      hours += m / 1000 / r.v;
    }
  });
  return { preset, usable, hours, smg: hours > 0 ? usable / 1000 / hours : null, blocked, counts };
}
