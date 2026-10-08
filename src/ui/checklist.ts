/**
 * The walk check list: the most doubtful spots along a line, one per stretch,
 * numbered in walking order, each saying why (engine/doubt checkList). It
 * opens from the route card and exports as GPX waypoints whose links reopen
 * the line at that spot.
 */
import { selectStation } from '../app/actions';
import { STATE } from '../app/state';
import { COL, NAME } from '../core/classes';
import { $, el, toast } from '../core/dom';
import { SITE_URL } from '../core/project';
import { CHECK, doubtWords } from '../engine/doubt';
import { currentReport, download } from '../io/export';
import { waypointsGpx, type Waypoint } from '../io/gpx';
import { hashFor } from '../io/hash';
import { markAt, startMark } from './marks';
import type { DoubtfulStation } from '../engine/report';

const pct = (p: number) => Math.round(p * 100) + '%';
const today = () => new Date().toISOString().slice(0, 10);

/** a spot's call and why it's worth a look, as the list and the waypoint say it */
function spot(c: DoubtfulStation) {
  const r = STATE.results[c.i],
    f = r && r.view;
  if (!f || !r.doubt) return null;
  return { f, why: doubtWords(r.doubt, f), at: `station ${c.i + 1} · ${Math.round(c.d)} m along` };
}

export function openCheckList() {
  const rep = currentReport();
  if (!rep) return;
  const dlg = $('#dlgCheck') as HTMLDialogElement,
    body = $('#checkBody'),
    n = rep.checks.length;
  body.textContent = '';
  $('#checkSub').textContent = n
    ? `${n} of ${rep.doubtful.length} station${rep.doubtful.length === 1 ? '' : 's'} worth a look · ${CHECK.apart} m or more apart · in walking order`
    : '';
  if (!n)
    body.append(
      el('p', 'help', 'Nothing on this line is worth a look: every call is clear, and its sources agree.'),
    );
  rep.checks.forEach((c, k) => {
    const s = spot(c);
    if (!s) return;
    const row = el('div', 'ck'),
      go = el('button', 'go'),
      head = el('span', 'h'),
      sw = el('i');
    sw.style.background = COL[s.f.top];
    head.append(sw, el('b', null, `${NAME[s.f.top]} ${pct(s.f.topP)}`), el('span', 'm', s.at));
    go.append(head, el('span', 'w', s.why));
    go.title = `Show station ${c.i + 1}`;
    go.onclick = () => {
      dlg.close();
      selectStation(c.i);
    };
    row.append(el('span', 'n', String(k + 1)), go);
    /* mark it from here: right, wrong or not sure opens the mark under its answer */
    const st = STATE.stations[c.i],
      mk = st && markAt(st),
      act = el('span', 'mk');
    if (mk)
      act.append(
        el('span', 't ' + mk.verdict, mk.verdict === 'right' ? '✓' : mk.verdict === 'wrong' ? '✗' : '?'),
      );
    else
      for (const [v, t] of [
        ['right', '✓'],
        ['wrong', '✗'],
        ['unsure', '?'],
      ] as const) {
        const b = el('button', 'v ' + v, t);
        b.title = v === 'unsure' ? 'Not sure' : v === 'right' ? 'Right' : 'Wrong';
        b.onclick = () => {
          dlg.close();
          selectStation(c.i);
          startMark(c.i, v);
        };
        act.append(b);
      }
    row.append(act);
    body.append(row);
  });
  ($('#checkGpx') as HTMLButtonElement).disabled = !n;
  dlg.showModal();
}

/** the check list as GPX waypoints, or null when there's nothing to check */
export function checkListGpx(time = new Date()): string | null {
  const rep = currentReport();
  if (!rep || !rep.checks.length) return null;
  const base = SITE_URL + hashFor(),
    wpts: Waypoint[] = [];
  rep.checks.forEach((c, k) => {
    const s = spot(c),
      st = STATE.stations[c.i];
    if (!s || !st) return;
    wpts.push({
      lat: st.lat,
      lon: st.lon,
      name: `${k + 1} · ${NAME[s.f.top].split(' /')[0]} ${pct(s.f.topP)}`,
      cmt: s.why,
      desc: `Worth a look: ${s.why}. Station ${c.i + 1}, ${Math.round(c.d)} m along the line.`,
      link: `${base}&at=${Math.round(c.d)}`,
      linkText: `Open station ${c.i + 1} in Underfoot`,
    });
  });
  return waypointsGpx(
    { name: `Underfoot check list, ${today()}`, link: base, linkText: 'The line in Underfoot', time },
    wpts,
  );
}

export function exportCheckGpx() {
  const gpx = checkListGpx();
  if (!gpx) return toast('Nothing on this line is worth a look.');
  download(`underfoot-checklist-${today()}.gpx`, gpx, 'application/gpx+xml');
}
