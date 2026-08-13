/**
 * The three viewpoints.
 *
 *   overhead - orthographic, north up. The plan view an investigator works in.
 *   bridge   - from a named ship's wheelhouse, looking where her bow points.
 *
 * The bridge cameras are the reason this project exists. A collision enquiry asks what
 * the officer of the watch could see, and that question has a camera position: eye height
 * above the water, at the bridge, pointing along the HEADING - not along the course over
 * ground. In a tideway those differ, and it is the heading the windows face.
 */

import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

import { headingToRotationY, toWorld } from "./coords.js";
import type { LocalPosition } from "../core/geodesy.js";

export type ViewKind = "overhead" | "bridge";

/**
 * Where the wheelhouse windows sit, measured from the position the track REPORTS - not from
 * the hull's centre. The two differ by the antenna offset (see actors/vessel/reference-point),
 * and measuring from the reported position is what keeps the eye inside the hull as drawn.
 */
export interface BridgeFit {
  eyeHeightMetres: number;
  offsetForwardMetres: number;
  offsetStarboardMetres: number;
}

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

export function placeBridgeCamera(
  camera: PerspectiveCamera,
  position: LocalPosition,
  headingDegreesTrue: number,
  fit: BridgeFit,
): void {
  const rotationY = headingToRotationY(headingDegreesTrue);

  // Both offsets run along the ship's own axes, not along the world's, so they turn with
  // her: the bridge stays aft however she is heading, and a wheelhouse offset to one side
  // stays on that side.
  const up = new Vector3(0, 1, 0);
  const forward = new Vector3(0, 0, -1).applyAxisAngle(up, rotationY);
  const starboard = new Vector3(1, 0, 0).applyAxisAngle(up, rotationY);
  const base = toWorld(position, fit.eyeHeightMetres);
  camera.position.copy(
    base
      .addScaledVector(forward, fit.offsetForwardMetres)
      .addScaledVector(starboard, fit.offsetStarboardMetres),
  );

  camera.rotation.set(0, rotationY, 0);
}
