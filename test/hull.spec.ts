import { Box3 } from "three";
import type { Mesh } from "three";
import { describe, expect, it } from "vitest";

import type { Vessel } from "../src/core/types.js";
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

/**
 * The bridge was a fraction of the length, aft of the middle - one of the invented constants
 * issue #8 is about. Where a ship transmits her four AIS dimensions, she has already said
 * where her antenna is, and on a merchant ship that is the wheelhouse top or beside it.
 */
describe("where the bridge is put", () => {
  it("takes it from the ship's own offsets when she states them", () => {
    // Antenna 140 m from a 180 m bow, so 50 m abaft the middle - and the bridge with it.
    const { bridgeOffsetForwardMetres, bridgeFromOffsets } = buildHull(BIG_SHIP, 0x888888);
    expect(bridgeOffsetForwardMetres).toBeCloseTo(-50, 6);
    expect(bridgeFromOffsets).toBe(true);
  });

  // A guess, and the hull has to say so: nothing downstream can tell the two apart by
  // looking, and the panels report which of them a given ship got.
  it("falls back to a fraction of the length, and admits it", () => {
    const { bridgeOffsetForwardMetres, bridgeFromOffsets } = buildHull(COASTER, 0x888888);
    expect(bridgeOffsetForwardMetres).toBeCloseTo(-COASTER.loaMetres * 0.32, 6);
    expect(bridgeFromOffsets).toBe(false);
  });

  /**
   * The eye has to stay inside her however the bridge was placed. A wheelhouse put 50 m
   * abaft the middle of a 180 m ship is still aboard; one put there on a 60 m ship is in
   * the water astern.
   */
  it("keeps the bridge inside the hull either way", () => {
    for (const vessel of [BIG_SHIP, COASTER]) {
      const { bridgeOffsetForwardMetres } = buildHull(vessel, 0x888888);
      expect(Math.abs(bridgeOffsetForwardMetres)).toBeLessThan(vessel.loaMetres / 2);
    }
  });
});

/**
 * One of the three features that resolve at the sizes these hulls occupy. At a 3 km view
 * the reference case's pushing unit is twelve pixels wide - block coefficient is invisible
 * there and a square bow is not, and drawn with a raked stem she reads as a ship she is not.
 */
describe("the shape of the bow", () => {
  function widthNearTheBow(vessel: Vessel): number {
    const box = new Box3().setFromObject(buildHull(vessel, 0x888888).group);
    return box.max.x - box.min.x;
  }

  it("squares off a pushing unit and points everything else", () => {
    const barge: Vessel = { ...BIG_SHIP, type: "pushing-ahead" };
    const ship: Vessel = { ...BIG_SHIP, type: "cargo" };

    // Half-beam at the stem: a box bow keeps it, a pointed one comes to nothing.
    const halfBeamAtStem = (vessel: Vessel): number => {
      const hull = buildHull(vessel, 0x888888).group.children[0] as Mesh;
      const position = hull.geometry.getAttribute("position");
      let widest = 0;
      for (let i = 0; i < position.count; i += 1) {
        if (position.getZ(i) < -vessel.loaMetres / 2 + 0.01) {
          widest = Math.max(widest, Math.abs(position.getX(i)));
        }
      }
      return widest;
    };

    expect(halfBeamAtStem(barge), "square across the stem").toBeCloseTo(BIG_SHIP.beamMetres / 2, 1);
    expect(halfBeamAtStem(ship), "and a point").toBeLessThan(BIG_SHIP.beamMetres / 4);
  });

  it("leaves both of them the beam they were given amidships", () => {
    const barge: Vessel = { ...BIG_SHIP, type: "pushing-ahead" };
    expect(widthNearTheBow(barge)).toBeCloseTo(BIG_SHIP.beamMetres, 1);
    expect(widthNearTheBow({ ...BIG_SHIP, type: "cargo" })).toBeCloseTo(BIG_SHIP.beamMetres, 1);
  });
});
