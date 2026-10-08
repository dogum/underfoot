/* What's overhead (engine/overhead): a roof, tree canopy or open sky, from
 * the footprints, NLCD in the lower 48, and World cover elsewhere. */
import { describe, it, expect } from 'vitest';
import { overhead } from '../../src/engine/overhead';

const q = (o = {}) => ({ density: 1, bD: 99, stD: 99, stIn: null, best: {}, enclosing: [], ...o });

describe('overhead', () => {
  it('says nothing when the answer is the building itself', () => {
    expect(
      overhead({ nlcd: { canopy: 40 } }, q({ enclosing: [{ rule: 'building' }] }), 'building'),
    ).toBeNull();
  });
  it('names a roof over anything else inside a mapped footprint, OSM or FEMA', () => {
    expect(overhead({}, q({ enclosing: [{ rule: 'building' }] }), 'paved')!.kind).toBe('roof');
    expect(overhead({}, q({ stIn: { id: 1 } }), 'path')!.text).toBe('a roof');
  });
  it('gives the canopy share where NLCD measures it, open sky under 10%', () => {
    const t = overhead({ nlcd: { canopy: 52 } }, q(), 'path')!;
    expect([t.kind, t.text, t.src]).toEqual(['trees', 'tree canopy 52%', 'NLCD 2021, 30 m pixel']);
    expect(overhead({ nlcd: { canopy: 3 } }, q(), 'grass')!.text).toBe('open sky (tree canopy 3%)');
  });
  it('uses the global land cover abroad, and says nothing for cloud or no reading', () => {
    expect(overhead({ nlcd: null, world: { code: 2, year: 2025 } }, q(), 'path')).toMatchObject({
      kind: 'trees',
      text: 'trees',
      src: 'World cover 2025, 10 m pixel',
    });
    expect(overhead({ nlcd: null, world: { code: 11, year: 2025 } }, q(), 'grass')!.kind).toBe('open');
    expect(overhead({ nlcd: null, world: { code: 10, year: 2025 } }, q(), 'grass')).toBeNull();
    expect(overhead({ nlcd: null, world: null }, q(), 'grass')).toBeNull();
  });
});
