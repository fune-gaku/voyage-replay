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
import type { LightColour } from "./light-character.js";

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
  /**
   * Which IALA buoyage region these waters are in, which decides the lateral colours: A puts
   * red to port, B reverses it. **Japan, Korea, the Philippines and the Americas are B.**
   *
   * Stated rather than worked out from the position: the boundary is a map, not a formula,
   * and a tool that assumed one would paint every channel mark of the other region the wrong
   * colour - plausibly, and silently.
   */
  buoyageRegion?: "A" | "B";
  source?: Source;
  license?: string;
}

export const MARK_KINDS = ["buoy", "beacon"] as const;

export type MarkKind = (typeof MARK_KINDS)[number];

export const MARK_SHAPES = ["pillar", "spar", "can", "conical", "spherical"] as const;
export type MarkShape = (typeof MARK_SHAPES)[number];

export const MARK_COLOURS = ["green", "red", "yellow", "black", "white", "blue"] as const;
export type MarkColour = (typeof MARK_COLOURS)[number];

/**
 * What a mark is FOR, which is the one fact the buoyage says three ways over - in the
 * pattern, in the topmark and in the rhythm.
 *
 * Carried once so that the three cannot disagree. Stated as the mark's hand rather than its
 * colour, because **which colour that is depends on the region**: Region A puts red to port
 * and Region B reverses it, and Japan is Region B.
 */
export const MARK_PURPOSES = [
  "port-hand",
  "starboard-hand",
  "preferred-channel-to-port",
  "preferred-channel-to-starboard",
  "north-cardinal",
  "east-cardinal",
  "south-cardinal",
  "west-cardinal",
  "isolated-danger",
  "safe-water",
  "special",
  "emergency-wreck",
] as const;
export type MarkPurpose = (typeof MARK_PURPOSES)[number];

/**
 * How a beacon is built, which means **nothing at all**.
 *
 * A light list describes a beacon's form because that is what it looks like, not because it
 * signifies anything: a lattice tower and a concrete column can both be a north cardinal. The
 * buoy's counterpart is `shape`, and that one is partly meaning - a can is port hand where a
 * cone is starboard - which is why the two are different fields on different kinds (#40).
 */
export const MARK_CONSTRUCTIONS = ["tower", "lattice", "column", "pile"] as const;
export type MarkConstruction = (typeof MARK_CONSTRUCTIONS)[number];

/**
 * How the colours sit on the body. A single colour is the exception in this system: every
 * cardinal mark is banded, safe water is striped, isolated danger is banded.
 */
export interface MarkPattern {
  kind: "solid" | "horizontal bands" | "vertical stripes";
  /** Top to bottom for bands, around the body for stripes. */
  colours: MarkColour[];
}

/**
 * One appearance or one eclipse of a light, where a scenario states the timings itself.
 *
 * Absent colour is darkness. Stating these is unusual - a report gives the abbreviation, not
 * the split within the period - but a Light List entry does carry them, and a stated one must
 * beat anything this tool would generate from the abbreviation.
 */
export interface LightPhase {
  seconds: number;
  colour?: LightColour;
}

/**
 * The light a mark carries. **Its rhythm is what the mark IS**: under IALA the four cardinal
 * marks are told apart by nothing else.
 */
export interface MarkLight {
  /**
   * The Light List abbreviation - "Fl(2) W 10s", "Q(6)+LFl 15s", "Mo(A) W 7s".
   *
   * **Optional, because `purpose` can answer for it.** A report often says a mark was lit
   * without saying what it showed, and the buoyage knows: a north cardinal shows VQ because
   * it is a north cardinal. Stating the light with no character says "it was lit"; leaving
   * the whole `light` out says nothing about whether it was.
   */
  character?: string;
  phases?: LightPhase[];
  source?: Source;
}

/** What a buoy swings on. Meaningless for anything built on a foundation. */
export interface Mooring {
  depthMetres?: number;
  /** Chain length as a multiple of the depth. Two to three is usual. */
  chainScope?: number;
}

/**
 * A sea mark, which is a place rather than a passage.
 *
 * Not an `Actor`: it does not move along a track, so it has no derivation of motion and
 * nothing to say about heading. What it does have is a position - and what that position
 * MEANS depends on the kind.
 *
 * **A buoy's position is her sinker's.** She lies somewhere on a circle about it, of radius
 * `sqrt(scope^2 - depth^2)`, and in a stream on its downstream edge. **A beacon's position
 * is its own**, to the accuracy of the survey, because it is built on the ground it marks.
 * Which side of a mark a ship passed is regularly the question a report answers, and the
 * answer can sit inside a buoy's slack.
 */
export interface Mark {
  id: string;
  name?: string;
  kind: MarkKind;
  at: LatLon;
  /**
   * IALA body shape, and only a buoy has one: a can is port hand, a cone starboard. A
   * beacon's form is engineering rather than meaning, and the schema refuses it here.
   */
  shape?: MarkShape;
  /**
   * What the mark is for. **The colours, the topmark and the rhythm are all generated from
   * it** unless the file states them, so that the three cannot say different things.
   */
  purpose?: MarkPurpose;
  /**
   * The colours as they sit on the body, where a report gives them. Absent, they come from
   * `purpose` - and where neither is stated the renderer chooses, which `ui/panels.ts` says.
   */
  pattern?: MarkPattern;
  /** How a beacon is built. Meaningless for a buoy, and the schema refuses it on one. */
  construction?: MarkConstruction;
  /**
   * Whether it carried a topmark at all.
   *
   * **The purpose says what one would BE, not whether there was one.** R1001 heads that
   * column "Topmark (if any)" in every table, and notes that an authority may leave topmarks
   * off where weather or ice make them impractical. So absence is a real thing a report can
   * state, and where nothing states it, drawing one is this tool's decision rather than the
   * buoyage's - which is what `ui/panels.ts` says beside it.
   */
  topmark?: boolean;
  /**
   * Body height **above the water**, and the same datum for both kinds.
   *
   * A beacon's structure carries on below the sea to a foundation, and nothing in this
   * format states how deep that is - so a height measured from the foundation, which is what
   * a light list gives as the structure height, could not be placed against the water at
   * all. What the picture needs and what a sightline needs are the same figure: the part
   * standing above the surface.
   */
  heightMetres?: number;
  /**
   * How deep she floats, where a source gives it.
   *
   * **It sets her natural period and nothing else does** - the waterplane area cancels out of
   * `T = 2 pi sqrt(d/g)` - so a stated draught is the difference between a computed motion
   * and a modelled one. Absent, it comes from a proportion of her height chosen for her
   * shape, which is this tool's model of a buoy and not a fact about this buoy.
   */
  draughtMetres?: number;
  mooring?: Mooring;
  /**
   * **Absent means the file did not say, not that the mark was unlit.** 浮標 and 灯浮標 are
   * different marks and so are 立標 and 灯標, but a report omitting the light is the ordinary
   * case rather than a statement that there was none.
   */
  light?: MarkLight;
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
