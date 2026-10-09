/**
 * Go / slow / no-go on screen (app/going, engine/mobility): the "Getting
 * across" panel for the station in focus, with every factor behind its
 * ratings; a band per preset under the transect; and the line's summary for
 * the route card.
 */
import { STATE } from '../app/state';
import { K, NAME } from '../core/classes';
import { $, TOUCH, el } from '../core/dom';
import { fmt } from '../core/math';
import { PRESETS, PRESET_IDS } from '../engine/mobility';
import type { Band, LineGoing, Preset, Rating } from '../engine/mobility';
import { overhead } from '../engine/overhead';
import type { SoilFacts, TodayFacts } from '../core/types';

const SHORT: Record<Preset, string> = { foot: 'Foot', atv: 'ATV', truck: 'Truck' };
const BAND: Record<Band, string> = { go: 'go', slow: 'slow', nogo: 'no-go' };
const speed = (r: Rating) => (r.band === 'nogo' ? '—' : `${fmt(r.v, r.v < 10 ? 1 : 0)} km/h`);
const pct = (v: number) => Math.round(v * 100) + '%';

/* the factors are open on a wide screen and a tap away on a phone; the choice is remembered */
function factorsOpen(): boolean {
  try {
    const v = localStorage.getItem('uf.factors');
    if (v != null) return v === '1';
  } catch {}
  return !TOUCH;
}

export function renderGoing() {
  const box = $('#going');
  if (!box) return;
  const g = STATE.going,
    i = STATE.sel,
    r = STATE.results[i],
    x = g?.inputs[i];
  box.hidden = !g || !r || !x;
  if (box.hidden || !g || !r || !x) return;
  box.textContent = '';
  const h = el('header');
  h.append(el('span', 'lbl', 'Getting across'), el('span', 'rule'));
  if (STATE.stations.length > 1) h.append(el('span', 'hint', `station ${i + 1} · ${fmt(r.station.d, 0)} m`));
  box.append(h);
  const rows = el('div', 'gorows');
  for (const p of PRESET_IDS) {
    const rt = g.st[p][i];
    if (!rt) continue;
    const row = el('div', 'gorow');
    row.title = `${PRESETS[p].n}: ${speed(rt)}${rt.nogo >= 0.05 ? `, ${pct(rt.nogo)} that the ground stops it` : ''}`;
    row.append(
      el('span', 'who', SHORT[p]),
      el('span', 'sp', speed(rt)),
      el('span', 'bd ' + rt.band, BAND[rt.band]),
      el('span', 'why', rt.why.join(' · ') || 'good going'),
    );
    rows.append(row);
  }
  box.append(rows);

  /* every factor behind the ratings */
  const d = el('details', 'gofx') as HTMLDetailsElement;
  d.open = factorsOpen();
  d.ontoggle = () => {
    try {
      localStorage.setItem('uf.factors', d.open ? '1' : '0');
    } catch {}
  };
  d.append(el('summary', null, 'Every factor'));
  const top3 = [...K.keys()]
      .sort((a, b) => x.p[b] - x.p[a])
      .slice(0, 3)
      .filter(k => x.p[k] >= 0.03)
      .map(k => `${NAME[K[k]].split(' /')[0].toLowerCase()} ${pct(x.p[k])}`)
      .join(' · '),
    today = r.sh.today as TodayFacts | null | undefined,
    soil = r.sh.soil as SoilFacts | null | undefined,
    ov = overhead(r.sh, r.q, r.view!.top),
    terr = r.sh.terr;
  const fx: [string, string][] = [
    ['ground', top3],
    [
      'grade',
      STATE.mode === 'path'
        ? `${x.grade >= 0 ? '+' : '−'}${pct(Math.abs(x.grade))} along the line, as drawn`
        : 'level: a point has no direction',
    ],
    ['slope · rough', terr ? `${fmt(terr.slope, 1)}° · ±${fmt(terr.rough, 2)} m` : 'waiting for terrain'],
    ['overhead', ov ? `${ov.text} (${ov.src})` : 'not known'],
    [
      'soil',
      soil === undefined
        ? 'reading the soil survey…'
        : soil
          ? `${soil.unit}: ${(soil.drainage || 'drainage not rated').toLowerCase()}${soil.group ? ', group ' + soil.group : ''}`
          : r.sh.inUS
            ? 'no soil survey reading here'
            : 'no soil survey outside the US: wetness from today alone',
    ],
    [
      'today',
      today?.soil != null
        ? `${pct(today.soil)} water in the top cm: ${x.wet ? 'wet' : today.soil >= 0.3 ? 'wet, but the soil drains well' : 'dry'}`
        : 'no soil water reading',
    ],
  ];
  if (x.cross)
    fx.push(['crossing', `${x.cross.what}${x.cross.over ? `, on a bridge over the ${x.cross.over}` : ''}`]);
  if (x.tread) fx.push(['mapped path', x.tread]);
  const list = el('div', 'fxl');
  for (const [k, v] of fx) list.append(el('span', null, k), el('b', null, v));
  d.append(list);
  box.append(d);
}

