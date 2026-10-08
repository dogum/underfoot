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

export type SourceId = 'contain' | 'prox' | 'struct' | 'image' | 'cover' | 'canopy' | 'terrain' | 'gaz';

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

export type SourceStatus = 'ok' | 'wait' | 'na' | 'err';

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
  prior?: ClassMap<number>;
}
export type Fused = Posterior & PosteriorExtras & { ledger?: LedgerRow[] };
