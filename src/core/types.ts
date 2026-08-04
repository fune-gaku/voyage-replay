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

export interface Environment {
  lightCondition?: "day" | "night" | "twilight" | "restricted-visibility";
  visibilityMetres?: number | null;
  seaState?: number | null;
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

export interface Scenario {
  $schema?: string;
  formatVersion: string;
  meta: ScenarioMeta;
  origin: LatLon;
  environment?: Environment;
  actors: Actor[];
}
