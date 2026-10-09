/* Shared contracts. Engine and data modules are being typed against these one
 * file at a time; anything still carrying `// @ts-nocheck` predates them. */

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
  geo: any;
  q: GeoQuery | null;
  /** the imagery classifier's features for the patch under it */
  feat: unknown;
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

/** A mapped feature near the point, as the geometry query reports it. */
export interface NearFeature {
  d: number;
  w: number;
  what: string;
  name?: string;
}

/** Geometry at one location (engine/geometry geoAt). Typed where fusion reads it. */
export interface GeoQuery {
  /** mapped features per hectare-ish around the point: low means absence proves little */
  density: number;
  /** distance to the nearest OSM building, m */
  bD: number;
  /** distance to the nearest FEMA footprint, m */
  stD: number;
  /** the FEMA footprint containing the point, if any */
  stIn: unknown;
  /** nearest mapped feature per class */
  best: Partial<Record<ClassKey, NearFeature>>;
  /** set at a crossing station: the class of the line crossed */
  crossing?: ClassKey;
  /** set at a crossing on a bridge: what it crosses (river, stream…) */
  over?: string;
  /** set at a station on a stretch that follows a mapped path or road: its class */
  follow?: ClassKey;
  [k: string]: unknown;
}

/** Station-level facts gathered by the data layer (rasters, terrain, gazetteer,
 *  service availability). Loose until engine/evidence is typed. */
export type StationFacts = Record<string, any>;

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
