/* The MCP server's longer jobs, end to end through the SDK's client on the
 * scene (tests/unit/mcp-scene): many points, an area, a spot's history; the
 * progress each reports, and a cancel that stops the requests. */
import { describe, expect, it } from 'vitest';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { readYears } from '../../src/engine/years';
import type { Capture } from '../../src/engine/years';
import { soundPoints } from '../../src/headless/batch';
import { readOutline } from '../../src/mcp/track';
import type { History } from '../../src/sounding/years';
import { connect, fake } from './mcp-scene';
import { at } from './scene';
import type { SoundRequest } from '../../src/headless/sound';

/* a grid of points over the meadow, the path and the house, 40 m apart */
const grid = Array.from({ length: 100 }, (_, k) => ({ ...at(-200 + (k % 10) * 40, -200 + (k / 10) * 40) }));
const square = (h: number, y = 0) => [at(-h, y - h), at(h, y - h), at(h, y + h), at(-h, y + h)];

describe('many points', () => {
  it('reads nearby points in groups and keeps each row in the order given', async () => {
    const asked: number[] = [];
    const pr = await soundPoints({ points: grid }, async r => {
      asked.push(r.verts.length);
      expect(r.mode).toBe('batch');
      return fake(r);
    });
    expect(asked).toEqual([40, 40, 20]);
    expect(pr.read).toBe(3);
    expect(pr.complete).toBe(true);
    expect(pr.rows.every(Boolean)).toBe(true);
    /* the point at the house is read as the house wherever its group put it */
    const house = soundPoints({ points: [at(-150, -150), at(0, 100)] }, async r => fake(r));
    expect((await house).rows[1]!.call).toBe('building');
  });
  it('answers with every row, the counts and the points worth a look, and reports each group', async () => {
    const c = await connect(),
      seen: number[] = [];
    const r = await c.callTool(
      {
        name: 'underfoot_points',
        arguments: { points: [{ ...at(0, 100), name: 'the house' }, ...grid] },
      },
      CallToolResultSchema,
      { onprogress: p => seen.push(p.progress) },
    );
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.count).toBe(101);
    expect(s.read).toBe(101);
    expect(s.rows).toHaveLength(101);
    expect(s.rows[0]).toMatchObject({ name: 'the house', class: 'building' });
    expect(s.calls.reduce((a: number, x: { n: number }) => a + x.n, 0)).toBe(101);
    expect(s.summary).toMatch(/^101 points read: /);
    expect(s.attribution).toContain('OpenStreetMap');
    expect(seen.slice(-3)).toEqual([1, 2, 3]);
  });
  it('stops between groups when the client cancels', async () => {
    let calls = 0;
    const c = await connect({
      sound: async (r: SoundRequest) => {
        calls++;
        await new Promise(z => setTimeout(z, 150));
        return fake(r);
      },
    });
    const stop = new AbortController();
    const call = c.callTool(
      {
        name: 'underfoot_points',
        arguments: { points: [...grid, ...grid.map(p => ({ ...p, lat: p.lat + 1 }))] },
      },
      CallToolResultSchema,
      { signal: stop.signal, onprogress: p => p.progress >= 1 && stop.abort() },
    );
    await expect(call).rejects.toThrow();
    /* six groups of 150 ms each: long enough for every one of them, had it gone on; a group is
       long enough that the cancel lands during the second even on a busy machine */
    await new Promise(z => setTimeout(z, 1000));
    expect(calls).toBeLessThanOrEqual(2);
  });
});

describe('an area', () => {
  it('reads an outline from GeoJSON, without its closing vertex', () => {
    const ring = [...square(100), square(100)[0]].map(p => [p.lon, p.lat]);
    const gj = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } };
    expect(readOutline(JSON.stringify(gj))).toHaveLength(4);
  });
  it('sums the tiles into acres per class, by probability and by call, and reports each tile', async () => {
    const c = await connect(),
      seen: number[] = [];
    const r = await c.callTool(
      { name: 'underfoot_area', arguments: { outline: square(100, 50) } },
      CallToolResultSchema,
      { onprogress: p => seen.push(p.progress) },
    );
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.hectares).toBeCloseTo(4, 1);
    expect(s.tiles).toBe(4);
    expect(s.coverage).toBe(1);
    expect(s.classes[0].class).toBe('grass');
    const share = (k: string) => s.by_call.find((x: { class: string }) => x.class === k)?.share ?? 0;
    /* the house's 20 m square and the path's line, in a 200 m square (a footprint's edge cells blur into what's around it) */
    expect(share('building')).toBeGreaterThan(0.005);
    expect(share('building')).toBeLessThan(0.03);
    /* a 2 m footway is never any cell's call, but it holds its share of the probability */
    expect(s.classes.find((x: { class: string }) => x.class === 'path').share).toBeGreaterThan(0);
    expect(s.classes.reduce((a: number, x: { share: number }) => a + x.share, 0)).toBeCloseTo(1, 1);
    expect(s.summary).toMatch(/^9\.9 acres \(4 ha\): grass 8\d%/);
    expect(s.link).toContain('#m=area');
    expect(seen.slice(-4)).toEqual([1, 2, 3, 4]);
  });
  it('says how big an outline may be when it gets one too big', async () => {
    const c = await connect();
    const r = await c.callTool({ name: 'underfoot_area', arguments: { outline: square(1000) } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/takes \d+ tiles of 120 m and the most is 64/);
  });
});

describe("a spot's history", () => {
  /* grass for three captures, then bare ground under construction */
  const cap = (date: string, k: number): Capture => ({
    date,
    rel: 1,
    src: 'Maxar',
    res: 0.3,
    p: Array.from({ length: 9 }, (_, c) => (c === k ? 0.9 : 0.1 / 8)),
  });
  const caps = [
    cap('2014-03-01', 2),
    cap('2016-05-01', 2),
    cap('2018-04-01', 2),
    cap('2020-06-01', 6),
    cap('2022-07-01', 6),
  ];
  const got: History = { asked: 12, found: 5, h: readYears(caps), pictures: [] };
  it('lists the captures and the change, in words an agent can quote, and reports each capture', async () => {
    const c = await connect({
      history: async (lat, lon, hooks) => {
        hooks.found?.(12, 5);
        for (let i = 0; i < 5; i++) hooks.read?.();
        return got;
      },
    });
    const seen: number[] = [];
    const r = await c.callTool(
      { name: 'underfoot_history', arguments: { point: at(0, 0) } },
      CallToolResultSchema,
      { onprogress: p => seen.push(p.progress) },
    );
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.captures).toHaveLength(5);
    expect(s.changes).toEqual([
      { between: ['2018-04-01', '2020-06-01'], p: expect.any(Number), was: ['grass'], became: ['bare'] },
    ]);
    expect(s.summary).toMatch(/^Changed between Apr 2018 and Jun 2020: grass → bare ground/);
    expect(s.summary).toContain('5 captures, Mar 2014 to Jul 2022.');
    expect(s.attribution).toContain('Maxar');
    expect(seen.slice(-5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('says so when the archive is too slow', async () => {
    const c = await connect({ history: async () => null });
    const r = await c.callTool({ name: 'underfoot_history', arguments: { point: at(0, 0) } });
    expect(r.isError).toBe(true);
  });
});
