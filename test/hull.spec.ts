import { Box3 } from "three";
import { describe, expect, it } from "vitest";

import { buildHull } from "../src/render/hull.js";
import { BIG_SHIP, COASTER } from "./fixtures.js";

/**
 * The hull is generated rather than imported, and the reason is size: the scenario carries
 * length overall and beam, so a generated hull is the only one guaranteed to be the ship
 * the report describes. That claim is worth checking rather than assuming - a borrowed
 * model scaled to fit would pass every other test in the suite.
 */
describe("buildHull", () => {
  it("is as long and as wide as the vessel particulars say", () => {
    const box = new Box3().setFromObject(buildHull(COASTER, 0xff0000).group);

    expect(box.max.x - box.min.x).toBeCloseTo(COASTER.beamMetres, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(COASTER.loaMetres, 6);
  });

  it("scales with the ship rather than being one shape stretched", () => {
    const box = new Box3().setFromObject(buildHull(BIG_SHIP, 0xff0000).group);

    expect(box.max.x - box.min.x).toBeCloseTo(BIG_SHIP.beamMetres, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(BIG_SHIP.loaMetres, 6);
  });

  it("floats on the waterline, with the superstructure above it", () => {
    const parts = buildHull(COASTER, 0xff0000);
    const box = new Box3().setFromObject(parts.group);

    expect(box.min.y).toBeCloseTo(0, 6);
    expect(parts.eyeHeightMetres).toBeGreaterThan(0);
    expect(parts.eyeHeightMetres).toBeLessThanOrEqual(box.max.y);
  });

  // Aft is right for almost everything that appears in a collision report, and the sign
  // matters: forward is -Z, so an offset aft of the centre is negative. Flip it and the
  // bridge view looks out over the stern.
  it("puts the bridge aft of the hull's centre", () => {
    expect(buildHull(COASTER, 0xff0000).bridgeOffsetForwardMetres).toBeLessThan(0);
  });

  it("gives a bigger ship a higher bridge", () => {
    const small = buildHull(COASTER, 0xff0000).eyeHeightMetres;
    const large = buildHull(BIG_SHIP, 0xff0000).eyeHeightMetres;
    expect(large).toBeGreaterThan(small);
  });
});
