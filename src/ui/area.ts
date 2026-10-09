/**
 * Area mode's card (app/area): the outline's acres, each class's share as the
 * cells read it, progress while the tiles are read, and the mosaic, GeoJSON
 * and CSV.
 */
import { areaPlan } from '../app/area';
import { STATE } from '../app/state';
import { COL, K, NAME } from '../core/classes';
import { $, el } from '../core/dom';
import { fmt } from '../core/math';
import { ACRE, MAX_TILES, TILE, ringArea } from '../engine/area';
import { exportAreaCSV, exportAreaGeoJSON } from '../io/area';
import { MAP } from '../map/map';

const acres = (m2: number) => `${fmt(m2 / ACRE, m2 < 10 * ACRE ? 2 : 1)} ac`;

export function renderArea() {
  const box = $('#areaCard');
  if (!box) return;
  box.hidden = STATE.mode !== 'area';
  if (box.hidden) return;
  box.textContent = '';
  const h = el('header');
  h.append(el('span', 'lbl', 'Area'), el('span', 'rule'));
  box.append(h);
  const v = STATE.verts,
    plan = areaPlan(v);
  if (!plan) {
    box.append(el('p', 'help', 'Outline a lot on the map: three corners or more, then Done.'));
    return;
  }
  if (plan.centres.length > MAX_TILES) {
    const most = MAX_TILES * TILE * TILE * 0.8;
    box.append(
      el(
        'p',
        'help',
        `This outline is ${acres(ringArea(plan.ring))}. Area mode reads up to about ${acres(most)} at a time, as 2 m cells: draw a smaller one.`,
      ),
    );
    return;
  }
  const A = STATE.area,
    s = A?.sum,
    m2 = ringArea(plan.ring),
    n = plan.centres.length,
    read = A ? A.tiles.filter(Boolean).length : 0;
  box.append(el('div', 'abig mono', acres(m2)));
  box.append(
    el(
      'div',
      'asub mono',
      [
        `${Math.round(m2).toLocaleString('en-US')} m²`,
        `${v.length} corners`,
        A?.t1
          ? `${n} tile${n === 1 ? '' : 's'} read in ${fmt((A.t1 - A.t0) / 1000, 0)} s`
          : MAP.drawing
            ? 'Done to read it'
            : `reading tile ${Math.min(read + 1, n)} of ${n}…`,
      ].join(' · '),
    ),
  );
  if (s && s.cells) {
    const rows = el('div', 'arows');
    K.map((k, c) => ({ k, m2: s.byClass[c] }))
      .filter(r => r.m2 / s.m2 >= 0.005)
      .sort((a, b) => b.m2 - a.m2)
      .forEach(r => {
        const row = el('div', 'arow'),
          sw = el('i');
        sw.style.background = COL[r.k];
        row.append(
          sw,
          el('span', null, NAME[r.k]),
          el('b', 'mono', acres(r.m2)),
          el('em', 'mono', `${Math.round((r.m2 / s.m2) * 100)}%`),
        );
        rows.append(row);
      });
    box.append(rows);
    box.append(
      el(
        'p',
        'anote',
        `Each class's share is summed over the ${s.cells.toLocaleString('en-US')} cells of 2 m inside the outline${s.cells < s.expectedCells ? ' read so far' : ''}, by its probability in each; the outline's own area is the total.`,
      ),
    );
  }
  const btns = el('div', 'abtns'),
    mos = el('button', null, 'Mosaic');
  mos.setAttribute('aria-pressed', String(MAP.field));
  mos.title = 'Show each cell’s call on the map (the FIELD layer)';
  /* the same switch as the map's FIELD button */
  mos.onclick = () => {
    $('#ovField').click();
    renderArea();
  };
  const gj = el('button', null, 'GeoJSON'),
    csv = el('button', null, 'CSV');
  gj.title = 'The outline and each class’s cells, as GeoJSON';
  csv.title = 'Acres, hectares and share for each class';
  gj.disabled = csv.disabled = !A?.t1;
  gj.onclick = exportAreaGeoJSON;
  csv.onclick = exportAreaCSV;
  btns.append(mos, gj, csv);
  box.append(btns);
}
