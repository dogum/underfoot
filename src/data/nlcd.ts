// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * NLCD 2021 (MRLC, CONUS): land cover, tree canopy, imperviousness and its descriptor.
 */
import { DAY, cachedFetch, jget } from './http';

/* ---------------------------------------- NLCD rasters (MRLC, CONUS only) */
export const NLCD_NAME = {
  11: 'Open water',
  12: 'Perennial ice/snow',
  21: 'Developed, open space',
  22: 'Developed, low intensity',
  23: 'Developed, medium intensity',
  24: 'Developed, high intensity',
  31: 'Barren land',
  41: 'Deciduous forest',
  42: 'Evergreen forest',
  43: 'Mixed forest',
  51: 'Dwarf scrub',
  52: 'Shrub / scrub',
  71: 'Grassland / herbaceous',
  72: 'Sedge / herbaceous',
  73: 'Lichens',
  74: 'Moss',
  81: 'Pasture / hay',
  82: 'Cultivated crops',
  90: 'Woody wetlands',
  95: 'Emergent herbaceous wetlands',
};
export const IMPD_NAME = {
  20: 'Primary road',
  21: 'Secondary road',
  22: 'Tertiary road',
  23: 'Thinned road',
  24: 'Non-road impervious',
  25: 'Building footprint',
  26: 'LCMAP impervious',
  27: 'Wind turbine',
  28: 'Well pad',
  29: 'Other energy production',
};
/* All four rasters arrive from one GetFeatureInfo, in order, once feature_count is raised. */
export const MRLC_LAYERS = [
  'NLCD_2021_Land_Cover_L48',
  'nlcd_tcc_conus_2021_v2021-4',
  'NLCD_2021_Impervious_L48',
  'NLCD_2021_Impervious_descriptor_L48',
];
export async function nlcd(lat, lon) {
  const q = 0.0002,
    la = Math.round(lat / q) * q,
    lo = Math.round(lon / q) * q; // NLCD is 30 m; ~20 m keys share a pixel
  return cachedFetch(`nlcd:${la.toFixed(4)}:${lo.toFixed(4)}`, 60 * DAY, async () => {
    const d = 0.00018,
      bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`,
      L = encodeURIComponent(MRLC_LAYERS.join(','));
    const u =
      'https://www.mrlc.gov/geoserver/mrlc_display/wms?service=WMS&version=1.1.1&request=GetFeatureInfo' +
      `&layers=${L}&query_layers=${L}&srs=EPSG:4326&bbox=${bbox}&width=5&height=5&x=2&y=2&feature_count=10&info_format=application/json`;
    const j = await jget(u, { timeout: 18000 });
    const v = (j.features || []).map(f => (f && f.properties ? f.properties.PALETTE_INDEX : null));
    const pct = x => (x == null || x < 0 || x > 100 ? null : +x);
    return {
      code: v[0] != null && NLCD_NAME[v[0]] ? +v[0] : null,
      name: NLCD_NAME[v[0]] || null,
      canopy: pct(v[1]),
      imperv: pct(v[2]),
      desc: v[3] == null || v[3] < 0 || v[3] > 29 ? null : +v[3],
      descName: IMPD_NAME[v[3]] || null,
    };
  });
}
