/* The time machine: Wayback's replies parsed (data/wayback), and captures
 * smoothed across the years with the change flagged (engine/years). The
 * sites are the imagery classifier's own readings of each capture, as the app
 * read them (numbers only; the pictures are Esri's). */
import { describe, it, expect } from 'vitest';
import SITES from './fixtures/years-sites.json';
import { parseCaptureMeta, parseReleases, parseTilemap } from '../../src/data/wayback';
import { YEARS, YEAR_CLASSES, yearsWords, readYears, smoothCaptures, yearOf } from '../../src/engine/years';
import type { Capture } from '../../src/engine/years';
import { imgLogLik, imgProbs } from '../../src/engine/imagery-model';
import MEDIAN from './fixtures/class_median_feats.json';

const at = (k: string, v = 0.7) => YEAR_CLASSES.map(c => (c === k ? v : (1 - v) / 8));
const caps = (rows: [string, string, number?][]): Capture[] =>
  rows.map(([date, k, v], i) => ({ date, rel: i, p: at(k, v) }));

describe('Wayback replies', () => {
  it('releases come newest first, by their own date', () => {
    const r = parseReleases({
      10: { itemTitle: 'World Imagery (Wayback 2014-02-20)', metadataLayerUrl: 'm10' },
      64776: { itemTitle: 'World Imagery (Wayback 2023-08-31)', metadataLayerUrl: 'm64776' },
      63116: { itemTitle: 'World Imagery (Wayback 2026-09-24)', metadataLayerUrl: 'm63116' },
      1: { itemTitle: 'no date here', metadataLayerUrl: 'x' },
    });
    expect(r.map(x => x.id)).toEqual([63116, 64776, 10]);
    expect(r[0]).toEqual({ id: 63116, date: '2026-09-24', meta: 'm63116' });
  });
  it('a tile map names the release a tile comes from, or none', () => {
    expect(parseTilemap({ data: [1], select: [39767] }, 63116)).toBe(39767);
    expect(parseTilemap({ data: [1] }, 39767)).toBe(39767);
    expect(parseTilemap({ data: [0] }, 39767)).toBe(null);
    expect(parseTilemap(null, 39767)).toBe(null);
  });
  it("a release's metadata gives the z18 capture's date, resolution and provider", () => {
    const row = (lo: number, hi: number, d: string, desc = 'Maxar') => ({
      attributes: {
        MinMapLevel: String(lo),
        MaxMapLevel: String(hi),
        SRC_DATE: d,
        SRC_RES: '0.31',
        NICE_DESC: desc,
      },
    });
    expect(parseCaptureMeta({ results: [row(12, 15, '20221113'), row(16, 19, '20240131')] })).toEqual({
      date: '2024-01-31',
      res: 0.31,
      src: 'Maxar',
    });
    expect(parseCaptureMeta({ results: [row(16, 19, '20100218', 'Null')] }).src).toBe(null);
    expect(parseCaptureMeta({ results: [row(12, 15, '20221113')] }).date).toBe(null);
  });
});

describe('smoothing across captures', () => {
  it('the model reads probabilities that sum to one, its top class the same as its log-likelihoods', () => {
    for (const v of Object.values(MEDIAN as Record<string, number[]>)) {
      const p = imgProbs(v),
        lp = imgLogLik(v);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      const best = YEAR_CLASSES[p.indexOf(Math.max(...p))];
      expect(Math.max(...Object.values(lp))).toBe(lp[best]);
    }
  });
  it('one odd capture in a run of forest is not a change', () => {
    const h = readYears(
      caps([
        ['2011-05-01', 'forest'],
        ['2015-08-01', 'wetland', 0.6],
        ['2020-01-01', 'forest'],
        ['2022-10-01', 'forest'],
      ]),
    );
    /* years apart, the odd one keeps its own call on its bar, and no change is claimed */
    expect(h.flags).toEqual([]);
    expect(yearsWords(h)).toBe('No change found across the 4 captures.');
  });
  it('a year or two apart, the run outvotes the odd capture', () => {
    const h = readYears(
      caps([
        ['2016-05-01', 'forest'],
        ['2017-08-01', 'wetland', 0.6],
        ['2018-06-01', 'forest'],
        ['2019-07-01', 'forest'],
      ]),
    );
    expect(h.flags).toEqual([]);
    expect(h.g.every(v => YEAR_CLASSES[v.indexOf(Math.max(...v))] === 'forest')).toBe(true);
    expect(yearsWords(h)).toBe('No change found: forest in all 4 captures.');
  });
  it('a run of bare ground then a run of roofs is flagged between the two captures either side', () => {
    const h = readYears(
      caps([
        ['2014-01-01', 'bare'],
        ['2016-01-01', 'bare'],
        ['2018-01-01', 'bare'],
        ['2019-06-01', 'building'],
        ['2021-01-01', 'building'],
        ['2023-01-01', 'building'],
      ]),
    );
    expect(h.flags).toHaveLength(1);
    expect(h.flags[0]).toMatchObject({ i: 2, from: ['bare'], to: ['building'] });
    expect(h.flags[0].p).toBeGreaterThan(YEARS.changeAt);
    expect(yearsWords(h)).toBe(
      'Changed between Jan 2018 and Jun 2019: bare ground → building, and it stayed building.',
    );
  });
  it('the longer the gap, the likelier a change across it', () => {
    const P = [at('grass', 0.5), at('scrub', 0.5)],
      near = smoothCaptures(P, [2016, 2017]).change[0],
      far = smoothCaptures(P, [2010, 2020]).change[0];
    expect(far).toBeGreaterThan(near);
    for (const v of smoothCaptures(P, [2010, 2020]).g)
      expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  it('dates read as fractional years', () => {
    expect(yearOf('2020-01-01')).toBe(2020);
    expect(yearOf('2022-07-01')).toBeCloseTo(2022.5, 2);
  });
});

describe('real places, as the app read them', () => {
  const S = SITES as Record<string, Capture[]>;
  it('Giga Texas: the factory roof appears between Nov 2020 and Jan 2022', () => {
    const h = readYears(S['Giga Texas']);
    expect(h.caps).toHaveLength(9);
    expect(h.flags.map(f => [h.caps[f.i].date, h.caps[f.i + 1].date, f.to[0]])).toEqual([
      ['2020-11-02', '2022-01-21', 'building'],
    ]);
    expect(yearsWords(h)).toBe(
      'Changed between Nov 2020 and Jan 2022: bare ground → building, and it stayed building.',
    );
  });
  it('Apple Park: the old campus cleared by Mar 2016, the courtyard grassed by Nov 2019', () => {
    const h = readYears(S['Apple Park']);
    expect(
      h.flags.map(f => [h.caps[f.i].date.slice(0, 7), h.caps[f.i + 1].date.slice(0, 7), f.to[0]]),
    ).toEqual([
      ['2010-10', '2016-03', 'bare'],
      ['2017-08', '2019-11', 'grass'],
    ]);
  });
  it('Lake Tahoe: water in every capture, a glare-white one included', () => {
    const h = readYears(S['Lake Tahoe water']);
    expect(h.flags).toEqual([]);
    expect(yearsWords(h)).toBe(`No change found: water in all ${h.caps.length} captures.`);
  });
});
