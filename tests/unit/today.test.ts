/* Today (data/today, engine/today): Open-Meteo's answer read into facts, and
 * the facts read as evidence. The response below has the shape of the real
 * one at Konkordia on 8 Oct 2026. */
import { describe, it, expect } from 'vitest';
import { CIX } from '../../src/core/classes';
import { parseToday, todayUrl } from '../../src/data/today';
import { TODAY, snowCover, srcToday } from '../../src/engine/today';
import { usable } from '../../src/engine/refit';
import type { TodayFacts } from '../../src/core/types';

const KONKORDIA = {
  latitude: 46.482124,
  longitude: 8.055958,
  elevation: 2701,
  current: { time: '2026-10-08T13:15', interval: 900, snow_depth: 0.43, soil_moisture_0_to_1cm: 0.183 },
  daily: {
    time: [
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ],
    rain_sum: [0, 0, 0, 0, 0, 0, 0, 2.8],
    snowfall_sum: [0, 0, 0, 0, 0, 0, 0, 0],
  },
};
const at = { lat: 46.5005, lon: 8.051 };
const day = (o: Partial<TodayFacts>): TodayFacts => ({
  time: '2026-10-08T13:15',
  snow: 0,
  soil: 0.15,
  rain3: 0,
  snow7: 0,
  grid: { lat: 0, lon: 0, elev: 0, km: 1 },
  ...o,
});

describe('reading Open-Meteo', () => {
  it('asks for the snow, soil, rain and snowfall it needs, at about a kilometre', () => {
    const u = todayUrl(at);
    expect(u).toMatch(/latitude=46\.50&longitude=8\.05/);
    expect(u).toMatch(/current=snow_depth,soil_moisture_0_to_1cm/);
    expect(u).toMatch(/daily=rain_sum,snowfall_sum&past_days=7/);
  });
  it('reads the answer into today’s facts', () => {
    const t = parseToday(KONKORDIA, at)!;
    expect(t).toMatchObject({ time: '2026-10-08T13:15', snow: 0.43, soil: 0.183, rain3: 2.8, snow7: 0 });
    expect(t.grid.km).toBeCloseTo(2.1, 1);
  });
  it('no current reading is no facts; a missing soil value is null, not zero', () => {
    expect(parseToday({ ...KONKORDIA, current: undefined }, at)).toBeNull();
    expect(parseToday(null, at)).toBeNull();
    expect(
      parseToday({ ...KONKORDIA, current: { ...KONKORDIA.current, soil_moisture_0_to_1cm: null } }, at)!.soil,
    ).toBeNull();
  });
});

describe('as evidence', () => {
  it('waits while asking, and is absent when there was no answer', () => {
    expect(srcToday({}).status).toBe('wait');
    expect(srcToday({ today: null }).status).toBe('na');
  });
  it('no snow and ordinary soil: quiet, out of the fusion', () => {
    const p = srcToday({ today: day({}) });
    expect(p.status).toBe('quiet');
    expect(p.onTop).toBeUndefined();
  });
  it('fresh snow lies on top of the ground, more likely the deeper it is', () => {
    const p = srcToday({ today: day({ snow: 0.1, snow7: 6 }) });
    expect(p.onTop).toEqual({ cls: 'snow', p: snowCover(0.1) });
    expect(snowCover(0.03)).toBeCloseTo(0.61, 2);
    expect(snowCover(0.3)).toBeCloseTo(0.85, 2);
    expect(snowCover(1)).toBeLessThan(0.91);
  });
  it('Konkordia: snow the model holds with none fallen this week is a light vote, not a cover', () => {
    const p = srcToday({ today: parseToday(KONKORDIA, at) });
    expect(p.onTop).toBeNull();
    expect(p.status).toBe('ok');
    expect(p.ll[CIX.snow]).toBeGreaterThan(0);
    expect(p.ll[CIX.snow]).toBeLessThanOrEqual(2);
    expect(p.note).toMatch(/none fallen this week/);
  });
  it('a dusting under 3 cm is no snow', () => {
    expect(srcToday({ today: day({ snow: TODAY.snowFrom - 0.01, snow7: 2 }) }).status).toBe('quiet');
  });
  it('wet soil leans to wetland and away from bare ground', () => {
    const p = srcToday({ today: day({ soil: 0.42 }) });
    expect(p.ll[CIX.wetland]).toBeGreaterThan(0);
    expect(p.ll[CIX.bare]).toBeLessThan(0);
    expect(p.ll[CIX.wetland] - p.ll[CIX.bare]).toBeCloseTo(2.4, 6);
  });
  it('a mark made under fresh snow teaches the weights nothing, so a refit leaves it out', () => {
    const parts = { today: srcToday({ today: day({ snow: 0.2, snow7: 5 }) }) };
    expect(usable([{ parts, truth: 'snow' }])).toHaveLength(0);
  });
});
