/**
 * What a sea mark means, and the three ways it says so.
 *
 * A north cardinal says "north" three times over: black above yellow, two cones point-up, and
 * a light showing VQ or Q. An isolated danger says its own thing with black and red bands,
 * two spheres and Fl(2). **That redundancy is the design** - the pattern is for daylight, the
 * topmark for when the colours are hard to read, the rhythm for the dark - so that losing one
 * still leaves the mark identifiable.
 *
 * Which is why the format carries the MEANING and this file generates the three. Three
 * independent fields would let a scenario state black-and-yellow bands, two spheres and
 * Fl(2): a chimera nobody could identify, drawn without complaint. Same fault this project
 * keeps fixing, one layer in - three things answering one question, free to disagree.
 *
 * Every value below comes from **IALA Recommendation R1001, "The IALA Maritime Buoyage
 * System", Edition 2.0**, Tables 1 to 11. Nothing here is invented; where the source allows
 * several rhythms, the one taken is named and the page says it was chosen.
 *
 * In `actors/mark/` rather than `core/`, beside `mooring.ts` and `light.ts`: the buoyage is
 * knowledge about one kind of thing in the scene, and `core/` is not to carry that.
 */

import type { LightCharacter } from "../../core/light-character.js";
import { parseCharacter } from "../../core/light-character.js";
import type { MarkColour, MarkPurpose, MarkShape } from "../../core/types.js";

/**
 * How the colours sit on the body.
 *
 * **A single colour is the exception in this system, not the rule.** Every cardinal mark is
 * banded, safe water is striped vertically, isolated danger is banded. A format carrying one
 * colour per mark leaves out most of the buoyage - which the schema used to say about itself
 * in a note.
 */
export interface Pattern {
  kind: "solid" | "horizontal bands" | "vertical stripes";
  /** Top to bottom for bands, and around the body for stripes. */
  colours: MarkColour[];
}

/**
 * The shape on top, which is the daylight statement when the colours cannot be told apart.
 *
 * Named as R1001 names them. The cardinal four differ only in how the two cones are turned,
 * and that difference is the whole message: point-to-point is west and base-to-base is east.
 */
export type Topmark =
  | "two cones point up"
  | "two cones base to base"
  | "two cones point down"
  | "two cones point to point"
  | "two spheres"
  | "sphere"
  | "can"
  | "cone point up"
  | "saltire"
  | "upright cross";

export interface Appearance {
  pattern: Pattern;
  topmark: { shape: Topmark; colour: MarkColour } | null;
  /** The IALA body shapes this purpose may take, the usual one first. */
  shapes: MarkShape[];
  /**
   * The rhythm, where the buoyage fixes one. Null where it does not - a lateral mark takes
   * "any other than the preferred-channel character", and inventing one would put a rhythm on
   * the water that identifies nothing.
   */
  character: LightCharacter | null;
  /** True where the source offered several and this one was taken. `ui/panels.ts` says so. */
  chosenFromSeveral: boolean;
}

/** Which colours mean port and starboard, which is the one thing the two regions disagree on. */
export type BuoyageRegion = "A" | "B";

/**
 * What this purpose looks like, or null where the region is needed and not known.
 *
 * **The region cannot be worked out from a position.** Region B is the Americas, Japan, Korea
 * and the Philippines; the boundary is a map, not a formula. A tool that assumed Region A
 * would paint every Japanese channel mark the wrong colour and put a ship on the wrong side of
 * the fairway - plausibly, and silently. So a lateral mark with no region stated gets nothing
 * generated, which is the same refusal `mooring.ts` and `light.ts` make about what they are
 * not told. Everything else is the same the world over and needs no region.
 */
export function appearanceOf(
  purpose: MarkPurpose,
  region: BuoyageRegion | null,
): Appearance | null {
  if (isLateral(purpose)) return region === null ? null : lateral(purpose, region);
  return { ...FIXED[purpose], character: characterOf(purpose) };
}

/** The purposes whose colours the two regions reverse (R1001 section 2.1.1). */
type Lateral =
  "port-hand" | "starboard-hand" | "preferred-channel-to-port" | "preferred-channel-to-starboard";

const LATERAL: Lateral[] = [
  "port-hand",
  "starboard-hand",
  "preferred-channel-to-port",
  "preferred-channel-to-starboard",
];

function isLateral(purpose: MarkPurpose): purpose is Lateral {
  return LATERAL.some((hand) => hand === purpose);
}

/**
 * Region A uses red to port and green to starboard; **Region B reverses them** (R1001 2.1.1).
 * Japan is Region B, and this project's reference case is in Japanese waters.
 *
 * The hand of the mark, not the colour, is what the file states - so the swap happens once,
 * here, rather than at each place that draws or prints one.
 */
function lateral(purpose: Lateral, region: BuoyageRegion): Appearance {
  const { own, other, toPort, preferred } = handOf(purpose, region);
  return {
    pattern: preferred
      ? { kind: "horizontal bands", colours: [own, other, own] }
      : { kind: "solid", colours: [own] },
    topmark: { shape: toPort ? "can" : "cone point up", colour: own },
    shapes: toPort ? ["can", "pillar", "spar"] : ["conical", "pillar", "spar"],
    // A preferred-channel mark is the one lateral character the buoyage fixes: composite
    // group flashing (2+1). The period is not fixed, so none is stated here either.
    character: preferred ? read(`Fl(2+1) ${lamp(own)}`) : null,
    chosenFromSeveral: false,
  };
}

