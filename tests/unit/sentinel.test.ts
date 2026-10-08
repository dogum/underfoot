/* The newest Sentinel-2 pass (data/sentinel, engine/sentinel): finding the
 * scenes, reading a station's pixel through cloud to an older pass, and the
 * class as evidence, fading with age and outweighing the weather model. */
import { describe, it, expect, afterAll } from 'vitest';
import { CIX } from '../../src/core/classes';
import { toUTM } from '../../src/core/utm';
import { parseScenes, passFor, pixelOf } from '../../src/data/sentinel';
import { PASS_AGE, clearOfSnow, passWeight, srcPass } from '../../src/engine/sentinel';
import { srcToday } from '../../src/engine/today';
import { buildTiff, rangeFetch } from './tiff';
import type { PassFacts, TodayFacts } from '../../src/core/types';

const AT = { lat: 37.745046, lon: -119.589358 };
const u = toUTM(AT.lat, AT.lon, 11),
  x0 = Math.floor(u.x / 20) * 20 - 40,
  y0 = Math.ceil(u.y / 20) * 20 + 40;
const feature = (id: string, time: string, href: string) => ({
  id,
  bbox: [-120, 37, -119, 38],
  properties: { datetime: time, 'eo:cloud_cover': 5, 'proj:epsg': 32611 },
  assets: { scl: { href, 'proj:transform': [20, 0, x0, 0, -20, y0] } },
});
const NOW = Date.parse('2026-10-08T12:00:00Z');

describe('finding scenes', () => {
  it('keeps scenes with a readable scene classification, newest first', () => {
    const s = parseScenes({
      features: [
        feature('old', '2026-09-27T18:54:00Z', 'https://s/old.tif'),
        feature('new', '2026-10-07T18:54:00Z', 'https://s/new.tif'),
        { ...feature('bad', '2026-10-08T18:54:00Z', ''), assets: {} },
      ],
    });
    expect(s.map(x => x.id)).toEqual(['new', 'old']);
  });
  it('finds the station’s pixel in the scene’s UTM grid, and nothing outside its footprint', () => {
    const [s] = parseScenes({ features: [feature('a', '2026-10-07T18:54:00Z', 'https://s/a.tif')] });
    expect(pixelOf(s, AT)).toEqual({ col: 2, row: 2 });
    expect(pixelOf(s, { lat: 36.5, lon: -119.5 })).toBeNull();
  });
});

describe('reading the newest clear pass', () => {
  const tif = (v: number) => buildTiff(32, 32, 16, () => v),
    orig = globalThis.fetch;
  let asked: string[] = [];
  const serve = (features: unknown[], files: Record<string, Uint8Array>) => {
    asked = [];
    globalThis.fetch = rangeFetch(files, url => (url.includes('/search') ? { features } : null), asked);
  };
  afterAll(() => {
    globalThis.fetch = orig;
  });
  it('a cloudy pixel is passed over for an older clear pass; one pass in two tiles counts once', async () => {
    serve(
      [
        feature('cloudy', '2026-10-07T18:54:08Z', 'https://s/cloudy.tif'),
        feature('cloudy-other-tile', '2026-10-07T18:54:07Z', 'https://s/other.tif'),
        feature('clear', '2026-09-27T18:54:00Z', 'https://s/clear.tif'),
      ],
      { 'https://s/cloudy.tif': tif(9), 'https://s/other.tif': tif(4), 'https://s/clear.tif': tif(4) },
    );
    const [p] = await passFor([AT], NOW);
    expect(p).toMatchObject({ id: 'clear', date: '2026-09-27', scl: 4, skipped: ['2026-10-07'] });
    expect(p!.days).toBeCloseTo(10.71, 1);
    expect(asked.some(a => a.includes('other.tif'))).toBe(false);
  });
  it('cloud on every pass: no class, dated to the newest', async () => {
    serve(
      [
        feature('c1', '2026-10-06T18:54:00Z', 'https://s/c1.tif'),
        feature('c2', '2026-10-01T18:54:00Z', 'https://s/c2.tif'),
      ],
      { 'https://s/c1.tif': tif(8), 'https://s/c2.tif': tif(3) },
    );
    /* 130 m south: a search box of its own, so the first test's scenes aren't reused */
    const [p] = await passFor([{ lat: AT.lat - 0.0012, lon: AT.lon }], NOW);
    expect(p).toMatchObject({ id: 'c1', scl: null, skipped: ['2026-10-06', '2026-10-01'] });
  });
  it('no scene over the point: nothing', async () => {
    serve([], {});
    expect(await passFor([{ lat: 10, lon: 10 }], NOW)).toEqual([null]);
  });
});

