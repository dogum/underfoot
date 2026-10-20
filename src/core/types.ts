/* Shared contracts: the shapes more than one module reads. Everything in src/
 * is typed against them. */
import type { Projector } from './geo';

/** The twelve things a point on the ground can be. Order matters: it is the index into every probability vector. */
export type ClassKey =
  | 'building'
  | 'paved'
  | 'path'
  | 'rail'
  | 'forest'
  | 'scrub'
  | 'grass'
  | 'crop'
  | 'water'
  | 'wetland'
  | 'bare'
  | 'snow';

export interface ClassDef {
  /** key used everywhere in code */
  k: ClassKey;
  /** display name */
  n: string;
  /** family, for grouping in the UI */
  fam: 'Built' | 'Vegetated' | 'Surface';
  /** colour, validated against the dark surface for CVD separation */
  c: string;
  /** one-line definition shown under the verdict */
  d: string;
}

export type SourceId =
  | 'contain'
  | 'prox'
  | 'struct'
  | 'image'
  | 'cover'
  | 'canopy'
  | 'terrain'
  | 'gaz'
  | 'today'
  | 'pass'
  | 'world';

export interface SourceDef {
  id: SourceId;
  n: string;
  /** default weight on this source's log-likelihood */
  w: number;
  /** 'area' sources see a footprint; 'tread' sources see a line or a point */
  scale: 'area' | 'tread';
  d: string;
}

export type PriorName = 'probed' | 'land';
export type ClassMap<T> = Record<ClassKey, T>;

export interface LatLon {
  lat: number;
  lon: number;
}

/** A probability or log-likelihood vector over the classes, indexed by CIX. */
export type ClassVec = Float64Array;

/** quiet: the source answered but had nothing to say this time, so it stays out of the fusion */
export type SourceStatus = 'ok' | 'wait' | 'na' | 'err' | 'quiet';

/** A defined crossing (the line passes over a mapped road, path, rail or stream
 *  here): the crossed class's probability is set directly, outside the discount. */
export interface ExactTerm {
  cls: ClassKey;
  p: number;
}

/** What one evidence source said about one location. */
export interface SourcePart {
  /** centred log-likelihood per class, in nats */
  ll: ClassVec;
  status: SourceStatus;
  /** per-call weight multiplier (old or coarse imagery, a thin map) */
  wmul?: number;
  /** the human-readable reasoning shown in the ledger */
  note?: string;
  exact?: ExactTerm | null;
  /** a class lying on top of the ground (fresh snow) with probability p: the
   *  answer becomes p of it and 1 − p of whatever is underneath (engine/fuse) */
  onTop?: ExactTerm | null;
}
export type Parts = Partial<Record<SourceId, SourcePart>>;

/** A mapped line the drawn line crosses (app/stations findCrossings). */
export interface Crossing {
  /** metres along the line */
  d: number;
  cls: ClassKey;
  what: string;
  name: string | null;
  /** a crossing on a bridge: what the bridge carries the line over (river, stream…) */
  over?: string;
  /** m: half the width of what's crossed, as mapped (a road's modelled half-width, half a building's chord) */
  w?: number;
}
/** One station along the line: where the engine reads the ground. */
export interface Station extends LatLon {
  /** metres along the line */
  d: number;
  /** set at a crossing station */
  x?: Crossing;
  /** set on a stretch that follows a mapped path or road: which stretch, its class, and how far the station moved onto it */
  f?: { k: number; cls: ClassKey; off: number };
  /** where the line put the station before it moved onto a followed path */
  raw?: LatLon;
}

/** How unsure a station's answer is, and why (engine/doubt). */
export interface Doubt {
  /** 0–1: how much this answer is worth checking */
  score: number;
  /** 0–1: how close the call is to its runner-up */
  close: number;
  /** 0–1: the share of the sources with a clear favourite (by weight) whose favourite isn't the call */
  spread: number;
  /** the dissenting source that prefers its own favourite most strongly: what it would rather, by how many bits */
  against: { id: SourceId; n: string; cls: ClassKey; bits: number } | null;
  /** the source that backs the call most clearly, by how many bits */
  backer: { id: SourceId; n: string; bits: number } | null;
  runnerUp: ClassKey;
}

