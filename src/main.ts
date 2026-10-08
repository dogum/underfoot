// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Entry point: styles, boot, the demo line, and the window.underfoot console handle.
 */
import './styles/app.css';
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
import { loadMarks } from './io/marks';
import { applySavedFit } from './ui/refit';

/* the demo: Yosemite Valley, from the Ansel Adams Gallery in the village across
   Village and Northside drives, through Cook's Meadow, over the Merced River
   and Southside Drive into the woods to the Valley Loop Trail. A building,
   roads, trails, meadow, river and forest in under a kilometre. */
export const DEMO = [
  { lat: 37.74856, lon: -119.58683 },
  { lat: 37.7462, lon: -119.588 },
  { lat: 37.7445, lon: -119.59 },
  { lat: 37.743, lon: -119.5899 },
  { lat: 37.7414, lon: -119.5892 },
];
export function boot() {
  /* carry over recent soundings and the lock from the SOUNDING-era keys */
  try {
    for (const k of ['hist', 'lock'])
      if (localStorage.getItem('uf.' + k) == null && localStorage.getItem('snd.' + k) != null)
        localStorage.setItem('uf.' + k, localStorage.getItem('snd.' + k));
  } catch (e) {}
  try {
    MAP.locked = localStorage.getItem('uf.lock') === '1';
  } catch (e) {}
  $('#brandTag').textContent += ' · v' + VERSION.split('.')[0];
  mapInit();
  transectInit();
  wire();
  applySavedFit();
  syncModeButtons();
  render();
  /* marks come from IndexedDB; draw them once they're in */
  loadMarks().then(() => render());
  if (readHash()) return;
  const h = loadHist()[0];
  if (h) {
    STATE.spacing = h.s || 'auto';
    $('#spacingSel').value = STATE.spacing;
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
import * as menus from './ui/menus';
import * as coords from './io/coords';
import * as files from './io/files';
import * as hashes from './io/hash';
import * as history from './io/history';
import * as exporter from './io/export';
import * as evidence from './engine/evidence';
import * as fuse from './engine/fuse';
import * as field from './engine/field';
import * as narration from './engine/narrate';
import * as report from './engine/report';
import * as doubt from './engine/doubt';
import * as share from './ui/share';
import * as checklist from './ui/checklist';
import * as marksIO from './io/marks';
import * as marksUi from './ui/marks';
import * as refit from './engine/refit';
import * as refitUi from './ui/refit';
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
  menus,
  coords,
  files,
  hashes,
  history,
  exporter,
  evidence,
  fuse,
  field,
  narration,
  report,
  doubt,
  share,
  checklist,
  gpx,
  marksIO,
  marksUi,
  refit,
  refitUi,
);

document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
