import { describe, expect, it } from "vitest";

import { floats, watchCircleMetres } from "../src/actors/mark/mooring.js";
import type { Mark } from "../src/core/types.js";

function buoy(overrides: Partial<Mark> = {}): Mark {
  return { id: "no-1", kind: "buoy", at: { lat: 33.9, lon: 131.7 }, ...overrides };
}

/**
 * A buoy is not at her charted position: that position is her sinker's, and she lies
 * somewhere on a circle about it. The radius is the horizontal leg of a right triangle
 * whose hypotenuse is the chain and whose vertical leg is the depth - so it is arithmetic,
 * and the numbers below are checked against it rather than against this implementation.
 */
describe("watchCircleMetres", () => {
  it("is the horizontal leg of the chain, not the chain itself", () => {
    const radius = watchCircleMetres(buoy({ mooring: { depthMetres: 20, chainScope: 3 } }));
    // sqrt(60^2 - 20^2) = 56.57, against ships of 49 m and 121 m in the reference case.
    expect(radius).toBeCloseTo(Math.sqrt(60 * 60 - 20 * 20), 6);
    expect(radius).toBeCloseTo(56.57, 2);
  });

  /** Scope 1 is chain straight up and down. Nought, rather than the root of a negative. */
  it("gives nought for chain no longer than the depth", () => {
    expect(watchCircleMetres(buoy({ mooring: { depthMetres: 20, chainScope: 1 } }))).toBe(0);
  });

  it("grows with scope and with depth", () => {
    const shallow = watchCircleMetres(buoy({ mooring: { depthMetres: 10, chainScope: 3 } }))!;
    const deep = watchCircleMetres(buoy({ mooring: { depthMetres: 30, chainScope: 3 } }))!;
    const slack = watchCircleMetres(buoy({ mooring: { depthMetres: 10, chainScope: 5 } }))!;

    expect(deep).toBeGreaterThan(shallow);
    expect(slack).toBeGreaterThan(shallow);
  });

  /**
   * Null rather than a plausible figure. Chain scope is not something a report states, and
   * a ratio invented here would reach a reader as a number somebody measured.
   */
  it("declines to answer where the file does not say enough", () => {
    expect(watchCircleMetres(buoy())).toBeNull();
    expect(watchCircleMetres(buoy({ mooring: { depthMetres: 20 } }))).toBeNull();
    expect(watchCircleMetres(buoy({ mooring: { chainScope: 3 } }))).toBeNull();
  });

  /**
   * The schema refuses these - depth is exclusiveMinimum 0 and scope minimum 1 - and this
   * function refuses them again, because a scenario reaches here by other roads than
   * `validateScenario`: a fixture, a hand-built object, a format that later loosens. The
   * bound is stated in two places and `test/validate.spec.ts` holds the other one.
   */
  it("refuses a mooring the schema would have refused too", () => {
    expect(watchCircleMetres(buoy({ mooring: { depthMetres: 0, chainScope: 3 } }))).toBeNull();
    expect(watchCircleMetres(buoy({ mooring: { depthMetres: -5, chainScope: 3 } }))).toBeNull();
    expect(watchCircleMetres(buoy({ mooring: { depthMetres: 20, chainScope: 0.5 } }))).toBeNull();
  });

  /**
   * A beacon's null means something else entirely - it has no circle at all - which is why
   * `ui/panels.ts` asks the kind before it asks for a radius rather than printing one blank
   * for both.
   */
  it("gives a beacon none, even if a mooring somehow reached it", () => {
    const built = {
      ...buoy(),
      kind: "beacon" as const,
      mooring: { depthMetres: 20, chainScope: 3 },
    };
    expect(watchCircleMetres(built)).toBeNull();
  });
});

describe("floats", () => {
  it("separates the two kinds, which is what decides whether one heaves", () => {
    expect(floats(buoy())).toBe(true);
    expect(floats({ ...buoy(), kind: "beacon" })).toBe(false);
  });
});
