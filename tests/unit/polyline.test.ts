/* Lines in links: the encoding round-trips, stays URL-safe and short, and the
 * simplification keeps a line's shape to within a metre. */
import { describe, it, expect } from 'vitest';
import { haversine, offset, projector, segD2 } from '../../src/core/geo';
import { decodeLine, encodeLine, linkLine, simplifyLine } from '../../src/core/polyline';
import type { LatLon } from '../../src/core/types';

const O = { lat: 37.7267, lon: -119.5444 };
/* a hiker's track: 1,200 fixes 5 m apart, winding, with half a metre of jitter */
const track: LatLon[] = Array.from({ length: 1200 }, (_, i) =>
  offset(O, i * 5 * 0.8 + 40 * Math.sin(i / 30), 60 * Math.sin(i / 70) + 0.4 * Math.sin(i * 2.7)),
);
/** how far each original point is from the simplified line, at most (m) */
function maxOff(orig: LatLon[], simple: LatLon[]) {
  const P = projector(O.lat, O.lon),
    xy = simple.map(p => P.fwd(p.lat, p.lon));
  let worst = 0;
  for (const p of orig) {
    const [x, y] = P.fwd(p.lat, p.lon);
    let best = Infinity;
    for (let k = 0; k + 1 < xy.length; k++) best = Math.min(best, segD2(x, y, ...xy[k], ...xy[k + 1]));
    worst = Math.max(worst, Math.sqrt(best));
  }
  return worst;
}

describe('encoded lines', () => {
  it('round-trip to a tenth of a metre, south and west included', () => {
    const pts = [
      { lat: 37.74856, lon: -119.58683 },
      { lat: -33.856812, lon: 151.215312 },
      { lat: 0, lon: 0 },
    ];
    const back = decodeLine(encodeLine(pts))!;
    back.forEach((p, i) => expect(haversine(p, pts[i])).toBeLessThan(0.15));
  });
  it('use only URL-safe characters', () => expect(encodeLine(track)).toMatch(/^[A-Za-z0-9_-]+$/));
  it('reject a string that is not a line', () => {
    expect(decodeLine('not a line!')).toBeNull();
    expect(decodeLine('A')).toBeNull();
  });
  it('cost about four characters a point for a GPS track', () =>
    expect(encodeLine(track).length / track.length).toBeLessThan(5));
});

describe('simplified lines', () => {
  const s = simplifyLine(track, 1);
  it('drop most of a GPS track’s points', () => expect(s.length).toBeLessThan(track.length / 2));
  it('stay within a metre of every original point', () => expect(maxOff(track, s)).toBeLessThan(1.05));
  it('keep the ends', () => {
    expect(s[0]).toEqual(track[0]);
    expect(s.at(-1)).toEqual(track.at(-1));
  });
  it('a straight line becomes its two ends', () =>
    expect(simplifyLine([O, offset(O, 50, 0), offset(O, 100, 0)], 1)).toHaveLength(2));
  it('a link line fits its cap however long the track', () => {
    const l = linkLine(track, 100);
    expect(l.length).toBeLessThanOrEqual(100);
    expect(maxOff(track, l)).toBeLessThan(20);
  });
});
