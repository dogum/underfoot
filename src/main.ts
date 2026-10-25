/**
 * Entry point: styles, boot, the demo line, and the window.underfoot console handle.
 */
import './styles/app.css';
import './styles/phone.css';
import { setVerts, syncModeButtons } from './app/actions';
import { STATE } from './app/state';
import { wire } from './app/wire';
import { VERSION } from './core/classes';
import { $ } from './core/dom';
import { readHash } from './io/hash';
import { histPoints, loadHist } from './io/history';
import { MAP, mapInit } from './map/map';
import { render } from './ui/console';
import { transectInit } from './ui/transect';
import { sheetInit } from './ui/sheet';
import { dialogsInit } from './ui/dialogs';
import { loadMarks } from './io/marks';
import { loadSavedBatch } from './app/batch';
import { applyWeights, refreshCommunity } from './ui/refit';
import { DEMO } from './core/project';

export function boot() {
  /* carry over recent soundings and the lock from the SOUNDING-era keys */
  try {
    for (const k of ['hist', 'lock']) {
      const old = localStorage.getItem('snd.' + k);
      if (localStorage.getItem('uf.' + k) == null && old != null) localStorage.setItem('uf.' + k, old);
    }
  } catch (e) {}
  try {
    MAP.locked = localStorage.getItem('uf.lock') === '1';
  } catch (e) {}
  $('#brandTag').textContent += ' · v' + VERSION.split('.')[0];
  mapInit();
  transectInit();
  sheetInit();
  wire();
  dialogsInit();
  applyWeights();
  syncModeButtons();
  render();
  /* marks come from IndexedDB; draw them once they're in */
  loadMarks().then(() => render());
  /* a batch left unfinished, or not put away, offers itself back (app/batch) */
  loadSavedBatch();
  /* newer community weights from the site, if there are any (app/weights) */
  refreshCommunity();
  if (readHash()) return;
  const h = loadHist()[0];
  if (h) {
    STATE.spacing = h.s || 'auto';
    $<HTMLSelectElement>('#spacingSel').value = STATE.spacing;
    STATE.follow = h.f !== 0;
    setVerts(histPoints(h), { mode: h.m });
    return;
  }
  setVerts(DEMO, { mode: 'path' });
}

/* A console handle for the curious (and for the browser tests): everything the
   app knows lives under window.underfoot — STATE, MAP, the engine, the parsers. */
import * as classes from './core/classes';
import * as math from './core/math';
import * as geo from './core/geo';
import * as state from './app/state';
import * as actions from './app/actions';
import * as sound from './app/sound';
import * as stations from './app/stations';
import * as mapMod from './map/map';
import * as interact from './map/interact';
import * as lock from './map/lock';
import * as liveMod from './app/live';
import * as consoleUi from './ui/console';
import * as sheet from './ui/sheet';
import * as menus from './ui/menus';
import * as coords from './io/coords';
import * as files from './io/files';
import * as hashes from './io/hash';
import * as history from './io/history';
import * as exporter from './io/export';
import * as evidence from './engine/evidence';
import * as nlcdEvidence from './engine/nlcd';
import * as gazetteer from './engine/gazetteer';
import * as terrain from './engine/terrain';
import * as fuse from './engine/fuse';
import * as field from './engine/field';
import * as narration from './engine/narrate';
import * as report from './engine/report';
import * as doubt from './engine/doubt';
import * as mobility from './engine/mobility';
import * as areaEngine from './engine/area';
import * as years from './engine/years';
import * as batchApp from './app/batch';
import * as areaIO from './io/area';
import * as share from './ui/share';
import * as checklist from './ui/checklist';
import * as marksIO from './io/marks';
import * as marksUi from './ui/marks';
import * as refit from './engine/refit';
import * as refitUi from './ui/refit';
import * as contribute from './io/contribute';
import * as contributeUi from './ui/contribute';
import * as project from './core/project';
import * as weights from './app/weights';
import * as gpx from './io/gpx';
import { TOUCH } from './core/dom';
(window as any).underfoot = Object.assign(
  { TOUCH, DEMO, boot },
  classes,
  math,
  geo,
  state,
  actions,
  sound,
  stations,
  mapMod,
  interact,
  lock,
  liveMod,
  consoleUi,
  sheet,
  menus,
  coords,
  files,
  hashes,
  history,
  exporter,
  evidence,
  nlcdEvidence,
  gazetteer,
  terrain,
  fuse,
  field,
  narration,
  report,
  doubt,
  mobility,
  areaEngine,
  years,
  batchApp,
  areaIO,
  share,
  checklist,
  gpx,
  marksIO,
  marksUi,
  refit,
  refitUi,
  contribute,
  contributeUi,
  project,
  weights,
);

document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