/** What the app knows about one station: its facts, its geometry, and the fused answer (app/sound). */
export interface StationResult {
  station: Station;
  /** the projected map around it (engine/geometry buildGeo) */
  geo: GeoIndex | null;
  q: GeoQuery | null;
  /** the imagery classifier's features for the patch under it */
  feat: ImgFeatures | null;
  img: any;
  sh: StationFacts;
  parts?: Parts;
  fused: Fused | null;
  /** what the readout shows: the raw answer, smoothed along the line, at a crossing, or averaged under a GPS disc */
  view: Fused | null;
  mode?: 'raw' | 'smoothed' | 'crossing' | 'gps';
  /** how much the answer shown is worth a second look */
  doubt?: Doubt | null;
}

/** Colour and texture statistics of an imagery window (engine/imagery-model imgStats). */
export interface ImgStats {
  /** median, 10th and 90th percentile luminance */
  L: number;
  L10: number;
  L90: number;
  /** median saturation */
  S: number;
  /** excess green: median, 10th and 90th percentile */
  G: number;
  G10: number;
  G90: number;
  /** median blueness and redness */
  B: number;
  R: number;
  /** log texture (luminance sd) and log edge strength */
  T: number;
  E: number;
  /** share of dark pixels */
  D: number;
  sd: number;
  edge: number;
}

/** What the imagery classifier reads from one patch: the model's 23 inputs and the stats behind them. */
export interface ImgFeatures {
  v: number[];
  core: ImgStats;
  ctx: ImgStats;
}

/** One feature decoded from a vector tile (data/mvt): rings of [lon, lat, lon, lat, …]. */
export interface TileFeature {
  /** layer name: transportation, waterway, building, landcover… */
  L: string;
  /** geometry type: 1 point, 2 line, 3 polygon */
  t: number;
  /** OpenMapTiles properties: class, subclass, name, brunnel… */
  p: Record<string, any>;
  r: ArrayLike<number>[];
  /** [west, south, east, north] */
  bb: number[];
}

/** A mapped line as ground (engine/geometry lineRule): its class, modelled half-width (m) and kind. */
export interface LineRule {
  cls: ClassKey;
  w: number;
  what: string;
}

/** What a FEMA USA Structures footprint says about its building (data/fema). */
export interface StructAttrs {
  OBJECTID?: number;
  OCC_CLS?: string;
  PRIM_OCC?: string;
  /** m */
  HEIGHT?: number;
  SQFEET?: number;
}
/** A footprint as data/fema returns it: rings of [lon, lat, lon, lat, …]. */
export interface StructFeature {
  id: number;
  a: StructAttrs;
  r: number[][];
}

/* The geo index (engine/geometry buildGeo): everything near a station projected
   into its tangent plane, in metres. Each shape is [x, y, x, y, …] with its
   bounding box [x0, y0, x1, y1]. */
export interface GeoPoly {
  rule: string;
  rings: Float64Array[];
  bb: number[];
  name: string | null;
  /** the vector tile layer and OpenMapTiles class it came from */
  L: string;
  cls?: string;
  sub?: string;
}
export interface GeoFootprint {
  a: Float64Array;
  bb: number[];
  /** m² */
  area: number;
}
export interface GeoLine extends LineRule {
  a: Float64Array;
  bb: number[];
  surface: string | null;
}
/** a street's name, from the tiles' name layer */
export interface GeoName {
  cls: string;
  name: string;
  a: Float64Array;
}
export interface GeoStruct extends GeoFootprint {
  attr: StructAttrs;
}
export interface GeoIndex {
  st: LatLon;
  P: Projector;
  polys: GeoPoly[];
  /** OSM building footprints */
  blds: GeoFootprint[];
  lines: GeoLine[];
  names: GeoName[];
  /** FEMA footprints */
  sts: GeoStruct[];
  /** how many buildings and lines are near: low means absence proves little */
  density: number;
  /** m: the index's reach */
  R: number;
}

/** A mapped feature near the point, as the geometry query reports it. */
export interface NearFeature {
  d: number;
  w: number;
  what: string;
  name?: string | null;
  surface?: string | null;
  /** the line itself, kept only while its name is looked up */
  a?: Float64Array | null;
}

/** A mapped polygon that encloses the point: its rule, area (m²), name and how far its edge is (m). */
export interface Enclosing {
  rule: string;
  area: number;
  name: string | null;
  edge: number;
}

