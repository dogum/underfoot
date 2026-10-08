// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Coordinate parsing: decimal, hemisphere-first or -last, DMS, rows with extra columns.
 */

/* ---- coordinates --------------------------------------------------------- */
export function parseLatLon(line) {
  // hemisphere-first ("N 37.75 W 119.59", "S33°51'24\" E151°12'55\"") → hemisphere-last
  if (/^\s*[NSEW]\s*\d/.test(line))
    line = line
      .trim()
      .split(/(?=[NSEW]\s*\d)/)
      .map(p => p.slice(1).replace(/[,;\s]+$/, '') + ' ' + p[0])
      .join(' , ');
  const dms = [
    ...line.matchAll(/(\d{1,3})\s*[°d:\s]\s*(\d{1,2})\s*['′m:\s]\s*([\d.]+)\s*["″s]?\s*([NSEW])/gi),
  ];
  if (dms.length >= 2) {
    const val = m => {
      const v = +m[1] + +m[2] / 60 + +m[3] / 3600;
      return /[SW]/i.test(m[4]) ? -v : v;
    };
    const a = dms.map(m => ({ v: val(m), h: m[4].toUpperCase() })),
      la = a.find(x => x.h === 'N' || x.h === 'S'),
      lo = a.find(x => x.h === 'E' || x.h === 'W');
    if (la && lo) return ok(la.v, lo.v);
  }
  const nums = [...line.matchAll(/(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NSEW])?(?![\d.])/gi)]
    .map(m => ({ v: +m[1], h: (m[2] || '').toUpperCase() }))
    .filter(x => Number.isFinite(x.v));
  if (nums.length >= 2) {
    const la = nums.find(x => x.h === 'N' || x.h === 'S'),
      lo = nums.find(x => x.h === 'E' || x.h === 'W');
    if (la && lo)
      return ok(
        la.h === 'S' ? -Math.abs(la.v) : Math.abs(la.v),
        lo.h === 'W' ? -Math.abs(lo.v) : Math.abs(lo.v),
      );
    if (nums.length === 2 || nums.length === 3) return ok(nums[0].v, nums[1].v);
  }
  // a row with extra columns (elevation, time, name): the first two decimal fields
  const dec = line.split(/[,\t; ]+/).filter(f => /^-?\d{1,3}\.\d{2,}$/.test(f));
  if (dec.length >= 2) return ok(+dec[0], +dec[1]);
  return null;
  function ok(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { lat, lon }
      : null;
  }
}
export function parseCoordText(txt) {
  return txt
    .split(/[\n\r;]+/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'))
    .map(parseLatLon)
    .filter(Boolean);
}
