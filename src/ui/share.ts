/**
 * The share card: one picture of the call and the link that reopens it,
 * 1200 × 630 (the size link previews use), as a JPEG. On a phone it goes to the
 * system share sheet; elsewhere it downloads and the link is copied.
 */
import { STATE } from '../app/state';
import { CLASSES, COL, K, NAME, SOURCES } from '../core/classes';
import { ACRE } from '../engine/area';
import { toast } from '../core/dom';
import { fmt } from '../core/math';
import { SITE_URL } from '../core/project';
import { currentReport } from '../io/export';
import { hashFor } from '../io/hash';
import { snapshot } from '../map/snapshot';
import { crossingsText } from './report';
import type { ClassKey } from '../core/types';

export const CARD = { W: 1200, H: 630, map: 624, quality: 0.85 };
const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, system-ui, sans-serif',
  MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Roboto Mono", monospace',
  INK = '#e8eef4',
  INK2 = '#94a6b6',
  INK3 = '#6b7d8d',
  AMBER = '#f0a92e';
const dist = (m: number) => (m >= 1000 ? fmt(m / 1000, 2) + ' km' : Math.round(m) + ' m');
const today = () =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** text cut to fit `w` pixels, with an ellipsis */
function fit(g: CanvasRenderingContext2D, t: string, w: number) {
  if (g.measureText(t).width <= w) return t;
  while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
/** text wrapped to `w` pixels, at most `max` lines, the last cut with an ellipsis */
function wrap(g: CanvasRenderingContext2D, t: string, w: number, max: number) {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (g.measureText(next).width <= w || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  out.push(line);
  return out.length > max ? [...out.slice(0, max - 1), fit(g, out.slice(max - 1).join(' '), w)] : out;
}
/** a class, a bar and a value per row, across the panel's width w */
function bars(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  rows: [ClassKey, number, string][],
) {
  const bx = x + 170,
    bw = w - 170 - 76;
  for (const [k, p, v] of rows) {
    g.font = `400 19px ${SANS}`;
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.fillText(fit(g, NAME[k], 160), x, y);
    g.fillStyle = '#1b232c';
    g.fillRect(bx, y - 10, bw, 9);
    g.fillStyle = COL[k];
    g.fillRect(bx, y - 10, Math.max(2, bw * p), 9);
    g.font = `500 17px ${MONO}`;
    g.fillStyle = INK2;
    g.textAlign = 'right';
    g.fillText(v, x + w, y);
    y += 34;
  }
  g.textAlign = 'left';
}

/** the card for what's on screen, or null if nothing has been read yet */
export async function shareCard(): Promise<HTMLCanvasElement | null> {
  const r = STATE.results[STATE.sel],
    f = r && r.view;
  if (!f) return null;
  const cv = document.createElement('canvas');
  cv.width = CARD.W;
  cv.height = CARD.H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0e1216';
  g.fillRect(0, 0, CARD.W, CARD.H);
  g.drawImage(await snapshot(CARD.map, CARD.H), 0, 0);
  /* the map's credits, as on screen */
  g.fillStyle = 'rgba(11,14,18,.72)';
  g.fillRect(0, CARD.H - 26, CARD.map, 26);
  g.font = `400 12px ${MONO}`;
  g.fillStyle = INK2;
  g.fillText('Imagery © Esri, Maxar, Earthstar Geographics · map data © OpenStreetMap', 12, CARD.H - 9);
  g.fillStyle = '#1e2832';
  g.fillRect(CARD.map, 0, 1, CARD.H);

  const x = CARD.map + 48,
    w = CARD.W - x - 48;
  g.textBaseline = 'alphabetic';
  g.fillStyle = AMBER;
  g.beginPath();
  g.arc(x + 6, 58, 6, 0, 7);
  g.fill();
  g.font = `700 18px ${MONO}`;
  g.fillStyle = INK;
  g.letterSpacing = '6px';
  g.fillText('UNDERFOOT', x + 22, 64);
  g.letterSpacing = '0px';

  const link = SITE_URL + hashFor(400),
    sh = r.sh,
    place =
      sh.nom && sh.nom.display_name ? sh.nom.display_name.split(',').slice(0, 2).join(',').trim() : null;
  if (STATE.mode === 'point') {
    const def = CLASSES.find(c => c.k === f.top)!.d;
    g.fillStyle = COL[f.top];
    g.fillRect(x, 108, 56, 56);
    g.font = `650 40px ${SANS}`;
    g.fillStyle = INK;
    g.fillText(fit(g, NAME[f.top], w - 210), x + 76, 146);
    g.font = `400 14px ${MONO}`;
    g.fillStyle = INK3;
    wrap(g, def, w, 2).forEach((l, i) => g.fillText(l, x, 196 + i * 20));
    g.font = `650 72px ${SANS}`;
    g.fillStyle = INK;
    g.textAlign = 'right';
    g.fillText(String(Math.round(f.topP * 100)), x + w - 30, 162);
    g.font = `400 24px ${SANS}`;
    g.fillStyle = INK3;
    g.fillText('%', x + w, 162);
    g.textAlign = 'left';
    bars(
      g,
      x,
      272,
      w,
      f.order.slice(0, 3).map(i => [K[i], f.p[i], fmt(f.p[i] * 100, 1)] as [ClassKey, number, string]),
    );
    const st = r.station,
      ok = (r.fused?.ledger || []).filter(l => l.status === 'ok' || l.status === 'quiet').length;
    g.font = `400 20px ${SANS}`;
    g.fillStyle = INK;
    g.fillText(fit(g, place || 'An unnamed spot', w), x, 470);
    g.font = `400 15px ${MONO}`;
    g.fillStyle = INK3;
    g.fillText(
      fit(
        g,
        `${Math.abs(st.lat).toFixed(6)}°${st.lat >= 0 ? 'N' : 'S'} ${Math.abs(st.lon).toFixed(6)}°${st.lon >= 0 ? 'E' : 'W'} · ${today()} · ${ok}/${SOURCES.length} sources`,
        w,
      ),
      x,
      500,
    );
  } else if (STATE.mode === 'area') {
    /* an area: its acres, and each class's share of them (app/area) */
    const s = STATE.area?.sum;
    if (!s) return null;
    const cls = K.map((k, c) => ({ cls: k, share: s.byClass[c] / s.m2 }))
      .filter(c => c.share >= 0.005)
      .sort((a, b) => b.share - a.share);
    g.font = `650 34px ${SANS}`;
    g.fillStyle = INK;
    g.fillText(`A ${fmt(s.m2 / ACRE, s.m2 < 10 * ACRE ? 2 : 1)}-acre lot`, x, 140);
    g.font = `400 15px ${MONO}`;
    g.fillStyle = INK3;
    g.fillText(
      fit(
        g,
        `${Math.round(s.m2).toLocaleString('en-US')} m² · ${STATE.verts.length} corners · read in 2 m cells`,
        w,
      ),
      x,
      168,
    );
    let bx = x;
    for (const c of cls) {
      const bw = w * c.share;
      g.fillStyle = COL[c.cls];
      g.fillRect(bx, 196, Math.max(1, bw - 1), 16);
      bx += bw;
    }
    bars(
      g,
      x,
      262,
      w,
      cls
        .slice(0, 4)
        .map(c => [c.cls, c.share, Math.round(c.share * 100) + '%'] as [ClassKey, number, string]),
    );
    g.font = `400 20px ${SANS}`;
    g.fillStyle = INK;
    g.fillText(fit(g, place ? `By ${place}` : 'Share of the area per class', w), x, 470);
    g.font = `400 15px ${MONO}`;
    g.fillStyle = INK3;
    g.fillText(
      fit(g, `${today()} · ${STATE.stations.length} tiles · share of the area per class`, w),
      x,
      500,
    );
  } else {
    const rep = currentReport()!,
      n = rep.crossings.reduce((a, c) => a + c.n, 0);
    g.font = `650 34px ${SANS}`;
    g.fillStyle = INK;
    g.fillText(`A ${dist(rep.length)} line`, x, 140);
    g.font = `400 15px ${MONO}`;
    g.fillStyle = INK3;
    g.fillText(
      fit(
        g,
        [
          n ? crossingsText(rep) : 'no crossings',
          rep.climb != null ? `+${Math.round(rep.climb)} m −${Math.round(rep.descent ?? 0)} m` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        w,
      ),
      x,
      168,
    );
    let bx = x;
    for (const c of rep.classes) {
      const bw = w * c.share;
      g.fillStyle = COL[c.cls];
      g.fillRect(bx, 196, Math.max(1, bw - 1), 16);
      bx += bw;
    }
    bars(
      g,
      x,
      262,
      w,
      rep.classes
        .slice(0, 4)
        .map(c => [c.cls, c.share, Math.round(c.share * 100) + '%'] as [ClassKey, number, string]),
    );
    const S = STATE.stretches,
      follows = S.length
        ? `Follows ${S[0].name || 'a mapped ' + S[0].what} for ${dist(S.reduce((a, s) => a + s.d1 - s.d0, 0))}`
        : null;
    g.font = `400 20px ${SANS}`;
    g.fillStyle = INK;
    /* only the station in focus has a place name: say which one it is */
    const at = place && (STATE.sel === 0 ? `From ${place}` : `Station ${STATE.sel + 1}: ${place}`);
    g.fillText(fit(g, follows || at || 'Share of the line’s length per call', w), x, 470);
    g.font = `400 15px ${MONO}`;
    g.fillStyle = INK3;
    g.fillText(
      fit(g, `${today()} · ${STATE.stations.length} stations · share of length per call`, w),
      x,
      500,
    );
  }
  g.font = `500 15px ${MONO}`;
  g.fillStyle = AMBER;
  g.fillText(fit(g, link.replace(/^https?:\/\//, ''), w), x, 560);
  return cv;
}

export const cardBlob = (cv: HTMLCanvasElement) =>
  new Promise<Blob | null>(res => cv.toBlob(res, 'image/jpeg', CARD.quality));

/** make the card and share it: the share sheet where there is one, else download it and copy the link */
export async function shareNow() {
  toast('Drawing the card…', 1500);
  const cv = await shareCard();
  if (!cv) return toast('Nothing to share yet.');
  const blob = await cardBlob(cv);
  if (!blob) return toast('The card could not be drawn here.');
  const name = `underfoot-${new Date().toISOString().slice(0, 10)}.jpg`,
    url = SITE_URL + hashFor(),
    file = new File([blob], name, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Underfoot', text: url });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
  try {
    await navigator.clipboard.writeText(url);
    toast('Card saved; link copied');
  } catch {
    toast('Card saved');
  }
}
