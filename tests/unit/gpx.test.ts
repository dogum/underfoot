/* GPX out (io/gpx): the check list's waypoints, as GPX 1.1 in schema order. */
import { describe, it, expect } from 'vitest';
import { waypointsGpx } from '../../src/io/gpx';

const time = new Date('2026-10-08T09:42:17.250Z');
const gpx = waypointsGpx(
  { name: 'Underfoot check list', link: 'https://example.org/#m=path&v=1,2;3,4', time },
  [
    {
      lat: 37.7457981,
      lon: -119.5884729,
      name: '1 · Grass 49%',
      cmt: 'grass 49% or forest 48%',
      desc: 'Worth a look: the map says grass & "land cover" says forest <here>.',
      link: 'https://example.org/#m=path&v=1,2;3,4&at=343',
      linkText: 'Open station 24',
    },
    { lat: -12.5, lon: 130, name: '2' },
  ],
);

describe('GPX waypoints', () => {
  it('is GPX 1.1 with its namespace and schema', () => {
    expect(
      gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Underfoot"'),
    ).toBe(true);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
  });
  it('keeps the schema order: metadata first, then name, cmt, desc, link in each waypoint', () => {
    const at = (s: string) => gpx.indexOf(s);
    expect(at('<metadata>')).toBeLessThan(at('<wpt'));
    expect(at('<time>2026-10-08T09:42:17Z</time>')).toBeGreaterThan(at('<metadata>'));
    const w = gpx.slice(at('<wpt'), at('</wpt>'));
    const order = ['<name>', '<cmt>', '<desc>', '<link'].map(t => w.indexOf(t));
    expect(order.every(i => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('escapes text and links', () => {
    expect(gpx).toContain('the map says grass &amp; &quot;land cover&quot; says forest &lt;here&gt;.');
    expect(gpx).toContain(
      '<link href="https://example.org/#m=path&amp;v=1,2;3,4&amp;at=343"><text>Open station 24</text></link>',
    );
    expect(gpx.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toMatch(/&|<here>/);
  });
  it('writes coordinates to 7 decimals and leaves out empty notes', () => {
    expect(gpx).toContain('<wpt lat="37.7457981" lon="-119.5884729">');
    expect(gpx).toContain('<wpt lat="-12.5000000" lon="130.0000000">\n    <name>2</name>\n  </wpt>');
    expect(gpx.match(/<wpt /g)).toHaveLength(2);
  });
});
