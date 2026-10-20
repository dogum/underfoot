/**
 * Connects the page's controls and keyboard shortcuts to actions. Runs once at boot.
 */
import { selectStation, setFollow, setMode, setVerts, undoVertex, vertsChanged } from './actions';
import { liveOn, startHere, stopHere, toggleRec } from './live';
import { renderLive } from '../ui/live';
import { exportCheckGpx } from '../ui/checklist';
import { showMarks } from '../ui/marks';
import { recompute } from './sound';
import { STATE, drawn, setPrior } from './state';
import { $, $$, TOUCH, toast } from '../core/dom';
import { clamp } from '../core/math';
import { parseCoordText } from '../io/coords';
import { showExport } from '../io/export';
import { loadFile } from '../io/files';
import { showHistory } from '../io/history';
import { readHash } from '../io/hash';
import { onSearchKey } from '../io/search';
import { finishDrawing } from '../map/interact';
import { clearPeek, flashLock, isLocked, setLocked } from '../map/lock';
import { MAP, fitTo, mapDraw, zoomAt } from '../map/map';
import { ABOUT } from '../ui/about';
import { reFuse, render } from '../ui/console';
import { closeMenus } from '../ui/menus';
import { showTable } from '../ui/table';
import type { TileKey } from '../data/imagery';

/** the element an event came from, for closest() and matches() */
const tgt = (e: Event) => e.target as HTMLElement;
const dlg = (sel: string) => $<HTMLDialogElement>(sel);

