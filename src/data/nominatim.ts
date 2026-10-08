// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Nominatim reverse geocoding and search, kept to one request a second.
 */
import { sleep } from '../core/dom';
import { DAY, cachedFetch, jget } from './http';

/* ------------------------------------------------------------ Nominatim */
/* usage policy: at most one request a second — spaced, not delayed */
export let _nomLast = 0,
  _nomChain = Promise.resolve();
export function nomCall(url) {
  const run = async () => {
    const wait = _nomLast + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    _nomLast = Date.now();
    return jget(url, { timeout: 15000 });
  };
  const p = _nomChain.then(run, run);
  _nomChain = p.catch(() => {});
  return p;
}
export function nominatim(lat, lon) {
  const la = lat.toFixed(5),
    lo = lon.toFixed(5);
  return cachedFetch(`nom2:${la}:${lo}`, 30 * DAY, () =>
    nomCall(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${lo}&zoom=18&addressdetails=1&polygon_geojson=1&polygon_threshold=0.000005`,
    ),
  );
}
export function nomSearch(q) {
  return nomCall(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
  );
}
