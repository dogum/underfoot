/* Crossings: where a line crosses a mapped road, path or stream it gets a
 * station of its own. A river crossed on a bridge is crossed on the deck.
 * Synthetic scenes in local metres. No network, runs in Node. */
import { describe, it, expect } from 'vitest';
import { CIX, PRIORS, SOURCES } from '../../src/core/classes';
import { findCrossings } from '../../src/app/stations';
import { followLines } from '../../src/engine/follow';
import { computeParts, fuseParts, DEFAULT_NEFF } from '../../src/engine/fuse';
import { buildGeo, geoAt } from '../../src/engine/geometry';
import { at, box, line } from './scene';

/* a river running north–south through x = 0, 30 m wide */
const river = [
  line('waterway', { class: 'river' }, [
    [0, -300],
    [0, 300],
  ]),
  box('water', { class: 'river' }, -15, -300, 15, 300),
];
const bridge = (p: Record<string, any>, y = 0) =>
  line('transportation', { brunnel: 'bridge', ...p }, [
    [-20, y],
    [20, y],
  ]);
const footbridge = bridge({ class: 'path', subclass: 'footway' });
/* a line drawn east–west across the river at height y */
const across = (y: number) => [at(-60, y), at(60, y)];
const kinds = (c: { cls: string; what: string }[]) => c.map(x => `${x.cls}:${x.what}`);

describe('a river crossed on a bridge', () => {
  it('a line over a footbridge crosses the river on the deck: path, not water', () => {
    const c = findCrossings(across(0), [...river, footbridge]);
    expect(kinds(c)).toEqual(['path:bridge']);
    expect(c[0].over).toBe('river');
  });
  it('a line over a road bridge reads the road', () => {
    const c = findCrossings(across(1), [...river, bridge({ class: 'minor' })]);
    expect(kinds(c)).toEqual(['paved:bridge']);
  });
  it('a line 20 m downstream of the bridge crosses the water', () => {
    expect(kinds(findCrossings(across(20), [...river, footbridge]))).toEqual(['water:river']);
  });
  it('a ford is crossed in the water', () => {
    const ford = line('transportation', { class: 'path', subclass: 'path', brunnel: 'ford' }, [
      [-20, 0],
      [20, 0],
    ]);
    expect(kinds(findCrossings(across(0), [...river, ford]))).toEqual(['water:river']);
  });
  it('a trail followed over its bridge reads path all the way, with no water station', () => {
    const trail = line('transportation', { class: 'path', subclass: 'path' }, [
      [-300, 0],
      [-20, 0],
    ]);
    const trail2 = line('transportation', { class: 'path', subclass: 'path' }, [
      [20, 0],
      [300, 0],
    ]);
    const feats = [...river, trail, footbridge, trail2],
      v = Array.from({ length: 98 }, (_, i) => at(-290 + i * 6, 2 * Math.sin(i))),
      fol = followLines(v, feats);
    expect(fol.stretches.map(s => s.cls)).toEqual(['path']);
    expect(findCrossings(v, feats, fol).filter(c => c.cls === 'water')).toHaveLength(0);
  });
});

describe('fusion on the deck', () => {
  const W = Object.fromEntries(SOURCES.map(s => [s.id, s.w]));
  const opt = { weights: W, neff: DEFAULT_NEFF, prior: PRIORS.probed };
  const facts = {
    conus: true,
    inUS: true,
    structOk: true,
    nlcd: { code: 11, name: 'Open water', canopy: 0, imperv: 0, desc: 0, descName: null },
    nom: null,
    imgWmul: 1,
  };
  const q = () => geoAt(buildGeo(at(0, 0), [...river, footbridge], [], 170), 0, 0, true);
  it('mid-river, a station with no crossing reads water', () => {
    expect(fuseParts(computeParts(facts, q(), null), opt).top).toBe('water');
  });
  it('the bridge crossing station reads path, and says it is on the deck', () => {
    const g = Object.assign(q(), { crossing: 'path' as const, over: 'river' });
    const parts = computeParts(facts, g, null),
      f = fuseParts(parts, opt);
    expect(f.top).toBe('path');
    expect(f.p[CIX.path]).toBeGreaterThan(0.9);
    expect(parts.prox!.note).toMatch(/crosses the river on a footway bridge/);
  });
});
