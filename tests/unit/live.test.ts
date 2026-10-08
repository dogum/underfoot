/* Here: when a fix is read, which fixes go with it, what a recording keeps,
 * and the matcher's open end for a live track. */
import { describe, it, expect } from 'vitest';
import { followLines } from '../../src/engine/follow';
import { recentWindow, recordStep, shouldRead, trackLength, type Fix } from '../../src/engine/live';
import { at, line } from './scene';

const fix = (x: number, y: number, acc = 8, t = 0): Fix => ({ ...at(x, y), acc, t });

describe('reading fixes', () => {
  it('the first usable fix is read', () => expect(shouldRead(null, fix(0, 0))).toBe(true));
  it('standing still is not re-read: 5 m at ±8 m', () =>
    expect(shouldRead(fix(0, 0), fix(5, 0))).toBe(false));
  it('moving past the fix’s accuracy is', () => expect(shouldRead(fix(0, 0), fix(9, 0))).toBe(true));
  it('a sharp fix still waits for 3 m', () => expect(shouldRead(fix(0, 0, 1), fix(2, 0, 1))).toBe(false));
  it('a fix worse than ±50 m is never read', () => expect(shouldRead(null, fix(0, 0, 80))).toBe(false));
});

describe('the window behind the newest fix', () => {
  const track = Array.from({ length: 60 }, (_, i) => fix(i * 6, 0));
  it('reaches back 200 m', () => {
    const w = recentWindow(track);
    expect(w.at(-1)).toEqual(track.at(-1));
    expect(trackLength(w)).toBeGreaterThanOrEqual(200);
    expect(trackLength(w)).toBeLessThan(210);
  });
  it('skips fixes too rough to read', () => {
    const w = recentWindow([...track.slice(0, 50), fix(300, 0, 90), ...track.slice(50)]);
    expect(w.every(f => f.acc <= 50)).toBe(true);
  });
});

describe('recording', () => {
  it('keeps a fix that moved, drops one that jittered', () => {
    expect(recordStep([], fix(0, 0))).toBe(true);
    expect(recordStep([fix(0, 0)], fix(2, 0))).toBe(false);
    expect(recordStep([fix(0, 0)], fix(5, 0))).toBe(true);
  });
  it('a ±30 m fix needs 15 m to count', () => expect(recordStep([fix(0, 0)], fix(10, 0, 30))).toBe(false));
});

describe('the matcher on a live track', () => {
  /* a trail east–west; the walker's last four fixes land 18 m off it, as
     they do under a cliff, while still walking along it */
  const trail = line('transportation', { class: 'path', subclass: 'path' }, [
    [-300, 0],
    [300, 0],
  ]);
  const v = Array.from({ length: 40 }, (_, i) => at(-200 + i * 6, i > 35 ? 18 : 0));
  const L = trackLength(v);
  it('a finished line pays to end on the trail, so its last fixes may fall off', () => {
    const m = followLines(v, [trail]);
    expect(m.at(L)).toBe(-1);
  });
  it('a live track holds on: its newest fix is on the trail', () => {
    const m = followLines(v, [trail], { openEnd: true });
    expect(m.at(L)).toBe(0);
    expect(m.snap(v.at(-1)!, L)!.off).toBeCloseTo(18, 0);
  });
});
