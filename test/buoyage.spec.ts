import { describe, expect, it } from "vitest";

import { appearanceOf, type Appearance } from "../src/actors/mark/buoyage.js";
import { formatCharacter } from "../src/core/light-character.js";
import { MARK_PURPOSES, type MarkPurpose } from "../src/core/types.js";

/**
 * Every expectation here is read off **IALA Recommendation R1001, "The IALA Maritime Buoyage
 * System", Edition 2.0**, Tables 1 to 11 - the tables themselves, not this implementation's
 * arithmetic, for the reason `test/celestial.spec.ts` gives about the sun.
 *
 * What the tests are really holding is that **one fact produces three statements that agree**.
 * A mark says what it is in its colours, in its topmark and in its rhythm, and the whole point
 * of generating them from the purpose is that they cannot come apart.
 */

function appearance(purpose: MarkPurpose, region: "A" | "B" | null = null): Appearance {
  const found = appearanceOf(purpose, region);
  if (!found) throw new Error(`${purpose} has no appearance in region ${String(region)}`);
  return found;
}

function rhythm(purpose: MarkPurpose, region: "A" | "B" | null = null): string {
  const character = appearance(purpose, region).character;
  return character === null ? "none" : formatCharacter(character);
}

describe("the cardinal marks, which are told apart by nothing else", () => {
  /**
   * R1001 Tables 5 and 6. The bands go the way the cones point: black over yellow with the
   * cones up is north, yellow over black with them down is south. Reverse either and the mark
   * is the opposite quadrant - a ship told to pass north of a danger would pass south of it.
   */
  it("puts the black band where the cones point", () => {
    expect(appearance("north-cardinal").pattern).toEqual({
      kind: "horizontal bands",
      colours: ["black", "yellow"],
    });
    expect(appearance("south-cardinal").pattern).toEqual({
      kind: "horizontal bands",
      colours: ["yellow", "black"],
    });
    expect(appearance("north-cardinal").topmark?.shape).toBe("two cones point up");
    expect(appearance("south-cardinal").topmark?.shape).toBe("two cones point down");
  });

  /** East is black with one yellow band; west is yellow with one black band. */
  it("bands east and west the other way round from each other", () => {
    expect(appearance("east-cardinal").pattern.colours).toEqual(["black", "yellow", "black"]);
    expect(appearance("west-cardinal").pattern.colours).toEqual(["yellow", "black", "yellow"]);
    expect(appearance("east-cardinal").topmark?.shape).toBe("two cones base to base");
    expect(appearance("west-cardinal").topmark?.shape).toBe("two cones point to point");
  });

  /**
   * R1001 Tables 5 and 6 again, in the light column. The count of the flashes carries the
   * quadrant: three for east, six and a long flash for south, nine for west.
   */
  it("gives each quadrant the rhythm the buoyage assigns it", () => {
    expect(rhythm("north-cardinal")).toBe("VQ W");
    expect(rhythm("east-cardinal")).toBe("VQ(3) W 5s");
    expect(rhythm("south-cardinal")).toBe("VQ(6)+LFl W 10s");
    expect(rhythm("west-cardinal")).toBe("VQ(9) W 10s");
  });

  /** All four are the same the world over: the region only touches the lateral marks. */
  it("needs no region, in either region", () => {
    for (const region of ["A", "B", null] as const) {
      expect(appearance("north-cardinal", region).pattern.colours).toEqual(["black", "yellow"]);
    }
  });
});

/**
 * The one thing the two regions disagree about - and the reason the format states the mark's
 * HAND rather than its colour. **Japan is Region B.**
 */
