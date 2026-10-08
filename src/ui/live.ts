/**
 * Here, in the readout: the button, the status pill on the map, the message
 * when location is off, the live chip and the verdict's subtitle.
 */
import { STATE } from '../app/state';
import { $, el, esc } from '../core/dom';
import { fmt } from '../core/math';
import { LIVE, trackLength, usable } from '../engine/live';
import type { Station } from '../core/types';

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const dist = (m: number) => (m >= 1000 ? fmt(m / 1000, 2) + ' km' : Math.round(m) + ' m');

export function renderLive() {
  const L = STATE.live,
    btn = $('#hereBtn'),
    pill = $('#livePill'),
    msg = $('#liveMsg');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(L.on));
  msg.hidden = !(L.err === 'denied' || (L.err === 'unavailable' && !L.last));
  if (!msg.hidden)
    $('#liveMsgText').innerHTML =
      L.err === 'denied'
        ? '<b>Location is off for this page.</b> Here needs it to read the ground under you. Everything else works without it. Turn it on in your browser’s site settings, then tap Here.'
        : '<b>No fix yet.</b> Here keeps trying. Out in the open, a phone usually finds one within a minute.';
  pill.hidden = !L.on;
  if (!L.on) return;
  const f = L.last,
    stale = !!f && Date.now() - f.t > LIVE.stale;
  pill.className = 'mapui' + (L.rec ? ' rec' : stale ? ' stale' : '');
  let text: string, btnHtml: string;
  if (L.rec) {
    text = `REC · ${dist(trackLength(L.track))} · ${clock(Date.now() - L.started)}${f ? ` · ±${Math.round(f.acc)} m` : ''}`;
    btnHtml =
      '<button data-live="rec" class="stop" title="Stop recording and read the walk as a line">Stop</button>';
  } else {
    text = !f
      ? 'Finding you…'
      : !usable(f)
        ? `fix ±${Math.round(f.acc)} m · too rough to read`
        : `${stale ? 'last fix' : 'LIVE'} · ±${Math.round(f.acc)} m · ${ago(f.t)}`;
    btnHtml = '<button data-live="rec" title="Record the walk as a line">● Rec</button>';
  }
  pill.innerHTML = `<i></i><span>${esc(text)}</span>${btnHtml}`;
}

/** the station panel's chip while Here is on */
export function liveChips(): HTMLElement[] {
  const f = STATE.live.on && STATE.mode === 'point' ? STATE.live.read : null;
  if (!f) return [];
  const c = el('div', 'chip live');
  c.title = 'The phone’s fix, and its own reported accuracy';
  c.append(el('span', 'lbl', 'Fix'), el('b', null, `±${Math.round(f.acc)} m · ${ago(f.t)}`));
  return [c];
}

/** the verdict's subtitle for a live reading, or null when Here is off */
export function liveSubtitle(p: Station): string | null {
  const f = STATE.live.on && STATE.mode === 'point' ? STATE.live.read : null;
  if (!f) return null;
  const s = p.f && STATE.stretches[p.f.k];
  return s ? `on ${esc(s.name || 'a mapped ' + s.what)} · live` : `live fix ±${Math.round(f.acc)} m`;
}
