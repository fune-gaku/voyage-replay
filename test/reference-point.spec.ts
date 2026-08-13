import { describe, expect, it } from "vitest";

import { hullCentreOffset, offsetMetres } from "../src/actors/vessel/reference-point.js";
import type { ReferencePointOffsets } from "../src/core/types.js";

/**
 * The Suo-nada tanker's own four distances, out of the report's footnote. Her antenna sits
 * 39 m from the bow of a 49 m ship, which is what makes her the useful case here: the
 * antenna is nowhere near the middle, so a sign error is a 29 m error and not a rounding one.
 */
const SEITOKU: ReferencePointOffsets = {
  fromBowMetres: 39,
  fromSternMetres: 10,
  fromPortMetres: 4,
  fromStarboardMetres: 5,
};

describe("hullCentreOffset", () => {
  /**
   * The direction, which is the whole point of the function and the easiest thing in it to
   * get backwards. The antenna is 39 m from the bow and 10 m from the stern, so it is aft of
   * the middle, so the hull's centre is FORWARD of it - and a hull drawn at the antenna is
   * drawn astern of where the ship was, not ahead of it.
   */
  it("puts the hull's centre forward of an antenna that sits aft", () => {
    const offset = hullCentreOffset("gps-antenna", SEITOKU);
    expect(offset.kind).toBe("offset");
    expect(offsetMetres(offset).forwardMetres).toBeCloseTo(14.5, 9);
  });

  it("puts it to starboard of an antenna that sits to port", () => {
    expect(offsetMetres(hullCentreOffset("gps-antenna", SEITOKU)).starboardMetres).toBeCloseTo(
      0.5,
      9,
    );
  });

  it("gives back nothing to apply for an antenna already amidships", () => {
    const centred = { ...SEITOKU, fromBowMetres: 24.5, fromSternMetres: 24.5 };
    expect(offsetMetres(hullCentreOffset("gps-antenna", centred)).forwardMetres).toBe(0);
  });

  /**
   * A track already reported at the ship's reference point has had this applied upstream.
   * Applying it a second time displaces her by the offset all over again, and the result
   * still looks like a ship on a plausible course, so nothing downstream would complain.
   */
  it("leaves a position already at the hull alone", () => {
    expect(hullCentreOffset("reference-point", SEITOKU).kind).toBe("already-the-hull");
    expect(offsetMetres(hullCentreOffset("reference-point", SEITOKU))).toEqual({
      forwardMetres: 0,
      starboardMetres: 0,
    });
  });

  it("says so, rather than guessing, when the source never gave the offsets", () => {
    expect(hullCentreOffset("gps-antenna", undefined).kind).toBe("not-stated");
    expect(offsetMetres(hullCentreOffset("gps-antenna", undefined))).toEqual({
      forwardMetres: 0,
      starboardMetres: 0,
    });
  });

  /**
   * The lateral half has to close inside the four offsets. AIS rounds them to the metre, so
   * the tanker's port and starboard distances sum to 9 m against a beam stated as 9.4 m
   * elsewhere in the same file. Working the centreline out as beam/2 - fromPort would put
   * her 0.2 m off, and that 0.2 m would be a rounding difference dressed up as a
   * measurement.
   */
  it("works the offset out from the four distances alone, not from the stated beam", () => {
    const halfOfStatedBeam = 9.4 / 2 - SEITOKU.fromPortMetres;
    const offset = offsetMetres(hullCentreOffset("gps-antenna", SEITOKU));

    expect(offset.starboardMetres).toBeCloseTo(0.5, 9);
    expect(offset.starboardMetres).not.toBeCloseTo(halfOfStatedBeam, 3);
  });
});