describe("lateral marks, whose colours the regions reverse", () => {
  it("puts red to port in Region A and green to port in Region B", () => {
    expect(appearance("port-hand", "A").pattern.colours).toEqual(["red"]);
    expect(appearance("port-hand", "B").pattern.colours).toEqual(["green"]);
    expect(appearance("starboard-hand", "A").pattern.colours).toEqual(["green"]);
    expect(appearance("starboard-hand", "B").pattern.colours).toEqual(["red"]);
  });

  /** R1001 Tables 1 and 2: a can to port, a cone point upward to starboard, either region. */
  it("keeps the shapes the same in both regions, since only the colours swap", () => {
    for (const region of ["A", "B"] as const) {
      expect(appearance("port-hand", region).topmark?.shape).toBe("can");
      expect(appearance("port-hand", region).shapes[0]).toBe("can");
      expect(appearance("starboard-hand", region).topmark?.shape).toBe("cone point up");
      expect(appearance("starboard-hand", region).shapes[0]).toBe("conical");
    }
  });

  /**
   * R1001 Tables 3 and 4. A "preferred channel to starboard" mark is one you leave to PORT,
   * so it is a port-hand mark with a band of the other colour across it - and in Region B
   * that means green with a red band.
   */
  it("bands a preferred-channel mark in the other colour, its own outside", () => {
    expect(appearance("preferred-channel-to-starboard", "B").pattern).toEqual({
      kind: "horizontal bands",
      colours: ["green", "red", "green"],
    });
    expect(appearance("preferred-channel-to-port", "B").pattern.colours).toEqual([
      "red",
      "green",
      "red",
    ]);
    expect(appearance("preferred-channel-to-starboard", "A").pattern.colours).toEqual([
      "red",
      "green",
      "red",
    ]);
  });

  /** The one lateral rhythm the buoyage fixes, and it shows the mark's own colour. */
  it("gives a preferred-channel mark the composite group the buoyage reserves for it", () => {
    expect(rhythm("preferred-channel-to-starboard", "B")).toBe("Fl(2+1) G");
    expect(rhythm("preferred-channel-to-port", "B")).toBe("Fl(2+1) R");
  });

  /**
   * **An ordinary lateral mark takes "any character other than that one"**, so there is
   * nothing to generate. A rhythm chosen here would identify nothing while looking as though
   * it identified something.
   */
  it("gives an ordinary lateral mark no rhythm at all", () => {
    expect(rhythm("port-hand", "B")).toBe("none");
    expect(rhythm("starboard-hand", "A")).toBe("none");
  });

  /**
   * The refusal that matters most. The boundary between the regions is a map, not a formula,
   * so a lateral mark with no region stated gets nothing - rather than the wrong colour drawn
   * plausibly and silently, which would put a ship on the wrong side of the fairway.
   */
  it("refuses to colour a lateral mark when the region is not stated", () => {
    expect(appearanceOf("port-hand", null)).toBeNull();
    expect(appearanceOf("starboard-hand", null)).toBeNull();
    expect(appearanceOf("preferred-channel-to-port", null)).toBeNull();
    expect(appearanceOf("preferred-channel-to-starboard", null)).toBeNull();
  });
});

describe("the marks that are neither lateral nor cardinal", () => {
  /** R1001 Table 7: black with red bands, two black spheres, white Fl(2). */
  it("gives an isolated danger its bands, its spheres and its two flashes", () => {
    expect(appearance("isolated-danger").pattern.colours).toEqual(["black", "red", "black"]);
    expect(appearance("isolated-danger").topmark?.shape).toBe("two spheres");
    expect(rhythm("isolated-danger")).toBe("Fl(2) W 5s");
  });

  /**
   * R1001 Table 8: red and white VERTICAL stripes, a single red sphere. The stripes are what
   * separate it from every danger mark at a glance, all of which are banded horizontally.
   */
  it("stripes safe water vertically, where the danger marks are banded across", () => {
    expect(appearance("safe-water").pattern).toEqual({
      kind: "vertical stripes",
      colours: ["red", "white"],
    });
    expect(appearance("safe-water").topmark?.shape).toBe("sphere");
    expect(appearance("isolated-danger").pattern.kind).toBe("horizontal bands");
  });

  /**
   * Of the four rhythms R1001 allows a safe-water mark, only the long flash comes with its
   * period attached - the others would need one invented here to be drawn at all.
   */
  it("takes the safe-water rhythm the source states completely", () => {
    expect(rhythm("safe-water")).toBe("LFl W 10s");
    expect(appearance("safe-water").chosenFromSeveral).toBe(true);
  });

  /** R1001 Table 9: yellow, a yellow X, and any rhythm not reserved for something else. */
  it("gives a special mark its yellow and its cross, and no rhythm", () => {
    expect(appearance("special").pattern).toEqual({ kind: "solid", colours: ["yellow"] });
    expect(appearance("special").topmark?.shape).toBe("saltire");
    expect(rhythm("special")).toBe("none");
  });

  /**
   * R1001 Table 11: blue and yellow vertical stripes, an upright yellow cross, and a light of
   * "one second of blue light and one second of yellow light with 0.5 sec. eclipse" - which is
   * exactly the alternating occulting character E-110 gives it.
   */
  it("gives the emergency wreck buoy its stripes and its alternating light", () => {
    expect(appearance("emergency-wreck").pattern).toEqual({
      kind: "vertical stripes",
      colours: ["blue", "yellow", "blue", "yellow"],
    });
    expect(rhythm("emergency-wreck")).toBe("OcAl BuY 3s");
  });
});

/**
 * The point of the whole file: one fact, three statements, and none of them able to disagree
 * with the others. A scenario cannot state black-and-yellow bands with two spheres and Fl(2),
 * because it does not state any of the three.
 */
describe("what the buoyage will and will not answer", () => {
  it("has an appearance for every purpose the format takes", () => {
    for (const purpose of MARK_PURPOSES) {
      expect(appearanceOf(purpose, "B"), purpose).not.toBeNull();
    }
  });

  it("never gives two purposes the same three statements", () => {
    const seen = MARK_PURPOSES.map((purpose) => {
      const it = appearance(purpose, "B");
      return JSON.stringify([it.pattern, it.topmark, rhythm(purpose, "B")]);
    });
    expect(new Set(seen).size).toBe(MARK_PURPOSES.length);
  });

  /** Every character in the table is a constant of the buoyage, so all of them must parse. */
  it("writes every rhythm it holds in a form the grammar reads", () => {
    for (const purpose of MARK_PURPOSES) {
      expect(() => rhythm(purpose, "B"), purpose).not.toThrow();
    }
  });
});
