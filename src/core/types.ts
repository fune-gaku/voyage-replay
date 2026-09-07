/**
 * TypeScript mirror of spec/voyage.schema.json.
 *
 * The schema is the contract - it is what CI validates every example against and what
 * a consumer in another language reads. These types exist so our own code is checked,
 * and they must be changed together with the schema. test/schema.spec.ts pins the two
 * to each other on the fields that matter.
 */

// Each closed set is declared once as a runtime array and the type derived from it, so
// test/schema.spec.ts can compare it with the schema's own enum. A union written by hand
// vanishes at runtime and drifts from the schema with nothing to catch it.
export const DERIVATIONS = ["measured", "digitised", "inferred", "interpolated"] as const;
export type Derivation = (typeof DERIVATIONS)[number];

export const SOURCE_KINDS = [
  "jtsb-report",
  "ntsb-report",
  "maib-report",
  "ais-archive",
  "authored",
  "other",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Source {
  kind: SourceKind;
  id?: string;
  url?: string;
  publishedAt?: string;
  /** Precise enough to check by hand, e.g. "Appendix table 1, p.14". */
  citation?: string;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TrackPoint {
  /** ISO 8601 with offset. */
  t: string;
  lat: number;
  lon: number;
  /** Course over ground - where the ship is going. */
  cogDegreesTrue?: number;
  /**
   * Where the bow points. Frequently absent: a Class B AIS transponder does not
   * transmit heading. Never substitute the course over ground for it.
   */
  headingDegreesTrue?: number;
  sogKnots?: number;
  derivation?: Derivation;
  note?: string;
}

export interface Track {
  derivation: Derivation;
  /** What the lat/lon refers to on the hull. */
  positionAt: "gps-antenna" | "reference-point";
  source?: Source;
  note?: string;
  points: TrackPoint[];
}

export const VESSEL_TYPES = [
  "power-driven",
  "tanker",
  "cargo",
  "container",
  "fishing",
  "sailing",
  "pushing-ahead",
  "towing",
  "pleasure",
  "passenger",
  "unknown",
] as const;
export type VesselType = (typeof VESSEL_TYPES)[number];

/** The four AIS message 5 dimension fields. */
export interface ReferencePointOffsets {
  fromBowMetres: number;
  fromSternMetres: number;
  fromPortMetres: number;
  fromStarboardMetres: number;
}

export interface Vessel {
  loaMetres: number;
  beamMetres: number;
  draughtMetres?: number;
  grossTonnage?: number;
  type?: VesselType;
  referencePointOffsets?: ReferencePointOffsets;
}

export interface Actor {
  id: string;
  kind: "vessel";
  name?: string;
  vessel?: Vessel;
  track: Track;
}

/**
 * The sea, as somebody wrote it down.
 *
 * Separate from `seaState` rather than replacing it, because the two are different
 * statements: a sea state is a class read off the water's appearance, and these are
 * figures. `derivation` is required for the same reason it is required on a track point -
 * a wave height reconstructed from a witness saying "she was pitching heavily" is not a
 * buoy record, and a reconstruction that cannot tell them apart cannot be checked.
 */
export interface Waves {
  significantHeightMetres: number;
  /** Period of the spectral peak. Assumed from the height where it is not stated. */
  peakPeriodSeconds?: number;
  /** Direction the waves come FROM, degrees true - the convention reports use. */
  fromDegreesTrue?: number;
  derivation: Derivation;
}

/**
 * The wind, as somebody wrote it down.
 *
 * The one weather figure a deck log always has, and the one that settles a wave direction a
 * sea state cannot give. Either a speed or a force may be stated, or both, or neither -
 * a force is a CLASS and is carried as one, never collapsed to a midpoint, for the same
 * reason a sea state is not.
 */
export interface Wind {
  /** Direction it blows FROM, degrees true - the convention reports use. */
  fromDegreesTrue?: number;
  speedKnots?: number;
  beaufortForce?: number;
  derivation: Derivation;
}

export interface Environment {
  lightCondition?: "day" | "night" | "twilight" | "restricted-visibility";
  visibilityMetres?: number | null;
  seaState?: number | null;
  waves?: Waves;
  wind?: Wind;
  current?: { setDegreesTrue?: number; driftKnots?: number };
}

export interface ScenarioMeta {
  title: string;
  description?: string;
  /** ISO 8601 with offset. For a collision, the moment of contact. */
  occurredAt: string;
  timeZone: string;
  locality?: string;
  source?: Source;
  license?: string;
}

export const MARK_SHAPES = ["pillar", "spar", "can", "conical", "spherical"] as const;
export type MarkShape = (typeof MARK_SHAPES)[number];

export const MARK_COLOURS = ["green", "red", "yellow", "black", "white"] as const;
export type MarkColour = (typeof MARK_COLOURS)[number];

/**
 * A sea mark, which is a place rather than a passage.
 *
 * Not an `Actor`: it does not move, so it has no track, no derivation of motion and nothing
 * to say about heading. What it does have is a fixed position, which is often the thing a
 * report turns on - which side of the buoy she passed.
 */
export interface Mark {
  id: string;
  name?: string;
  kind: "buoy";
  at: LatLon;
  shape?: MarkShape;
  colour?: MarkColour;
  heightMetres?: number;
  source?: Source;
}

export interface Scenario {
  $schema?: string;
  formatVersion: string;
  meta: ScenarioMeta;
  origin: LatLon;
  environment?: Environment;
  actors: Actor[];
  marks?: Mark[];
}
