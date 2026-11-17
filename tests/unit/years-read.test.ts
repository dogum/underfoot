/* The time machine's reading (sounding/years) against a stand-in Esri: a
 * capture whose metadata query fails once is asked again, not dropped. The
 * weekly canary lost one of Giga Texas's nine captures this way on days
 * Esri's metadata service was slow. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLATFORM } from '../../src/data/platform';
import { readHistory } from '../../src/sounding/years';

const fetch0 = globalThis.fetch,
  decode0 = PLATFORM.decode;
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const meta = (d: string) => ({
  features: [
    { attributes: { MinMapLevel: '16', MaxMapLevel: '19', SRC_DATE: d, SRC_RES: '0.3', NICE_DESC: 'Maxar' } },
  ],
});
/* a textured green tile, nothing like Esri's grey "no data" plate */
const tile = () => {
  const d = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < d.length; i += 4) {
    const v = (i / 4) % 7;
    d[i] = 40 + v * 5;
    d[i + 1] = 90 + v * 9;
    d[i + 2] = 30 + v * 3;
    d[i + 3] = 255;
  }
  return { data: d, width: 256, height: 256 };
};

let metaAsks: Record<string, number> = {};
beforeAll(() => {
  PLATFORM.decode = async () => tile();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.includes('waybackconfig.json'))
      return json({
        2: { itemTitle: 'World Imagery (Wayback 2024-03-01)', metadataLayerUrl: 'https://meta.test/2' },
        1: { itemTitle: 'World Imagery (Wayback 2021-03-01)', metadataLayerUrl: 'https://meta.test/1' },
      });
    if (u.includes('/tilemap/')) return json({ data: [1] });
    const m = /meta\.test\/(\d)\/5\/query/.exec(u);
    if (m) {
      const n = (metaAsks[m[1]] = (metaAsks[m[1]] || 0) + 1);
      /* release 2's metadata fails the first time it's asked */
      if (m[1] === '2' && n === 1) return json({ error: 'slow' }, 504);
      return json(meta(m[1] === '2' ? '20240115' : '20201110'));
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer, { status: 200 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = fetch0;
  PLATFORM.decode = decode0;
});

describe('reading a spot’s history', () => {
  it('a capture whose metadata fails once is asked again and kept', async () => {
    metaAsks = {};
    const H = await readHistory(30.2222, -97.617);
    expect(H).not.toBeNull();
    expect(metaAsks).toEqual({ 1: 1, 2: 2 });
    expect(H!.found).toBe(2);
    expect(H!.h.caps.map(c => c.date)).toEqual(['2020-11-10', '2024-01-15']);
  });
});