const pass = (o: Partial<PassFacts>): PassFacts => ({
  id: 'x',
  date: '2026-10-05',
  days: 3,
  scl: 5,
  skipped: [],
  ...o,
});
describe('as evidence', () => {
  it('waits, is absent, or says nothing through cloud', () => {
    expect(srcPass({}).status).toBe('wait');
    expect(srcPass({ pass: null }).status).toBe('na');
    expect(srcPass({ pass: pass({ scl: null, skipped: ['2026-10-05', '2026-09-30'] }) })).toMatchObject({
      status: 'quiet',
      note: expect.stringMatching(/no clear view of the point on the last 2 passes/),
    });
  });
  it('each clear class leans its way', () => {
    const lean = (scl: number) => srcPass({ pass: pass({ scl }) }).ll;
    expect(lean(4)[CIX.grass]).toBeGreaterThan(lean(4)[CIX.bare]);
    expect(lean(5)[CIX.bare]).toBeGreaterThan(lean(5)[CIX.forest]);
    expect(lean(6)[CIX.water]).toBeGreaterThan(lean(6)[CIX.grass]);
    expect(lean(11)[CIX.snow]).toBeGreaterThan(lean(11)[CIX.bare]);
  });
  it('full weight to 10 days, fading to nothing at 60', () => {
    expect(passWeight(3)).toBe(1);
    expect(passWeight(PASS_AGE.full)).toBe(1);
    expect(passWeight(35)).toBeCloseTo(0.5, 9);
    expect(passWeight(60)).toBe(0);
    expect(srcPass({ pass: pass({ days: 35 }) }).wmul).toBeCloseTo(0.5, 9);
  });
});

describe('the satellite outweighs the weather model on snow', () => {
  const day = (o: Partial<TodayFacts>): TodayFacts => ({
    time: '2026-10-08T13:15',
    snow: 0.43,
    soil: 0.18,
    rain3: 7.7,
    snow7: 0,
    grid: { lat: 0, lon: 0, elev: 0, km: 2 },
    snowfall: [
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ].map(date => ({ date, cm: 0 })),
    ...o,
  });
  it('Konkordia: a clear pass 3 days ago saw no snow, none has fallen since, so the model’s 43 cm doesn’t count', () => {
    const sh = { today: day({}), pass: pass({}) };
    expect(clearOfSnow(sh)).toBe('2026-10-05');
    expect(srcToday(sh)).toMatchObject({
      status: 'quiet',
      note: expect.stringMatching(/the satellite saw none on 2026-10-05/),
    });
  });
  it('snow fallen since that pass still lies on top', () => {
    const t = day({
      snow7: 6,
      snowfall: day({}).snowfall.map(d => ({ ...d, cm: d.date === '2026-10-07' ? 6 : 0 })),
    });
    expect(srcToday({ today: t, pass: pass({}) }).onTop).toEqual({ cls: 'snow', p: expect.any(Number) });
  });
  it('snow fallen only before the pass, which saw none, is gone', () => {
    const t = day({
      snow7: 6,
      snowfall: day({}).snowfall.map(d => ({ ...d, cm: d.date === '2026-10-02' ? 6 : 0 })),
    });
    expect(srcToday({ today: t, pass: pass({}) }).onTop).toBeFalsy();
  });
  it('a pass that saw snow, or one too old, leaves the model alone', () => {
    expect(clearOfSnow({ pass: pass({ scl: 11 }) })).toBeNull();
    expect(clearOfSnow({ pass: pass({ days: 20 }) })).toBeNull();
    expect(srcToday({ today: day({}), pass: pass({ days: 20 }) }).ll[CIX.snow]).toBeGreaterThan(0);
  });
});
