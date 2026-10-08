/**
 * Latitude and longitude to UTM (WGS84), for reading Sentinel-2 tiles, which
 * are drawn in the UTM zone of their grid square. Snyder's series (USGS
 * Professional Paper 1395), good to a few millimetres within a zone and
 * still far finer than a 20 m pixel a degree or two outside it.
 */
const A = 6378137,
  F = 1 / 298.257223563,
  E2 = F * (2 - F),
  EP2 = E2 / (1 - E2),
  K0 = 0.9996;

/** a UTM zone from an EPSG code: 326zz north, 327zz south */
export function zoneOf(epsg: number): { zone: number; south: boolean } | null {
  const z = epsg % 100,
    h = Math.floor(epsg / 100);
  return (h === 326 || h === 327) && z >= 1 && z <= 60 ? { zone: z, south: h === 327 } : null;
}

/** easting and northing in metres, in `zone` (north or south) */
export function toUTM(lat: number, lon: number, zone: number, south = lat < 0): { x: number; y: number } {
  const phi = (lat * Math.PI) / 180,
    lam = (lon * Math.PI) / 180,
    lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180,
    s = Math.sin(phi),
    c = Math.cos(phi),
    N = A / Math.sqrt(1 - E2 * s * s),
    T = Math.tan(phi) ** 2,
    C = EP2 * c * c,
    Q = c * (lam - lam0),
    M =
      A *
      ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
        ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
        ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
        ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
  const x =
      K0 * N * (Q + ((1 - T + C) * Q ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Q ** 5) / 120) +
      500000,
    y =
      K0 *
      (M +
        N *
          Math.tan(phi) *
          ((Q * Q) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * Q ** 4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Q ** 6) / 720));
  return { x, y: south ? y + 10000000 : y };
}
