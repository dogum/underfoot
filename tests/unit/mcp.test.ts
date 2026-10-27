/* The MCP server: tracks read from text, the envelope's parts, and the point
 * and path tools end to end through the SDK's client, on soundings made here
 * without the network (tests/unit/mcp-scene). The longer jobs are in
 * mcp-jobs.test.ts. */
import { describe, expect, it } from 'vitest';
import { newRun } from '../../src/headless/sound';
import { attributionOf, groundRuns, linkOf, sourcesOf } from '../../src/mcp/envelope';
import { readTrack } from '../../src/mcp/track';
import { connect, fake } from './mcp-scene';
import { at } from './scene';
import type { Fused } from '../../src/core/types';

describe('a track handed over as text', () => {
  it('reads GPX track points, attributes in either order, and route points when there are none', () => {
    const gpx =
      '<gpx><trk><trkseg><trkpt lon="-119.5" lat="37.7"/><trkpt lat="37.8" lon="-119.6"><ele>1</ele></trkpt></trkseg></trk></gpx>';
    expect(readTrack(gpx)).toEqual([
      { lat: 37.7, lon: -119.5 },
      { lat: 37.8, lon: -119.6 },
    ]);
    expect(readTrack('<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"/></rte></gpx>')).toHaveLength(
      2,
    );
  });
  it('reads GeoJSON lines in a feature collection, [lon, lat] turned round, and drops impossible points', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [2, 1],
                [4, 3],
              ],
              [
                [6, 5],
                [400, 5],
              ],
            ],
          },
        },
      ],
    };
    expect(readTrack(JSON.stringify(fc))).toEqual([
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
      { lat: 5, lon: 6 },
    ]);
  });
});

describe('the envelope', () => {
  const so = fake({ mode: 'path', verts: [at(-200, -50), at(200, 50)] });
  it('lays the ground out as runs end to end, the path it crosses left to the crossings', () => {
    expect(so.run.stations.some(s => s.x?.cls === 'path')).toBe(true);
    const runs = groundRuns(so.run, 412);
    expect(runs.map(r => r.class)).toEqual(['grass']);
    expect([runs[0].from_m, runs[0].to_m]).toEqual([0, 412]);
  });
  it('names the sources that spoke and why the others did not, across every station', () => {
    const led = (ok: string[], na: string[]) =>
      ({
        ledger: [...ok.map(id => ({ id, status: 'ok' })), ...na.map(id => ({ id, status: 'na' }))],
      }) as unknown as Fused;
    const s = sourcesOf([led(['contain'], ['world']), led(['contain', 'world'], [])]);
    expect(s.used).toEqual(['contain', 'world']);
    expect(s.missing).toEqual([]);
    expect(sourcesOf([led(['contain'], ['world'])]).missing).toEqual([
      { id: 'world', why: 'no coverage here' },
    ]);
  });
  it("links back to the web app as the app's own link spells it", () => {
    expect(linkOf(so.run)).toMatch(
      /^https:\/\/dogum\.github\.io\/underfoot\/#m=path&s=auto&v=37\.\d{6},-119\.\d{6};/,
    );
    const long = newRun({ mode: 'path', verts: Array.from({ length: 30 }, (_, i) => at(i * 10, i % 2)) });
    expect(linkOf(long)).toContain('&p=');
  });
  it('credits the sources that answered', () => {
    const a = attributionOf(so.run, false);
    expect(a).toContain('OpenStreetMap');
    expect(a).toContain('Terrain Tiles');
  });
});

describe('the server', () => {
  it('offers five read-only tools and three resources', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map(t => t.name)).toEqual([
      'underfoot_point',
      'underfoot_path',
      'underfoot_points',
      'underfoot_area',
      'underfoot_history',
    ]);
    expect(tools.every(t => t.annotations?.readOnlyHint && t.outputSchema)).toBe(true);
    const { resources } = await c.listResources();
    expect(resources.map(r => r.uri)).toEqual([
      'underfoot://classes',
      'underfoot://sources',
      'underfoot://method',
    ]);
    const cls = await c.readResource({ uri: 'underfoot://classes' });
    expect(JSON.parse((cls.contents[0] as { text: string }).text)).toHaveLength(12);
  });
  it('answers a point with the call, its doubt, its sources and a link, as its schema says', async () => {
    const c = await connect();
    const r = await c.callTool({
      name: 'underfoot_point',
      arguments: { point: at(0, 100), going: ['foot'] },
    });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.call.class).toBe('building');
    expect(s.call.runners_up).toHaveLength(2);
    expect(s.summary).toMatch(/^Inside a building footprint, \d+%/);
    expect(s.going.foot.band).toBeDefined();
    expect(s.link).toContain('#m=point');
    expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual(s);
  });
  it('answers a line with its runs, crossings and checks', async () => {
    const c = await connect();
    const r = await c.callTool({
      name: 'underfoot_path',
      arguments: { points: [at(-200, -50), at(200, 50)], detail: 'full' },
    });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.length_m).toBeGreaterThan(400);
    expect(s.crossings[0]).toMatchObject({ class: 'path', count: 1, names: ['Meadow Path'] });
    expect(s.summary).toContain('Crosses 1 path.');
    expect(s.stations.length).toBeGreaterThan(40);
  });
  it('says what a route needs when it gets too little', async () => {
    const c = await connect();
    const r = await c.callTool({ name: 'underfoot_path', arguments: { track: '<gpx></gpx>' } });
    expect(r.isError).toBe(true);
  });
});
