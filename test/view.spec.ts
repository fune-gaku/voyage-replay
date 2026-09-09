import { describe, expect, it } from "vitest";

import {
  clampElevation,
  orbitEye,
  pictureOf,
  ORBIT_ELEVATION,
  ORBIT_FLOOR_METRES,
  type ViewSelection,
} from "../src/render/view.js";

const CENTRE = { east: 1_000, north: -500 };

function orbit(
  azimuthDegrees: number,
  elevationDegrees: number,
  distanceMetres: number,
): Extract<ViewSelection, { kind: "orbit" }> {
  return { kind: "orbit", azimuthDegrees, elevationDegrees, distanceMetres };
}

describe("which picture a viewpoint draws", () => {
  it("puts an orbit in the world, where the earth curves and the sky is the sky", () => {
    expect(pictureOf(orbit(0, 45, 1_000))).toBe("world");
    expect(pictureOf({ kind: "chart" })).toBe("chart");
  });
});

describe("where an orbit puts the eye", () => {
  /**
   * The azimuth is the bearing FROM the action TO the eye, so the camera stands on it and
   * looks back down the reciprocal. Getting that round the wrong way is the failure
   * `visibleLights` already documents: the picture is exactly 180 degrees out and looks
   * entirely plausible until somebody reads a bearing off it.
   */
  it("stands on the bearing it was given and looks back along it", () => {
    const eye = orbitEye(orbit(180, 0.5, 1_000), CENTRE);

    expect(eye.at.north, "due south of the action").toBeLessThan(CENTRE.north);
    expect(eye.at.east).toBeCloseTo(CENTRE.east, 6);
    expect(eye.headingDegreesTrue, "and looking north").toBeCloseTo(0, 6);
  });

  it("takes a bearing east as east", () => {
    const eye = orbitEye(orbit(90, 0.5, 1_000), CENTRE);

    expect(eye.at.east).toBeGreaterThan(CENTRE.east);
    expect(eye.at.north).toBeCloseTo(CENTRE.north, 6);
    expect(eye.headingDegreesTrue, "looking west").toBeCloseTo(270, 6);
  });

  // The control adds degrees without bound as the pointer is dragged round and round.
  it("wraps a bearing that has been dragged past a turn", () => {
    const wrapped = orbitEye(orbit(-90, 30, 2_000), CENTRE);
    const plain = orbitEye(orbit(270, 30, 2_000), CENTRE);

    expect(wrapped.at.east).toBeCloseTo(plain.at.east, 6);
    expect(wrapped.headingDegreesTrue).toBeCloseTo(plain.headingDegreesTrue, 6);
  });

  it("climbs with the elevation and closes with the range", () => {
    const low = orbitEye(orbit(0, 10, 4_000), CENTRE);
    const high = orbitEye(orbit(0, 60, 4_000), CENTRE);

    expect(high.heightMetres).toBeGreaterThan(low.heightMetres);
    expect(Math.hypot(high.at.east - CENTRE.east, high.at.north - CENTRE.north)).toBeLessThan(
      Math.hypot(low.at.east - CENTRE.east, low.at.north - CENTRE.north),
    );
  });

  /**
   * Straight down is where the camera's own orientation stops being defined - the yaw and
   * the roll become one rotation - so the top of the range is a tenth of a degree short of
   * it. At four kilometres that is seven metres off the vertical.
   */
  it("comes within a tenth of a degree of the zenith and stops", () => {
    const eye = orbitEye(orbit(0, 90, 4_000), CENTRE);
    const away = Math.hypot(eye.at.east - CENTRE.east, eye.at.north - CENTRE.north);

    expect(eye.depressionDegrees).toBeCloseTo(ORBIT_ELEVATION.maximumDegrees, 6);
    expect(away).toBeCloseTo(4_000 * Math.cos((89.9 * Math.PI) / 180), 6);
    expect(away).toBeLessThan(8);
  });

  /**
   * Zero is in the water: the sea is a disc centred on the eye, so an eye at nothing high
   * has the surface and its own line of sight in one plane and there is no horizon.
   */
  it("keeps the eye out of the sea at the bottom of the range", () => {
    const eye = orbitEye(orbit(0, 0, 4_000), CENTRE);
    expect(eye.heightMetres).toBeGreaterThan(0);
    expect(eye.depressionDegrees).toBeGreaterThan(0);
  });

  /**
   * The limits are applied here as well as in whatever holds the control's own state, and
   * both come from one statement of them. This is the tie between the two.
   */
  it("clamps to the same ends the control clamps to", () => {
    expect(clampElevation(-40)).toBe(ORBIT_ELEVATION.minimumDegrees);
    expect(clampElevation(400)).toBe(ORBIT_ELEVATION.maximumDegrees);
    expect(clampElevation(30)).toBe(30);

    expect(orbitEye(orbit(0, -40, 4_000), CENTRE).heightMetres).toBeCloseTo(
      orbitEye(orbit(0, ORBIT_ELEVATION.minimumDegrees, 4_000), CENTRE).heightMetres,
      6,
    );
  });

  /**
   * Pulled in close enough and the floor lifts the eye above the angle asked for. Keeping
   * the asked-for depression would then point the camera under the thing it is orbiting,
   * which is the one job an orbit has - so the aim is taken from where the eye ended up.
   */
  it("aims from where the eye ended up when the floor has lifted it", () => {
    const asked = 1;
    const eye = orbitEye(orbit(0, asked, 50), CENTRE);

    expect(eye.heightMetres).toBe(ORBIT_FLOOR_METRES);
    expect(eye.depressionDegrees).toBeGreaterThan(asked);
    const range = Math.hypot(eye.at.east - CENTRE.east, eye.at.north - CENTRE.north);
    expect(Math.tan((eye.depressionDegrees * Math.PI) / 180)).toBeCloseTo(
      ORBIT_FLOOR_METRES / range,
      6,
    );
  });
});
