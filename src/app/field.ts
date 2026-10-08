/**
 * The field map for the station in focus: the engine evaluated on a 2 m grid
 * around it, imagery read in progressively, re-fused as data arrives.
 */
import { recompute } from './sound';
import { STATE, fuseOpt } from './state';
import { merc } from '../core/geo';
import { imageryRaster } from '../data/imagery';
import { FIELD_HALF, fieldFuse, fieldGeometry, fieldImageryGrid, fieldImageryStep } from '../engine/field';
import { MAP } from '../map/map';
import { render } from '../ui/console';

export interface FieldState {
  /** the station and the run it belongs to */
  idx: number;
  runId: number;
  G: unknown;
  F: ReturnType<typeof fieldGeometry>;
  FI: ReturnType<typeof fieldImageryGrid> | null;
  R: unknown;
  ready: boolean;
  imgDone: boolean;
}

export function startField() {
  const i = STATE.sel,
    r = STATE.results[i];
  if (!r || !r.geo) {
    STATE.field = null;
    return;
  }
  const runId = STATE.runId;
  const fld: FieldState = {
    idx: i,
    runId,
    G: r.geo,
    F: fieldGeometry(r.geo, r.sh, fuseOpt()),
    FI: null,
    R: null,
    ready: false,
    imgDone: false,
  };
  STATE.field = fld;
  scheduleField(0);
  (async () => {
    const z18mpp = merc.mpp(r.station.lat, 18);
    const half = Math.ceil((FIELD_HALF + 14) / z18mpp) + 24;
    const R = await imageryRaster(r.station.lat, r.station.lon, half, [18]);
    if (STATE.field !== fld) return;
    if (!R) {
      fld.imgDone = true;
      scheduleField(0);
      return;
    }
    fld.R = R;
    fld.FI = fieldImageryGrid(R, r.geo);
    const step = () => {
      if (STATE.field !== fld) return;
      const done = fieldImageryStep(fld.FI!, R, 14);
      if (done) {
        fld.imgDone = true;
        scheduleField(0);
      } else {
        if (fld.FI!.next % 120 < 12) scheduleField(60);
        setTimeout(step, 0);
      }
    };
    step();
  })();
}
let _fieldT: ReturnType<typeof setTimeout> | undefined;
export function scheduleField(ms = 140) {
  clearTimeout(_fieldT);
  _fieldT = setTimeout(() => {
    const fld = STATE.field;
    if (!fld || fld.runId !== STATE.runId) return;
    const r = STATE.results[fld.idx];
    if (!r) return;
    fieldFuse(fld.F, fld.FI, r.sh, fuseOpt());
    fld.ready = true;
    MAP.fieldDirty = true;
    recompute();
    render();
  }, ms);
}