export function wire() {
  $('#mPoint').onclick = () => setMode('point');
  $('#mPath').onclick = () => setMode('path');
  $('#mArea').onclick = () => setMode('area');
  $('#hereBtn').onclick = () => (liveOn() ? stopHere() : startHere());
  $('#livePill').onclick = e => {
    if (tgt(e).closest('[data-live=rec]')) toggleRec();
  };
  $('#liveMsgClose').onclick = () => {
    STATE.live.err = null;
    renderLive();
  };
  $('#btnClear').onclick = () => {
    stopHere();
    if (isLocked()) {
      flashLock();
      toast(`Locked. ${TOUCH ? 'Tap' : 'Press K or'} the lock to clear.`);
      return;
    }
    STATE.verts = [];
    MAP.drawing = false;
    vertsChanged(true);
  };
  $('#lockBtn').onclick = () => setLocked(!MAP.locked);
  $('#btnCoords').onclick = () => dlg('#dlgCoords').showModal();
  $('#checkGpx').onclick = exportCheckGpx;
  /* a phone's search box shares the first row, so its hint is shorter */
  const phone = matchMedia('(max-width: 820px)'),
    hint = () =>
      ($<HTMLInputElement>('#search').placeholder = phone.matches
        ? 'Place or lat,lon'
        : 'Search a place, or paste lat, lon');
  hint();
  phone.addEventListener('change', hint);
  $('#coordGo').onclick = () => {
    const pts = parseCoordText($<HTMLTextAreaElement>('#coordText').value);
    dlg('#dlgCoords').close();
    setVerts(pts);
  };
  $('#btnFile').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = e => {
    const inp = e.target as HTMLInputElement,
      f = inp.files?.[0];
    if (f) loadFile(f);
    inp.value = '';
  };
  $('#btnTable').onclick = showTable;
  $('#btnAbout').onclick = () => {
    $('#aboutBody').innerHTML = ABOUT;
    dlg('#dlgAbout').showModal();
  };
  $('#btnHistory').onclick = e => {
    e.stopPropagation();
    const on = $('#historyMenu').classList.contains('on');
    closeMenus();
    if (!on) showHistory();
  };
  $('#btnMarks').onclick = e => {
    e.stopPropagation();
    const on = $('#marksMenu').classList.contains('on');
    closeMenus();
    if (!on) showMarks();
  };
  $('#btnExport').onclick = e => {
    e.stopPropagation();
    const on = $('#exportMenu').classList.contains('on');
    closeMenus();
    if (!on) showExport();
  };
  $$('[data-close]').forEach(b => (b.onclick = () => b.closest('dialog')?.close()));
  addEventListener('click', e => {
    const t = tgt(e);
    if (!t.closest('.menu') && !t.closest('#searchWrap') && !t.closest('.anchor')) closeMenus();
  });
  const s = $<HTMLInputElement>('#search');
  s.addEventListener('keydown', onSearchKey);
  s.addEventListener('input', () => {
    if (!s.value) closeMenus();
  });
  for (const [id, src] of [
    ['bmSat', 'sat'],
    ['bmDark', 'dark'],
    ['bmTopo', 'topo'],
  ] as [string, TileKey][])
    $('#' + id).onclick = () => {
      MAP.src = src;
      ['bmSat', 'bmDark', 'bmTopo'].forEach(x => $('#' + x).setAttribute('aria-pressed', String(x === id)));
      mapDraw();
    };
  const tog = (id: string, key: 'field' | 'vectors' | 'rings') => {
    $('#' + id).onclick = () => {
      MAP[key] = !MAP[key];
      $('#' + id).setAttribute('aria-pressed', String(MAP[key]));
      mapDraw();
    };
  };
  tog('ovField', 'field');
  tog('ovOsm', 'vectors');
  tog('ovRings', 'rings');
  $('#zIn').onclick = () => zoomAt([MAP.W / 2, MAP.H / 2], 1);
  $('#zOut').onclick = () => zoomAt([MAP.W / 2, MAP.H / 2], -1);
  $('#zFit').onclick = () => fitTo(STATE.verts.length ? STATE.verts : STATE.stations);
  $$('#gpsTabs button').forEach(
    b =>
      (b.onclick = () => {
        STATE.gps = Number(b.dataset.s);
        recompute();
        render();
      }),
  );
  $('#prProbed').onclick = () => {
    setPrior('probed');
    $('#prProbed').setAttribute('aria-pressed', 'true');
    $('#prLand').setAttribute('aria-pressed', 'false');
    reFuse();
  };
  $('#prLand').onclick = () => {
    setPrior('land');
    $('#prLand').setAttribute('aria-pressed', 'true');
    $('#prProbed').setAttribute('aria-pressed', 'false');
    reFuse();
  };
  $('#spacingSel').onchange = e => {
    STATE.spacing = (e.target as HTMLSelectElement).value;
    vertsChanged(true);
  };
  $('#folOn').onclick = () => setFollow(true);
  $('#folOff').onclick = () => setFollow(false);
  $('#smRaw').onclick = () => {
    STATE.smooth = false;
    $('#smRaw').setAttribute('aria-pressed', 'true');
    $('#smHmm').setAttribute('aria-pressed', 'false');
    recompute();
    render();
  };
  $('#smHmm').onclick = () => {
    STATE.smooth = true;
    $('#smHmm').setAttribute('aria-pressed', 'true');
    $('#smRaw').setAttribute('aria-pressed', 'false');
    recompute();
    render();
  };
  addEventListener('keydown', e => {
    if (tgt(e).matches('input,textarea,select') || document.querySelector('dialog[open]')) return;
    const k = e.key;
    if (k === 'p' || k === 'P') setMode('point');
    else if (k === 'l' || k === 'L') setMode('path');
    else if (k === 'a' || k === 'A') setMode('area');
    else if (k === 'k' || k === 'K') setLocked(!MAP.locked);
    else if (k === 'Enter' && drawn()) finishDrawing();
    else if ((k === 'Backspace' || k === 'Delete') && drawn() && STATE.verts.length) {
      e.preventDefault();
      undoVertex();
    } else if (k === 'Escape') {
      if (MAP.drawing) finishDrawing();
      else if (MAP.peek) clearPeek();
      else closeMenus();
    } else if (k === '[' || k === 'ArrowLeft') {
      if (STATE.stations.length > 1) {
        e.preventDefault();
        selectStation(STATE.sel - 1);
      }
    } else if (k === ']' || k === 'ArrowRight') {
      if (STATE.stations.length > 1) {
        e.preventDefault();
        selectStation(STATE.sel + 1);
      }
    } else if (k === 'f' || k === 'F') $('#ovField').click();
    else if (k === 'v' || k === 'V') $('#ovOsm').click();
    else if (k === 'g' || k === 'G') {
      const seq = [0, 3, 5, 10];
      STATE.gps = seq[(seq.indexOf(STATE.gps) + 1) % seq.length];
      recompute();
      render();
    } else if (k === '+' || k === '=') zoomAt([MAP.W / 2, MAP.H / 2], 1);
    else if (k === '-') zoomAt([MAP.W / 2, MAP.H / 2], -1);
    else if (k === '/') {
      e.preventDefault();
      $('#search').focus();
    } else if (k === '?') $('#btnAbout').click();
  });
  // credits and help links open beside the app, never in place of it
  addEventListener(
    'click',
    e => {
      const a = tgt(e).closest<HTMLAnchorElement>('a[href^="http"]');
      if (a) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
    },
    true,
  );
  $('#hint').addEventListener('click', e => {
    const b = tgt(e).closest('button');
    if (!b) return;
    if (b.dataset.act === 'undo') undoVertex();
    else if (b.dataset.act === 'done') finishDrawing();
    else if (b.dataset.act === 'unlock') setLocked(false);
  });
  // a pasted or clicked link to another sounding, in a tab that's already open
  addEventListener('hashchange', () => readHash());
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) loadFile(f);
  });
}
