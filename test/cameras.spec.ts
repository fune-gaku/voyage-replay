import { describe, expect, it } from "vitest";

import {
  frameOverheadCamera,
  makeBridgeCamera,
  makeOverheadCamera,
  placeBridgeCamera,
} from "../src/render/cameras.js";

describe("the overhead camera", () => {
  // Looking straight down leaves "up" undefined, so it has to be stated. North (-Z) up is
  // what puts the view the same way round as a chart; anything else prints a mirror image
  // of the approach geometry, which is the one thing this view exists to show.
  it("is oriented like a chart, north up", () => {
    expect(makeOverheadCamera().up.z).toBe(-1);
  });

  it("looks down from above the water", () => {
    expect(makeOverheadCamera().position.y).toBeGreaterThan(0);
  });

  it("frames the requested extent as the vertical, widened by the aspect", () => {
    const camera = makeOverheadCamera();
    frameOverheadCamera(camera, { east: 0, north: 0 }, 1000, 2);

    expect(camera.top - camera.bottom).toBeCloseTo(1000, 9);
    expect(camera.right - camera.left).toBeCloseTo(2000, 9);
  });

  it("centres on the given position in world axes", () => {
    const camera = makeOverheadCamera();
    const above = camera.position.y;
    frameOverheadCamera(camera, { east: 300, north: 400 }, 1000, 1);

    expect(camera.position.x).toBeCloseTo(300, 9);
    expect(camera.position.z).toBeCloseTo(-400, 9);
    // Framing moves the camera about the plane; it must not descend towards the water.
    expect(camera.position.y).toBe(above);
  });
});

describe("the bridge camera", () => {
  const fit = { eyeHeightMetres: 14, offsetForwardMetres: -30, offsetStarboardMetres: 0 };

  it("sits at the height of the wheelhouse windows", () => {
    const camera = makeBridgeCamera(1.5);
    placeBridgeCamera(camera, { east: 0, north: 0 }, 0, fit);
    expect(camera.position.y).toBeCloseTo(14, 9);
  });

  // The bridge is aft of the hull's centre, and "aft" is along the ship's own fore-and-aft
  // line, not along a world axis. Heading north, an offset of -30 m puts the eye 30 m
  // south of the reported position; heading east it puts it 30 m west.
  it("offsets along the ship's fore-and-aft line, not along the world's", () => {
    const northbound = makeBridgeCamera(1.5);
    placeBridgeCamera(northbound, { east: 0, north: 0 }, 0, fit);
    expect(northbound.position.z).toBeCloseTo(30, 6);
    expect(northbound.position.x).toBeCloseTo(0, 6);

    const eastbound = makeBridgeCamera(1.5);
    placeBridgeCamera(eastbound, { east: 0, north: 0 }, 90, fit);
    expect(eastbound.position.x).toBeCloseTo(-30, 6);
    expect(eastbound.position.z).toBeCloseTo(0, 6);
  });

  /**
   * The athwartships half of the same offset. It is small on most ships and never zero once
   * a hull has been moved onto its AIS offsets, and it turns with her exactly as the
   * fore-and-aft half does - so heading east, "to starboard" is south, which is +Z.
   */
  it("offsets athwartships along the ship's own beam, not along the world's", () => {
    const camera = makeBridgeCamera(1.5);
    placeBridgeCamera(camera, { east: 0, north: 0 }, 90, { ...fit, offsetStarboardMetres: 4 });

    expect(camera.position.z).toBeCloseTo(4, 6);
    expect(camera.position.x).toBeCloseTo(-30, 6);
  });

  it("looks where the bow points, not where the ship is going", () => {
    const camera = makeBridgeCamera(1.5);
    placeBridgeCamera(camera, { east: 0, north: 0 }, 90, fit);
    // -90 degrees about Y: a compass turn to starboard is a negative rotation here.
    expect(camera.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
  });

  // A wider lens makes the other ship look further away than she was, which in a collision
  // enquiry is exactly the wrong error to introduce.
  it("uses a field of view close to what a person takes in unaided", () => {
    const camera = makeBridgeCamera(1.5);
    expect(camera.fov).toBeGreaterThanOrEqual(45);
    expect(camera.fov).toBeLessThanOrEqual(65);
    expect(camera.aspect).toBe(1.5);
  });
});
