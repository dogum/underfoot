/**
 * Loading files: GPX, GeoJSON and CSV (io/points). A track is a line; a file
 * of points is asked whether it's a line or separate points (app/batch).
 */
import { setVerts } from '../app/actions';
import { startBatch } from '../app/batch';
import { $, toast } from '../core/dom';
import { BATCH } from '../engine/batch';
import { readCSV, readGPX, readGeoJSON, readPointFile } from './points';
import type { PointFile } from './points';

export async function loadFile(file: File) {
  const txt = await file.text();
  let f: PointFile;
  try {
    f = readPointFile(txt, file.name || '');
  } catch (e) {
    toast('Could not read that file — ' + ((e as Error).message || e));
    return;
  }
  const n = f.pts.length;
  if (!n) {
    toast('No coordinates found in ' + file.name);
    return;
  }
  if (n === 1) {
    setVerts(f.pts, { mode: 'point' });
    return;
  }
  if (f.kind === 'line') {
    toast(`${file.name}: ${n} points — stations spaced along the track`);
    setVerts(f.pts);
    return;
  }
  askLineOrPoints(file.name, f);
}

/** a line, or separate points? The file's own kind is the main button */
function askLineOrPoints(name: string, f: PointFile) {
  const dlg = $('#dlgPoints') as HTMLDialogElement,
    n = f.pts.length,
    asLine = $('#ptsLine') as HTMLButtonElement,
    asPts = $('#ptsSep') as HTMLButtonElement;
  $('#ptsSub').textContent = `${n.toLocaleString('en-US')} points in ${name}`;
  $('#ptsMore').textContent =
    n > BATCH.max
      ? ` A batch reads up to ${BATCH.max.toLocaleString('en-US')}: the first ${BATCH.max.toLocaleString('en-US')} here.`
      : '';
  asPts.classList.toggle('pri', f.kind === 'points');
  asLine.classList.toggle('pri', f.kind !== 'points');
  asLine.onclick = () => {
    dlg.close();
    setVerts(f.pts);
  };
  asPts.onclick = () => {
    dlg.close();
    startBatch(name, f.pts, f.cols);
  };
  dlg.showModal();
  (f.kind === 'points' ? asPts : asLine).focus();
}

/* the coordinates alone, as the browser tests and the console use them */
export const parseGPX = (txt: string) => readGPX(txt).pts.map(({ lat, lon }) => ({ lat, lon }));
export const parseGeoJSON = (j: Parameters<typeof readGeoJSON>[0]) =>
  readGeoJSON(j).pts.map(({ lat, lon }) => ({ lat, lon }));
export const parseCSV = (txt: string) => readCSV(txt).pts.map(({ lat, lon }) => ({ lat, lon }));
