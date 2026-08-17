import { describe, expect, it } from "vitest";

import {
  dropMetres,
  EFFECTIVE_RADIUS_METRES,
  hiddenHeightMetres,
  horizonMetres,
} from "../src/core/horizon.js";

const METRES_PER_NAUTICAL_MILE = 1852;

/**
 * The seaman's rule, which is where this arithmetic has to land or it is wrong.
 *
 * Held against the published constant rather than against a second copy of the same
 * formula: a test that recomputes what the implementation computes agrees with it exactly
 * when both are wrong, which is the one outcome worth ruling out.
 */
function ruleOfThumbNauticalMiles(eyeHeightMetres: number): number {
  return 2.08 * Math.sqrt(eyeHeightMetres);
}

describe("distance to the horizon", () => {
  it("matches the 2.08 root-h rule to within one per cent", () => {
    for (const height of [5, 10, 15, 20, 30, 40]) {
      const miles = horizonMetres(height) / METRES_PER_NAUTICAL_MILE;
      expect(miles).toBeCloseTo(ruleOfThumbNauticalMiles(height), 0);
      expect(Math.abs(miles / ruleOfThumbNauticalMiles(height) - 1)).toBeLessThan(0.01);
    }
  });

  it("puts a twenty-metre eye 9.2 miles off, which is 17.1 km", () => {
    expect(horizonMetres(20) / METRES_PER_NAUTICAL_MILE).toBeCloseTo(9.24, 1);
    expect(horizonMetres(20)).toBeCloseTo(17_115, -1);
  });

  it("grows as the square root, so four times the height is twice the distance", () => {
    expect(horizonMetres(80) / horizonMetres(20)).toBeCloseTo(2, 6);
  });

  it("is not the geometric horizon: refraction pushes it out about seven per cent", () => {
    const geometric = Math.sqrt(2 * 6_371_008.8 * 20);
    expect(horizonMetres(20) / geometric).toBeCloseTo(1.072, 2);
  });

  it("gives an eye on the water no horizon at all rather than a complex number", () => {
    expect(horizonMetres(0)).toBe(0);
    expect(horizonMetres(-5)).toBe(0);
  });
});

describe("how far the sea falls away", () => {
  it("is the sagitta of the effective earth", () => {
    for (const distance of [5_000, 20_000, 50_000]) {
      expect(dropMetres(distance)).toBeCloseTo(distance ** 2 / (2 * EFFECTIVE_RADIUS_METRES), 6);
    }
  });

  it("is 27 m at twenty kilometres and 171 m at fifty", () => {
    expect(dropMetres(20_000)).toBeCloseTo(27.3, 1);
    expect(dropMetres(50_000)).toBeCloseTo(170.7, 1);
  });

  it("goes as the square, so twice the distance is four times the drop", () => {
    expect(dropMetres(40_000) / dropMetres(20_000)).toBeCloseTo(4, 6);
  });
});

describe("what the bulge hides", () => {
  it("hides nothing inside the horizon", () => {
    expect(hiddenHeightMetres(20, 10_000)).toBe(0);
    expect(hiddenHeightMetres(20, horizonMetres(20))).toBe(0);
  });

  it("hides 36 m of a target at forty kilometres from a twenty-metre eye", () => {
    expect(hiddenHeightMetres(20, 40_000)).toBeCloseTo(35.8, 1);
  });

  /**
   * The two-horizons rule: an object of height h2 is in sight from an eye of height h1 out
   * to the sum of their own horizon distances. At exactly that range the whole of it is
   * hidden and no more, which is the same statement read the other way round.
   */
  it("just hides a fifty-metre mast at the sum of the two horizons", () => {
    const range = horizonMetres(20) + horizonMetres(50);
    // 23.9 miles here against the 24.0 the rule of thumb gives, because 2.08 is itself a
    // rounding of this same constant. Both are quoted; they agree to half a per cent.
    expect(range / METRES_PER_NAUTICAL_MILE).toBeCloseTo(23.85, 1);
    const ruleOfThumb = ruleOfThumbNauticalMiles(20) + ruleOfThumbNauticalMiles(50);
    expect(Math.abs(range / METRES_PER_NAUTICAL_MILE / ruleOfThumb - 1)).toBeLessThan(0.01);
    expect(hiddenHeightMetres(20, range)).toBeCloseTo(50, 6);
  });

  it("hides more of the same target the lower the eye", () => {
    expect(hiddenHeightMetres(10, 30_000)).toBeGreaterThan(hiddenHeightMetres(30, 30_000));
  });
});
