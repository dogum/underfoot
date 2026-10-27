/* Soundings for the MCP tests, made without the network: a scene from
 * tests/unit/scene read and fused by the shared sounding, as sound()
 * would read it from the real map. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { sumArea } from '../../src/engine/area';
import { fieldFuse, fieldGeometry } from '../../src/engine/field';
import { buildGeo, geoAt } from '../../src/engine/geometry';
import { newRun } from '../../src/headless/sound';
import type { SoundRequest, Sounding } from '../../src/headless/sound';
import { createServer } from '../../src/mcp/server';
import type { Deps } from '../../src/mcp/server';
import { newArea } from '../../src/sounding/area';
import { finishRun, fuseStations } from '../../src/sounding/fuse';
import { layLine } from '../../src/sounding/line';
import { freshResults, fuseOpt } from '../../src/sounding/run';
import { stationsFor } from '../../src/sounding/stations';
import { at, box, line } from './scene';
import type { StationFacts } from '../../src/core/types';

/* a meadow with a footpath across it and a house at one end */
export const feats = [
  box('landcover', { class: 'grass' }, -300, -300, 300, 300),
  line('transportation', { class: 'path', subclass: 'footway', name: 'Meadow Path' }, [
    [-300, 0],
    [300, 0],
  ]),
  line('transportation_name', { class: 'path', name: 'Meadow Path' }, [
    [-300, 0],
    [300, 0],
  ]),
  box('building', {}, -10, 90, 10, 110),
];
/* outside the US, so the US-only sources (footprints, NLCD) have nothing to say either way */
const facts = (): Partial<StationFacts> => ({
  conus: false,
  inUS: false,
  structOk: true,
  nlcd: null,
  world: { code: 11, year: 2025 },
  terr: {
    slope: 2,
    rough: 0.05,
    rel: 0,
    z: 1200,
    r: 30,
    src: 'Terrain Tiles (mostly SRTM, ~30 m) · rosette r=30 m',
    res: 30,
    ocean: false,
  },
  nom: null,
});
/** what sound() would return for these vertices, read from the scene instead of the network */
export function fake(req: SoundRequest): Sounding {
  const run = newRun(req);
  /* a line is laid on the scene's map as on the real one: crossings, and stretches that follow the path */
  run.stations = req.mode === 'path' ? layLine(run, stationsFor(run), feats) : stationsFor(run);
  run.results = freshResults(run.stations, null);
  for (const r of run.results) {
    Object.assign(r.sh, facts());
    r.geo = buildGeo(r.station, feats, [], 170);
    r.q = geoAt(r.geo, 0, 0, true);
    if (r.station.x) r.q.crossing = r.station.x.cls;
    if (r.station.f) r.q.follow = r.station.f.cls;
  }
  /* an area's tiles: each a field map of the scene's geometry, without imagery or rasters */
  const area = req.mode === 'area' ? newArea(req.verts) : null;
  if (area) {
    run.results.forEach((r, t) => {
      area.tiles[t] = fieldFuse(fieldGeometry(r.geo!), null, r.sh, fuseOpt(run), null);
      area.sum = sumArea(area.ring, area.centres, area.tiles);
      req.landed?.(t + 1, area.tiles.length);
    });
  }
  fuseStations(run);
  finishRun(run);
  return {
    run,
    complete: true,
    ms: 1,
    weights: { version: 0, label: 'defaults v0' },
    gps: { m: 0, applied: false },
    area,
  };
}
/** a client talking to a server over the SDK's in-memory pair, with the scene for the network */
export async function connect(deps: Partial<Deps> = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer({
    sound: async r => fake(r),
    history: async () => null,
    ready: async () => {},
    ...deps,
  });
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}
