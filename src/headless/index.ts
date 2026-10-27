/**
 * Underfoot without a browser: read a point, a line, an area, many points or
 * a spot's history in Node with the same sources, engine and numbers as the
 * web app. The MCP server and the command line are built on this.
 *
 *   await useNode();
 *   const { run } = await sound({ mode: 'point', verts: [{ lat: 37.7486, lon: -119.5868 }] });
 */
export { useNode } from './node';
export type { NodeOptions } from './node';
export { baseline, newRun, sound } from './sound';
export type { SoundRequest, Sounding } from './sound';
export { soundPoints } from './batch';
export type { PointsRead, PointsRequest } from './batch';
export { readHistory } from '../sounding/years';
export type { History } from '../sounding/years';
export { YEAR_CLASSES, yearsWords } from '../engine/years';
export { ACRE, MAX_TILES } from '../engine/area';
export type { Run } from '../sounding/run';
export { CIX, K, NAME, VERSION } from '../core/classes';
export { DEMO, SITE_URL } from '../core/project';
export { Phi } from '../core/math';
export { GEOM_ERR } from '../engine/evidence';
export { rateLine, rateStation } from '../engine/mobility';
export { spanBounds } from '../engine/report';
