/* The photo line under the imagery panel: Esri World Imagery's identify reply,
 * read for the z18 photo's date, resolution, stated accuracy and source. */
import { describe, it, expect } from 'vitest';
import { MAX_STATED_ACC, parseImageryMeta } from '../../src/data/imagery';

/* the 15 m TerraColor layer, which answers first everywhere but stops at z11 */
const TERRACOLOR = {
  'RESOLUTION (M)': '15',
  'ACCURACY (M)': '12',
  SOURCE_INFO: 'TerraColor NextGen',
  SOURCE: 'Earthstar Geographics',
  MinMapLevel: '0',
  MaxMapLevel: '11',
};
const reply = (...layers: Record<string, string>[]) => ({
  results: layers.map(attributes => ({ attributes })),
});
/* 40.782631, -112.034722 (Salt Lake City), as Esri returned it on 9 Oct 2026 */
const SALT_LAKE = {
  'DATE (YYYYMMDD)': '20240930',
  'RESOLUTION (M)': '0.2286',
  'ACCURACY (M)': '99999',
  DESCRIPTION: 'Salt Lake County Orthos',
  SOURCE_INFO: 'Salt Lake County2024',
  SOURCE: 'Salt Lake County',
  MinMapLevel: '12',
  MaxMapLevel: '19',
};
/* 37.7419, -119.5967 (Yosemite Valley), same day */
const YOSEMITE = {
  'DATE (YYYYMMDD)': '20251101',
  'RESOLUTION (M)': '0.5',
  'ACCURACY (M)': '8.47',
  DESCRIPTION: 'WV02',
  SOURCE_INFO: 'Vivid',
  SOURCE: 'Vantor',
  MinMapLevel: '12',
  MaxMapLevel: '19',
};

describe('imagery metadata', () => {
  it("reads Esri's 99999 accuracy placeholder as unknown", () => {
    expect(parseImageryMeta(reply(TERRACOLOR, SALT_LAKE))).toEqual({
      date: '2024-09-30',
      res: 0.2286,
      acc: null,
      src: 'Salt Lake County 2024',
    });
  });
  it('keeps a stated accuracy, from the layer that covers z18', () => {
    expect(parseImageryMeta(reply(TERRACOLOR, YOSEMITE))).toEqual({
      date: '2025-11-01',
      res: 0.5,
      acc: 8.47,
      src: 'Vivid',
    });
  });
  it('anything from a kilometre up is unknown, and so are zero and "Null"', () => {
    const acc = (v: string) => parseImageryMeta(reply({ ...YOSEMITE, 'ACCURACY (M)': v })).acc;
    expect(acc('999')).toBe(999);
    expect(acc(String(MAX_STATED_ACC))).toBeNull();
    expect(acc('0')).toBeNull();
    expect(acc('Null')).toBeNull();
  });
  it('spaces a year run onto a source name, and leaves other names alone', () => {
    const src = (SOURCE_INFO: string) => parseImageryMeta(reply({ ...YOSEMITE, SOURCE_INFO })).src;
    expect(src('Miami-Dade County2024')).toBe('Miami-Dade County 2024');
    expect(src('Salt Lake County 2024')).toBe('Salt Lake County 2024');
    expect(src('Vivid Advanced')).toBe('Vivid Advanced');
    expect(src('Null')).toBe('Vantor');
  });
  it('no dated photo at z18: date unknown', () => {
    expect(parseImageryMeta(reply(TERRACOLOR))).toEqual({ date: null });
    expect(parseImageryMeta({})).toEqual({ date: null });
  });
});
