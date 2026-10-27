/**
 * The stations for what's on screen. Layout and crossings live in
 * sounding/stations, shared with the headless reader.
 */
import { STATE } from './state';
import { stationsFor } from '../sounding/stations';
import type { Station } from '../core/types';

export { MAX_CROSS, along, cumLen, findCrossings, mergeCrossings, snapStations } from '../sounding/stations';

export const deriveStations = (): Station[] => stationsFor(STATE);
