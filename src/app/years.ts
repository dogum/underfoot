/**
 * The time machine for the station in focus: its history read by
 * sounding/years, with a small picture of each capture for the strip. Only
 * the station on screen is read, a moment after its answer settles, so
 * dragging a probe doesn't send a burst of requests.
 */
import { STATE } from './state';
import type { Years } from '../engine/years';
import { HALF, readHistory } from '../sounding/years';
import { render } from '../ui/console';

export interface YearsState {
  /** the spot it belongs to, to 1e-5° */
  key: string;
  runId: number;
  status: 'reading' | 'done' | 'none' | 'err';
  /** progress while reading: captures found, and read so far */
  found: number;
  read: number;
  /** tile maps asked to find them */
  asked: number;
  h: Years | null;
  /** a 48 px picture of each capture around the point, for the strip */
  thumbs: ImageData[];
  err?: string;
}

export const spotKey = (lat: number, lon: number) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** the station whose history is shown, or null where there's none to show */
export function yearsStation() {
  if (STATE.mode === 'area' || STATE.mode === 'batch' || STATE.live.on) return null;
  const r = STATE.results[STATE.sel];
  return r && r.view ? r.station : null;
}

let timer = 0;
/** read the history for the station in focus, unless it's already read or on its way */
export function scheduleYears(delay = 900) {
  const st = yearsStation();
  if (!st) return;
  const key = spotKey(st.lat, st.lon);
  if (STATE.years && STATE.years.key === key) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const now = yearsStation();
    if (now && spotKey(now.lat, now.lon) === key && STATE.years?.key !== key) readAt(now.lat, now.lon, key);
  }, delay);
}

function thumb(d: ImageData): ImageData {
  const out = new ImageData(48, 48),
    o = HALF - 24;
  for (let y = 0; y < 48; y++)
    out.data.set(d.data.subarray(((y + o) * d.width + o) * 4, ((y + o) * d.width + o + 48) * 4), y * 48 * 4);
  return out;
}

async function readAt(lat: number, lon: number, key: string) {
  const hs: YearsState = {
    key,
    runId: STATE.runId,
    status: 'reading',
    found: 0,
    read: 0,
    asked: 0,
    h: null,
    thumbs: [],
  };
  STATE.years = hs;
  const live = () => STATE.years === hs;
  render();
  try {
    const got = await readHistory(lat, lon, {
      live,
      found(asked, found) {
        hs.asked = asked;
        hs.found = found;
        render();
      },
      read() {
        hs.read++;
        render();
      },
    });
    if (!got || !live()) return;
    hs.thumbs = got.pictures.map(R => thumb(R.data));
    hs.h = got.h;
    hs.status = got.h.caps.length ? 'done' : 'none';
  } catch (e) {
    if (!live()) return;
    hs.status = 'err';
    hs.err = (e as Error).message;
  }
  render();
}