/** Geometry at one location (engine/geometry geoAt). */
export interface GeoQuery {
  /** the mapped polygons around the point, a building's footprint among them */
  enclosing: Enclosing[];
  /** mapped features per hectare-ish around the point: low means absence proves little */
  density: number;
  /** distance to the nearest OSM building, m */
  bD: number;
  /** distance to the nearest FEMA footprint, m */
  stD: number;
  /** the FEMA footprint containing the point, if any */
  stIn: GeoStruct | null;
  /** the nearest FEMA footprint outside it */
  stNear?: GeoStruct | null;
  /** nearest mapped feature per class */
  best: Partial<Record<ClassKey, NearFeature>>;
  /** set at a crossing station: the class of the line crossed */
  crossing?: ClassKey;
  /** set at a crossing on a bridge: what it crosses (river, stream…) */
  over?: string;
  /** set at a station on a stretch that follows a mapped path or road: its class */
  follow?: ClassKey;
}

/** NLCD 2021 at a station's 30 m pixel (data/nlcd): land cover, tree canopy and impervious share. */
export interface NlcdFacts {
  code?: number | null;
  name?: string | null;
  /** % */
  canopy?: number | null;
  /** % */
  imperv?: number | null;
  /** the impervious descriptor's code (20 primary road … 29), and its name */
  desc?: number | null;
  descName?: string | null;
}

/** A geometry in a gazetteer answer (GeoJSON). */
export interface GazGeometry {
  type: string;
  coordinates: any;
}
/** Nominatim's reverse geocode at a station (data/nominatim): the nearest addressable object. */
export interface GazFacts {
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  geojson?: GazGeometry;
  error?: string;
  [k: string]: unknown;
}

/** Terrain at a station from a rosette of elevations (engine/terrain terrainFrom). */
export interface Terrain {
  /** degrees */
  slope: number;
  /** m: RMS of the ring about the fitted plane */
  rough: number;
  /** m: the centre against the ring's mean (negative in a hollow or a channel) */
  rel: number;
  /** m: elevation at the centre */
  z: number;
  /** m: the ring's radius */
  r: number;
  /** which elevation service and cell, for the ledger */
  src: string;
  /** m: the elevation data's cell size */
  res: number;
  /** an all-zero rosette from the global DEM: open sea */
  ocean: boolean;
}

/** The imagery's capture under a station (data/imagery imageryMeta). */
export interface ImageryMeta {
  /** acquisition date, YYYY-MM-DD; null when Esri has no dated photo at z18 here */
  date: string | null;
  /** source resolution, metres per pixel */
  res?: number | null;
  /** stated horizontal accuracy in metres; null when unknown */
  acc?: number | null;
  /** who captured it, e.g. "Vivid Advanced" or "Salt Lake County 2024" */
  src?: string | null;
}

/** Station-level facts gathered by the data layer, filled in as each source lands
 *  (app/sound). undefined: still reading; null: failed or not covered. */
export interface StationFacts {
  pt?: LatLon;
  /** inside the lower 48 (NLCD's reach) */
  conus?: boolean;
  /** inside the US (3DEP, FEMA, the soil survey) */
  inUS?: boolean;
  nlcd?: NlcdFacts | null;
  terr?: Terrain | null;
  nom?: GazFacts | null;
  /** the gazetteer is asked only for the station in focus */
  gazAsked?: boolean;
  structOk?: boolean;
  osmErr?: string | null;
  structErr?: string | null;
  imgErr?: string | null;
  /** the imagery's weight, lowered for old or coarse pictures */
  imgWmul?: number;
  imeta?: ImageryMeta | null;
  today?: TodayFacts | null;
  pass?: PassFacts | null;
  world?: WorldFacts | null;
  soil?: SoilFacts | null;
  /** probabilities only, no ledger notes (the field map's cells) */
  lite?: boolean;
}

/** Today's weather at a station (data/today, Open-Meteo): model values on a grid a few km wide */
export interface TodayFacts {
  /** local time of the reading, as Open-Meteo gives it (YYYY-MM-DDTHH:MM) */
  time: string;
  /** snow depth, m */
  snow: number;
  /** volumetric soil moisture in the top centimetre, m³/m³; null where the model has none */
  soil: number | null;
  /** rain over the last three days (two past days and today), mm */
  rain3: number;
  /** snowfall over the last seven days, cm */
  snow7: number;
  /** the model grid cell the point fell in, and how far its centre is */
  grid: { lat: number; lon: number; elev: number; km: number };
  /** snowfall day by day, oldest first (YYYY-MM-DD, cm), so it can be counted since a satellite pass */
  snowfall: { date: string; cm: number }[];
}

