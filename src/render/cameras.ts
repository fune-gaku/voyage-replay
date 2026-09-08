/**
 * The cameras.
 *
 *   overhead - orthographic, north up. The chart an investigator works in.
 *   bridge   - from a named ship's wheelhouse, looking where her bow points.
 *   free     - anywhere, aboard nobody, and able to look down.
 *
 * **Three cameras, two pictures.** Which camera is up used to decide what kind of picture was
 * being drawn - a chart or the world - and eight things read that decision. A free eye is in
 * the world and is not on a bridge, so it had no answer to any of them until `render/player.ts`
 * separated the two questions. See issue #63.
 *
 * The bridge cameras are the reason this project exists. A collision enquiry asks what
 * the officer of the watch could see, and that question has a camera position: eye height
 * above the water, at the bridge, pointing along the HEADING - not along the course over
 * ground. In a tideway those differ, and it is the heading the windows face.
 */

import { OrthographicCamera, PerspectiveCamera } from "three";

import { headingToRotationY, toWorld } from "./coords.js";
import type { LocalPosition } from "../core/geodesy.js";

export function makeOverheadCamera(): OrthographicCamera {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 60000);
  camera.position.set(0, 12000, 0);
  // Looking straight down, so "up" has to be given explicitly or the orientation is
  // undefined. North (-Z) up puts the view the same way round as a chart.
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  return camera;
}

/**
 * Frame the overhead view on the action rather than on the whole track.
 *
 * Framing the whole track sounds right and is useless: this reference case runs 17 miles
 * before contact, so a 49 m hull comes out about four pixels wide and its navigation
 * lights do not survive rasterisation at all. What the plan view is for is the geometry
 * BETWEEN the ships, so it follows them, and the minimum extent keeps the frame from
 * collapsing onto the hulls at the moment they touch.
 */
export function frameOverheadCamera(
  camera: OrthographicCamera,
  centre: LocalPosition,
  extentMetres: number,
  aspect: number,
): void {
  const halfHeight = extentMetres / 2;
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.position.set(centre.east, camera.position.y, -centre.north);
  camera.updateProjectionMatrix();
}

export function makeBridgeCamera(aspect: number): PerspectiveCamera {
  // 55 degrees is close to what a person takes in without turning their head, and near
  // enough to a bridge window that distances read correctly. A wider lens makes the other
  // ship look further away than she was, which is exactly the wrong error to introduce.
  const camera = new PerspectiveCamera(55, aspect, 1, 80000);
  camera.up.set(0, 1, 0);
  return camera;
}

/**
 * Put the eye at a point that has already been worked out, and turn it along the bow.
 *
 * Where on the ship that point is - aft to the wheelhouse, and off the centreline if she
 * carries her antenna there - is the caller's arithmetic, in `offsetAlongHeading`, and it
 * has to be, because the same point decides which of another ship's lamps can be seen from
 * here. Two derivations of one eye is two answers to that question, and on a large ship
 * they are tens of metres apart.
 */
export function placeBridgeCamera(
  camera: PerspectiveCamera,
  eye: LocalPosition,
  headingDegreesTrue: number,
  eyeHeightMetres: number,
): void {
  const rotationY = headingToRotationY(headingDegreesTrue);
  camera.position.copy(toWorld(eye, eyeHeightMetres));
  camera.rotation.set(0, rotationY, 0);
}

/**
 * A camera that can be put anywhere and pointed down, which the bridge camera must not be.
 *
 * **Separate from `placeBridgeCamera` on purpose.** That one turns the eye along the ship's
 * HEADING and holds it level, and both are claims: a wheelhouse faces where her bow points
 * rather than where she is making good, and a watchkeeper looking out of a window is looking at
 * the horizon. Widening it to take a depression angle would leave the bridge view one argument
 * away from a camera move, and the bridge view is the reason this project exists.
 *
 * The field of view is the same 55 degrees, for the same reason: a wider lens puts the other
 * ship further away than she was, and that error is no less wrong for being seen from a
 * helicopter.
 */
export function makeFreeCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(55, aspect, 1, 80000);
  camera.up.set(0, 1, 0);
  return camera;
}

/** Put the free camera where it is told, turned onto a bearing and tilted below the level. */
export function placeFreeCamera(
  camera: PerspectiveCamera,
  at: LocalPosition,
  facing: { headingDegreesTrue: number; depressionDegrees: number },
  heightMetres: number,
): void {
  camera.position.copy(toWorld(at, heightMetres));
  // Yaw about the world's up, then pitch down about the camera's own right: the order matters,
  // and YXZ is what three applies for Euler angles in that order.
  camera.rotation.order = "YXZ";
  camera.rotation.set(
    (-facing.depressionDegrees * Math.PI) / 180,
    headingToRotationY(facing.headingDegreesTrue),
    0,
  );
}
