import type { ClassDef, ClassKey, ClassMap, PriorName, SourceDef } from './types';

/* ============================================================================
 * Underfoot — probabilistic ground truth for a GPS point or a line of them.
 *
 * No open dataset can tell you what is physically at a coordinate. So this
 * fuses nine weak, partly independent sources in log-odds space and reports
 * a posterior with the ledger of who said what:
 *
 *   OSM polygons + OSM lines   OpenFreeMap vector tiles (CDN, global)
 *   building footprints        FEMA USA Structures (US)
 *   imagery pixels             Esri World Imagery, read pixel by pixel
 *   land cover, canopy,
 *   imperviousness             NLCD 2021 rasters (CONUS)
 *   terrain                    USGS 3DEP 1–10 m (US) / Open-Meteo DEM (global)
 *   gazetteer                  Nominatim
 *
 * Everything is free, keyless and CORS-open, so the file works off disk.
 * ==========================================================================*/

export const VERSION = '1.3.0';

/* ---------------------------------------------------------------- taxonomy */
export const CLASSES: readonly ClassDef[] = [
  {
    k: 'building',
    n: 'Building',
    fam: 'Built',
    c: '#d95737',
    d: 'Roofed structure — on or in a building footprint',
  },
  {
    k: 'paved',
    n: 'Paved surface',
    fam: 'Built',
    c: '#7a8590',
    d: 'Road, parking, apron, driveway — vehicle hardstanding',
  },
  {
    k: 'path',
    n: 'Path / trail',
    fam: 'Built',
    c: '#c4506e',
    d: 'Footway, trail, sidewalk, track — pedestrian tread',
  },
  { k: 'rail', n: 'Railway', fam: 'Built', c: '#af62c1', d: 'Track bed, tram, light rail' },
  { k: 'forest', n: 'Forest', fam: 'Vegetated', c: '#21934c', d: 'Closed tree canopy — woods, plantation' },
  { k: 'scrub', n: 'Scrub', fam: 'Vegetated', c: '#8f8f52', d: 'Shrub, heath, brush, chaparral' },
  {
    k: 'grass',
    n: 'Grass',
    fam: 'Vegetated',
    c: '#7fb32a',
    d: 'Lawn, meadow, pitch — managed or wild herbaceous',
  },
  { k: 'crop', n: 'Cropland', fam: 'Vegetated', c: '#c18500', d: 'Farmland, orchard, vineyard' },
  { k: 'water', n: 'Water', fam: 'Surface', c: '#3b92d9', d: 'Open water — sea, lake, river, reservoir' },
  { k: 'wetland', n: 'Wetland', fam: 'Surface', c: '#12a7a8', d: 'Marsh, swamp, bog, saturated ground' },
  { k: 'bare', n: 'Bare ground', fam: 'Surface', c: '#be794d', d: 'Sand, rock, soil, scree, quarry floor' },
  {
    k: 'snow',
    n: 'Snow / ice',
    fam: 'Surface',
    c: '#dce9f2',
    d: 'Snow lying on the ground, a snowfield or a glacier',
  },
];
export const K: ClassKey[] = CLASSES.map(c => c.k);
export const CIX = Object.fromEntries(K.map((k, i) => [k, i])) as ClassMap<number>;
export const COL = Object.fromEntries(CLASSES.map(c => [c.k, c.c])) as ClassMap<string>;
export const NAME = Object.fromEntries(CLASSES.map(c => [c.k, c.n])) as ClassMap<string>;
/* Stacking order for the ribbon — the order that maximises adjacent CVD and
   normal-vision separation, from an offline search against the validator. */
export const RIBBON_ORDER: ClassKey[] = [
  'scrub',
  'rail',
  'forest',
  'water',
  'building',
  'paved',
  'grass',
  'path',
  'snow',
  'crop',
  'wetland',
  'bare',
];
export const RGB = Object.fromEntries(
  CLASSES.map(c => [c.k, [1, 3, 5].map(i => parseInt(c.c.slice(i, i + 2), 16))]),
) as ClassMap<[number, number, number]>;

/* A prior has to match the reference class of the question.
 *   probed — P(class | a coordinate a person handed this tool): people probe
 *            roads, trails and buildings far more than random hectares.
 *   land   — P(class | a random point on Earth's land). Footpaths are ~0.4%
 *            of that, so a probe on a mapped trail still reads "forest". */
export const PRIORS: Record<PriorName, ClassMap<number>> = {
  probed: {
    building: 0.07,
    paved: 0.1,
    path: 0.045,
    rail: 0.02,
    forest: 0.235,
    scrub: 0.07,
    grass: 0.155,
    crop: 0.08,
    water: 0.09,
    wetland: 0.028,
    bare: 0.099,
    snow: 0.008,
  },
  land: {
    building: 0.01,
    paved: 0.015,
    path: 0.004,
    rail: 0.001,
    forest: 0.26,
    scrub: 0.13,
    grass: 0.16,
    crop: 0.11,
    water: 0.1,
    wetland: 0.03,
    bare: 0.16,
    snow: 0.02,
  },
};
export let PRIOR: ClassMap<number> = PRIORS.probed;
/* ES modules can't assign an imported binding, so the switch lives here */
export function usePrior(name: string) {
  PRIOR = PRIORS[name as PriorName] || PRIORS.probed;
}

export const SOURCES: readonly SourceDef[] = [
  {
    id: 'contain',
    n: 'OSM polygons',
    w: 1.0,
    scale: 'area',
    d: 'Mapped polygons enclosing the point — buildings, water, wood, farmland, parks, land use (OpenFreeMap vector tiles)',
  },
  {
    id: 'prox',
    n: 'OSM lines',
    w: 1.0,
    scale: 'tread',
    d: 'Distance to every mapped centreline — roads, paths, rail, streams — against a modelled surface half-width',
  },
  {
    id: 'struct',
    n: 'Building footprints',
    w: 0.9,
    scale: 'tread',
    d: 'FEMA USA Structures — authoritative US footprints with occupancy and height',
  },
  {
    id: 'image',
    n: 'Imagery pixels',
    w: 1.0,
    scale: 'area',
    d: 'Colour and texture of the orthoimage under the point, scored by a model fitted to 1,038 labelled patches',
  },
  {
    id: 'cover',
    n: 'NLCD land cover',
    w: 0.75,
    scale: 'area',
    d: '30 m national land-cover class (CONUS), read as a sub-pixel mixture',
  },
  {
    id: 'canopy',
    n: 'Canopy & impervious',
    w: 0.85,
    scale: 'area',
    d: '30 m tree-canopy and impervious fractions, plus the descriptor that names road versus roof',
  },
  {
    id: 'terrain',
    n: 'Terrain',
    w: 0.5,
    scale: 'area',
    d: 'Slope, roughness and relief from an elevation rosette — USGS 3DEP in the US (1–10 m), a ~90 m DEM elsewhere',
  },
  {
    id: 'gaz',
    n: 'Gazetteer',
    w: 0.45,
    scale: 'tread',
    d: 'Nominatim reverse geocode — the nearest named feature and its class',
  },
  {
    id: 'today',
    n: 'Today',
    w: 0.5,
    scale: 'area',
    d: "Today's weather at the point from the Open-Meteo model, on a grid a few km wide: fresh snow lies on top of the ground; wet soil leans to wetland",
  },
];