/** The newest clear Sentinel-2 pass at a station (data/sentinel) */
export interface PassFacts {
  /** the scene, its date (YYYY-MM-DD) and its age in days */
  id: string;
  date: string;
  days: number;
  /** the scene class at the 20 m pixel (Sentinel-2 SCL); null when every pass in reach had cloud over the point */
  scl: number | null;
  /** newer passes passed over for cloud, shadow or no data at the point, by date */
  skipped: string[];
  /** the scene's classification file and grid, so a field map can read the pixels around the station */
  scene?: { href: string; epsg: number; transform: number[]; bbox: number[] };
}

/** The global land cover's class under a station (data/worldcover): Impact Observatory's 10 m map */
export interface WorldFacts {
  /** the map's class code (1 water, 2 trees, 4 flooded vegetation, 5 crops, 7 built area, 8 bare ground, 9 snow / ice, 10 clouds, 11 rangeland) */
  code: number;
  /** the year of the map it came from */
  year: number;
}

/** The main soil under a US station (data/soils): USDA's survey, for go / slow / no-go */
export interface SoilFacts {
  /** the map unit's name, e.g. "Elcapitan fine sandy loam, 0 to 2 percent slopes" */
  unit: string;
  /** drainage class, e.g. "Somewhat poorly drained"; null where the survey has none (water, rock) */
  drainage: string | null;
  /** hydrologic soil group, A (drains fast) to D (slow), or dual like "B/D" */
  group: string | null;
}

export interface FuseOptions {
  weights: Partial<Record<SourceId, number>>;
  /** effective number of independent sources; sets the correlation discount τ */
  neff?: number;
  prior?: ClassMap<number>;
  /** probabilities only, no ledger (the field map fuses 3,600 cells) */
  lite?: boolean;
}

export interface Posterior {
  /** probabilities, indexed by CIX */
  p: number[];
  /** class indices, most to least likely */
  order: number[];
  top: ClassKey;
  topP: number;
  margin: number;
  /** entropy in bits */
  bits: number;
  /** 1 − H/Hmax: how far the evidence moved us from knowing nothing */
  conf: number;
}

export interface LedgerRow {
  id: SourceId;
  n: string;
  d: string;
  /** effective weight (base × per-call multiplier) */
  w: number;
  wbase: number;
  status: SourceStatus;
  note?: string;
  /** this source's contribution to the winning class, in bits */
  bits: number;
  ll?: ClassVec;
}

export interface PosteriorExtras {
  parts?: Parts;
  tau?: number;
  wsum?: number;
  W?: Partial<Record<SourceId, number>>;
  exact?: ExactTerm | null;
  /** fresh snow on top of the ground (engine/today) */
  onTop?: ExactTerm | null;
  prior?: ClassMap<number>;
}
export type Fused = Posterior & PosteriorExtras & { ledger?: LedgerRow[] };

/** one shared mark, as the store's table has it */
export interface SharedRow {
  /** the mark's own random id: the store refuses a second copy */
  id: string;
  /** this browser's random id, so the fit can count one person as one */
  who: string;
  version: string;
  /** YYYY-MM, when it was made */
  month: string;
  /** the 1° cell it's in, e.g. N37W120 */
  cell: string;
  verdict: 'right' | 'wrong';
  call: ClassKey;
  p_call: number;
  truth: ClassKey;
  how: 'here' | 'photo' | 'imagery' | 'local' | null;
  prior: string;
  /** each source's log-likelihoods by class, with its status, weight multiplier and any exact term */
  readings: Partial<
    Record<SourceId, { ll: Record<ClassKey, number>; status: SourceStatus; wmul?: number; exact?: ExactTerm }>
  >;
  /** only when the person chose to share the exact points */
  lat: number | null;
  lon: number | null;
}

/** model/weights.json: the weights the app loads, and where they came from */
export interface WeightsFile {
  version: number;
  date: string;
  /** shared marks the round saw, and the people they came from */
  marks: number;
  people: number;
  weights: Record<SourceId, number>;
  neff: number;
  note: string;
}