const FILL: Record<Band, string> = { go: '#3a5563', slow: '#f0a92e', nogo: '#e5484d' };
/** a band per preset under the transect: go, slow, or hatched no-go, each station over its own stretch */
export function drawGoingBands(
  g: CanvasRenderingContext2D,
  xOf: (d: number) => number,
  B: number[],
  y0: number,
  rowH: number,
  gap: number,
  label: (t: string, y: number) => void,
) {
  const going = STATE.going;
  if (!going) return;
  PRESET_IDS.forEach((p, k) => {
    const y = y0 + k * (rowH + gap);
    label(SHORT[p].toUpperCase(), y + rowH / 2);
    const rs = going.st[p];
    /* one rectangle per run of a band, so neighbours don't show a seam */
    for (let i = 0; i < rs.length;) {
      const band = rs[i]?.band ?? null;
      let j = i + 1;
      while (j < rs.length && (rs[j]?.band ?? null) === band) j++;
      const x0 = xOf(B[i]),
        x1 = xOf(B[j]),
        w = Math.max(1, x1 - x0);
      i = j;
      if (!band) {
        g.fillStyle = '#1b232c';
        g.fillRect(x0, y, w, rowH);
        continue;
      }
      g.fillStyle = FILL[band];
      g.fillRect(x0, y, w, rowH);
      if (band === 'nogo') {
        /* hatched, so no-go reads apart from slow without colour */
        g.save();
        g.beginPath();
        g.rect(x0, y, w, rowH);
        g.clip();
        g.strokeStyle = '#7a1f22';
        g.lineWidth = 1.5;
        for (let s = x0 - rowH; s < x1; s += 4) {
          g.beginPath();
          g.moveTo(s, y + rowH);
          g.lineTo(s + rowH, y);
          g.stroke();
        }
        g.restore();
      }
    }
  });
}
/** the bands' key, for the legend under the transect */
export function goingLegend(): HTMLElement {
  const d = el('div', 'golegend');
  for (const b of ['go', 'slow', 'nogo'] as Band[]) {
    const s = el('span'),
      i = el('i', 'gk ' + b);
    s.append(i, document.createTextNode(BAND[b]));
    d.append(s);
  }
  d.title =
    'Foot, ATV and truck: go, slow (under half the speed on good ground, or 20–50% no-go), or no-go (50% or more)';
  return d;
}

const where = (m: number) => `${Math.round(m)} m`;
/** the line's going in one phrase per preset, for the route card */
export function goingSummary(l: LineGoing): string {
  const b = l.blocked;
  if (!l.usable) return `${SHORT[l.preset]}: no-go along the line`;
  const sp = l.smg != null ? `${fmt(l.smg, l.smg < 10 ? 1 : 0)} km/h` : '';
  if (!b.length) return `${SHORT[l.preset]} ${sp}`;
  return `${SHORT[l.preset]} ${sp}, blocked at ${where(b[0].d0)} (${b[0].why})${b.length > 1 ? ` and ${b.length - 1} more` : ''}`;
}
