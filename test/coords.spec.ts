import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { headingToRotationY, toWorld } from "../src/render/coords.js";

/**
 * The axis mapping is the one place a sign error stays invisible. Get it wrong and the
 * scene still renders, the ships still move, and half of them turn the wrong way - which
 * nobody notices until someone reads an aspect off the picture and it is 90 degrees out.
 */
describe("world axes", () => {
  it("puts east on +X and north on -Z", () => {
    const p = toWorld({ east: 100, north: 250 });
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.z).toBeCloseTo(-250, 9);
  });

  it("sits on the waterline unless a height is given", () => {
    expect(toWorld({ east: 0, north: 0 }).y).toBe(0);
    expect(toWorld({ east: 0, north: 0 }, 12.5).y).toBeCloseTo(12.5, 9);
  });
});

describe("headingToRotationY", () => {
  /** Where a model's own forward (-Z) ends up after being rotated to a given heading. */
  function bowDirection(headingDegreesTrue: number): Vector3 {
    return new Vector3(0, 0, -1).applyAxisAngle(
      new Vector3(0, 1, 0),
      headingToRotationY(headingDegreesTrue),
    );
  }

  it("leaves a ship heading north pointing along -Z", () => {
    expect(headingToRotationY(0)).toBe(-0);
    const bow = bowDirection(0);
    expect(bow.x).toBeCloseTo(0, 9);
    expect(bow.z).toBeCloseTo(-1, 9);
  });

  // A compass runs clockwise; a right-handed rotation about Y seen from above runs
  // anticlockwise. Steering east must therefore be a NEGATIVE rotation, and a ship on 090
  // must end up pointing at +X. Dropping the minus sign mirrors every turn in the scene.
  it("turns clockwise, so 090 points east", () => {
    const bow = bowDirection(90);
    expect(bow.x).toBeCloseTo(1, 9);
    expect(bow.z).toBeCloseTo(0, 9);
  });

  it("turns clockwise, so 270 points west", () => {
    const bow = bowDirection(270);
    expect(bow.x).toBeCloseTo(-1, 9);
    expect(bow.z).toBeCloseTo(0, 9);
  });

  it("puts a ship on 180 pointing south", () => {
    const bow = bowDirection(180);
    expect(bow.z).toBeCloseTo(1, 9);
  });
});