/**
 * Which side of the channel this mark stands on, and therefore which colour it wears.
 *
 * The hand is what the file states and the colour follows from the region - **Region A puts
 * red to port, Region B reverses it** - so the swap lives here and nowhere else. And a
 * "preferred channel to starboard" mark is one you leave to PORT: it is shaped and coloured
 * as a port-hand mark, with a band of the other colour across it (R1001 Tables 3 and 4).
 */
function handOf(
  purpose: Lateral,
  region: BuoyageRegion,
): { own: MarkColour; other: MarkColour; toPort: boolean; preferred: boolean } {
  const port: MarkColour = region === "A" ? "red" : "green";
  const starboard: MarkColour = region === "A" ? "green" : "red";
  const toPort = purpose === "port-hand" || purpose === "preferred-channel-to-starboard";
  return {
    own: toPort ? port : starboard,
    other: toPort ? starboard : port,
    toPort,
    preferred: purpose !== "port-hand" && purpose !== "starboard-hand",
  };
}

/** The lateral colours are red and green, and those are the lights they show. */
function lamp(colour: MarkColour): string {
  return colour === "red" ? "R" : "G";
}

/** Everything the two regions agree about: R1001 Tables 5 to 11. */
const FIXED: Record<Exclude<MarkPurpose, Lateral>, Omit<Appearance, "character">> = {
  "north-cardinal": {
    pattern: { kind: "horizontal bands", colours: ["black", "yellow"] },
    topmark: { shape: "two cones point up", colour: "black" },
    shapes: ["pillar", "spar"],
    chosenFromSeveral: true,
  },
  "east-cardinal": {
    pattern: { kind: "horizontal bands", colours: ["black", "yellow", "black"] },
    topmark: { shape: "two cones base to base", colour: "black" },
    shapes: ["pillar", "spar"],
    chosenFromSeveral: true,
  },
  "south-cardinal": {
    pattern: { kind: "horizontal bands", colours: ["yellow", "black"] },
    topmark: { shape: "two cones point down", colour: "black" },
    shapes: ["pillar", "spar"],
    chosenFromSeveral: true,
  },
  "west-cardinal": {
    pattern: { kind: "horizontal bands", colours: ["yellow", "black", "yellow"] },
    topmark: { shape: "two cones point to point", colour: "black" },
    shapes: ["pillar", "spar"],
    chosenFromSeveral: true,
  },
  "isolated-danger": {
    pattern: { kind: "horizontal bands", colours: ["black", "red", "black"] },
    topmark: { shape: "two spheres", colour: "black" },
    shapes: ["pillar", "spar"],
    chosenFromSeveral: true,
  },
  "safe-water": {
    pattern: { kind: "vertical stripes", colours: ["red", "white"] },
    topmark: { shape: "sphere", colour: "red" },
    shapes: ["spherical", "pillar", "spar"],
    chosenFromSeveral: true,
  },
  special: {
    pattern: { kind: "solid", colours: ["yellow"] },
    topmark: { shape: "saltire", colour: "yellow" },
    shapes: ["pillar", "spar", "can"],
    chosenFromSeveral: false,
  },
  "emergency-wreck": {
    pattern: { kind: "vertical stripes", colours: ["blue", "yellow", "blue", "yellow"] },
    // "Vertical/perpendicular yellow cross" (Table 11), where the special mark's is an X
    // (Table 9). Two marks, two shapes: drawn alike, one would be read as the other.
    topmark: { shape: "upright cross", colour: "yellow" },
    shapes: ["pillar", "spar"],
    chosenFromSeveral: false,
  },
};

/**
 * The rhythm the buoyage assigns, where it assigns one.
 *
 * **Several classes are allowed for most of these, and the one taken is the one the source
 * pins completely.** A north cardinal may be VQ or Q, and R1001 names the very quick rate
 * first. A safe-water mark may be isophase, occulting, a long flash every ten seconds or
 * Morse A - and only the long flash comes with its period attached, so the other three would
 * need a period invented here to be drawn at all.
 *
 * Null for a lateral or a special mark, where the buoyage fixes nothing: "any other than
 * those reserved". A rhythm chosen there would identify nothing while looking as if it did.
 */
function characterOf(purpose: Exclude<MarkPurpose, Lateral>): LightCharacter | null {
  const written: Partial<Record<MarkPurpose, string>> = {
    "north-cardinal": "VQ W",
    "east-cardinal": "VQ(3) W 5s",
    "south-cardinal": "VQ(6)+LFl W 10s",
    "west-cardinal": "VQ(9) W 10s",
    "isolated-danger": "Fl(2) W 5s",
    "safe-water": "LFl W 10s",
    "emergency-wreck": "OcAl BuY 3s",
  };
  const text = written[purpose];
  return text === undefined ? null : read(text);
}

/**
 * The characters above are constants of the buoyage, so one that will not parse is this
 * file's own mistake rather than a scenario's - and returning null would hide it as "the
 * buoyage fixes no rhythm here", which is a different fact. `test/buoyage.spec.ts` reads
 * every one of them.
 */
function read(text: string): LightCharacter {
  const reading = parseCharacter(text);
  if (!reading.read) throw new Error(`the buoyage's own character ${text} did not parse`);
  return reading.character;
}
