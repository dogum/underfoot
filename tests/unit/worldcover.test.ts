/* World cover (data/worldcover, engine/worldcover): one request for a line's
 * stations, each class read as a mixture, and standing aside wherever NLCD
 * has a class, so no answer in the lower 48 changes. */
import { describe, it, expect, afterAll } from 'vitest';
import { CIX, K, PRIORS, SOURCES } from '../../src/core/classes';
import { parseSamples, worldCoverFor } from '../../src/data/worldcover';
import { WORLD, srcWorld, worldName } from '../../src/engine/worldcover';
import { fuseParts, DEFAULT_NEFF } from '../../src/engine/fuse';

const abroad = (world: unknown) => ({ conus: false, nlcd: null, world });
const W = Object.fromEntries(SOURCES.map(s => [s.id, s.w]));

describe('reading the samples', () => {
  it('puts each sample at its station, with the map year, whatever order they come in', () => {
    const out = parseSamples(
      {
        samples: [
          { locationId: 2, value: '1', attributes: { Year: 2025 } },
          { locationId: 0, value: '2', attributes: { Year: 2025 } },
        ],
      },
      3,
    );
    expect(out).toEqual([{ code: 2, year: 2025 }, null, { code: 1, year: 2025 }]);
  });
  it('gives nothing for a malformed or error reply', () => {
    expect(parseSamples({ error: { code: 400 } }, 2)).toEqual([null, null]);
    expect(parseSamples(null, 1)).toEqual([null]);
  });
});

describe('asking the service', () => {
  const orig = globalThis.fetch,
    asked: { method?: string; body: string }[] = [];
  let reply: unknown = null;
  globalThis.fetch = (async (_url: string, init: { method?: string; body?: URLSearchParams }) => {
    asked.push({ method: init.method, body: String(init.body) });
    return { ok: true, status: 200, json: async () => reply } as unknown as Response;
  }) as typeof fetch;
  afterAll(() => {
    globalThis.fetch = orig;
  });
  it('asks once for every station, as a posted multipoint, and keeps their order', async () => {
    reply = {
      samples: [
        { locationId: 0, value: '2', attributes: { Year: 2025 } },
        { locationId: 1, value: '9', attributes: { Year: 2025 } },
      ],
    };
    const v = await worldCoverFor([
      { lat: 48.547, lon: 8.224 },
      { lat: 46.5005, lon: 8.051 },
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0].method).toBe('POST');
    const body = new URLSearchParams(asked[0].body);
    expect(body.get('geometryType')).toBe('esriGeometryMultipoint');
    expect(JSON.parse(body.get('geometry')!).points).toEqual([
      [8.224, 48.547],
      [8.051, 46.5005],
    ]);
    expect(v.map(x => x && worldName(x.code))).toEqual(['Trees', 'Snow / ice']);
  });
  it('an error reply gives no class, and is asked again next time rather than kept', async () => {
    reply = { error: { code: 500, message: 'busy' } };
    const at = [{ lat: -2.6, lon: -60.2 }];
    expect(await worldCoverFor(at)).toEqual([null]);
    reply = { samples: [{ locationId: 0, value: '2', attributes: { Year: 2025 } }] };
    expect(await worldCoverFor(at)).toEqual([{ code: 2, year: 2025 }]);
  });
});

describe('as evidence', () => {
  it('each class leans to what it mostly stands for', () => {
    const top = { 1: 'water', 2: 'forest', 4: 'wetland', 5: 'crop', 8: 'bare', 9: 'snow' };
    for (const [code, cls] of Object.entries(top)) {
      const r = srcWorld(abroad({ code: +code, year: 2025 }));
      expect(r.status).toBe('ok');
      expect(K[r.ll.indexOf(Math.max(...r.ll))]).toBe(cls);
    }
    // rangeland is grass and scrub alike, then bare ground
    const g = srcWorld(abroad({ code: 11, year: 2025 })).ll;
    expect(g[CIX.grass]).toBeCloseTo(g[CIX.scrub], 9);
    expect(g[CIX.scrub]).toBeGreaterThan(g[CIX.bare]);
    expect(g[CIX.bare]).toBeGreaterThan(g[CIX.forest]);
    // built area is roofs and roads alike
    const b = srcWorld(abroad({ code: 7, year: 2025 })).ll;
    expect(b[CIX.building]).toBeCloseTo(b[CIX.paved], 9);
    expect(b[CIX.building]).toBeGreaterThan(b[CIX.grass]);
  });
  it('names its year and pixel in the ledger', () => {
    expect(srcWorld(abroad({ code: 2, year: 2025 })).note).toMatch(/^2025 map · Trees at the 10 m pixel/);
  });
  it('says nothing for cloud, and waits or abstains without a reading', () => {
    expect(srcWorld(abroad({ code: 10, year: 2025 })).status).toBe('quiet');
    expect(srcWorld(abroad(undefined)).status).toBe('wait');
    expect(srcWorld(abroad(null)).status).toBe('na');
  });
  it('stands aside wherever NLCD has a class, and answers where NLCD came back empty', () => {
    const conus = { conus: true, world: { code: 2, year: 2025 } };
    expect(srcWorld({ ...conus, nlcd: undefined }).status).toBe('wait');
    expect(srcWorld({ ...conus, nlcd: { code: 42 } }).status).toBe('na');
    expect(srcWorld({ ...conus, nlcd: { code: null } }).status).toBe('ok');
    expect(srcWorld({ ...conus, nlcd: null }).status).toBe('ok');
  });
  it('alone, it calls its class with room to spare for the others', () => {
    const f = fuseParts(
      { world: srcWorld(abroad({ code: 2, year: 2025 })) },
      { weights: W, neff: DEFAULT_NEFF, prior: PRIORS.probed },
    );
    expect(f.top).toBe('forest');
    expect(f.topP).toBeLessThan(0.9);
  });
  it('every class in the table sums to at most 1', () => {
    for (const c of Object.values(WORLD))
      expect(Object.values(c.mix).reduce((s, v) => s + (v || 0), 0)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
