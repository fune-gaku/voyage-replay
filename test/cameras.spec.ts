import { describe, expect, it } from "vitest";

import {
  frameOverheadCamera,
  makeBridgeCamera,
  makeFreeCamera,
  makeOverheadCamera,
  placeBridgeCamera,
  placeFreeCamera,
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

/**
 * Where on the ship the eye sits is no longer decided here - `offsetAlongHeading` works it
 * out, once, so that the arcs of another ship's lamps are answered from the same point the
 * camera looks from. What is left is the two things a camera does: stand somewhere at some
 * height, and face along the bow.
 */
describe("the bridge camera", () => {
  it("sits at the height of the wheelhouse windows", () => {
    const camera = makeBridgeCamera(1.5);
    placeBridgeCamera(camera, { east: 0, north: 0 }, 0, 14);
    expect(camera.position.y).toBeCloseTo(14, 9);
  });

  it("stands at the eye it is given, in world axes", () => {
    const camera = makeBridgeCamera(1.5);
    placeBridgeCamera(camera, { east: 30, north: -40 }, 0, 14);

    expect(camera.position.x).toBeCloseTo(30, 6);
    expect(camera.position.z).toBeCloseTo(40, 6);
  });

  it("looks where the bow points, not where the ship is going", () => {
    const camera = makeBridgeCamera(1.5);
    placeBridgeCamera(camera, { east: 0, north: 0 }, 90, 14);
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

/**
 * **A camera the bridge camera must not become.** Widening `placeBridgeCamera` to take a
 * depression angle would leave the bridge view one argument away from a camera move, and two
 * of its properties are claims rather than conveniences: a wheelhouse faces where her bow
 * points rather than where she is making good, and a watchkeeper at a window is looking at the
 * horizon. So the free one is its own function, and these pin the difference.
 */
const ZERO = { headingDegreesTrue: 0, depressionDegrees: 0 };

describe("the free camera", () => {
  it("stands where it is put, at the height it is given", () => {
    const camera = makeFreeCamera(1.5);
    placeFreeCamera(camera, { east: 30, north: -40 }, ZERO, 200);

    expect(camera.position.x).toBeCloseTo(30, 6);
    expect(camera.position.z).toBeCloseTo(40, 6);
    expect(camera.position.y).toBeCloseTo(200, 6);
  });

  it("turns onto a bearing the way the bridge camera does", () => {
    const free = makeFreeCamera(1.5);
    const bridge = makeBridgeCamera(1.5);
    placeFreeCamera(
      free,
      { east: 0, north: 0 },
      { headingDegreesTrue: 90, depressionDegrees: 0 },
      14,
    );
    placeBridgeCamera(bridge, { east: 0, north: 0 }, 90, 14);

    expect(free.rotation.y).toBeCloseTo(bridge.rotation.y, 9);
  });

  /** The one thing it can do that a bridge cannot: look down. */
  it("tilts below the horizontal, which the bridge camera never does", () => {
    const camera = makeFreeCamera(1.5);
    placeFreeCamera(
      camera,
      { east: 0, north: 0 },
      { headingDegreesTrue: 0, depressionDegrees: 30 },
      200,
    );

    expect((camera.rotation.x * 180) / Math.PI).toBeCloseTo(-30, 9);
    // Yaw about the world's up first, then pitch about the camera's own right. The other
    // order tips the horizon over as soon as both are non-zero.
    expect(camera.rotation.order).toBe("YXZ");
  });

  it("sees the same width of the world as a bridge does", () => {
    expect(makeFreeCamera(1.5).fov).toBe(makeBridgeCamera(1.5).fov);
    expect(makeFreeCamera(1.5).aspect).toBe(1.5);
  });
});
