/**
 * The one place the world's axes are decided.
 *
 * Scenario data is east/north metres on a local plane; three.js is Y-up. Mapping them
 * anywhere other than here invites a scene where half the ships turn the wrong way, which
 * looks plausible enough that nobody notices until they read an aspect off it.
 *
 *   world X = east
 *   world Y = up
 *   world Z = south, so north is -Z
 *
 * A model's own forward is -Z, matching three.js's convention for cameras and for
 * `lookAt`. A ship heading 000 therefore points at -Z (north) with no rotation, and
 * heading clockwise is a NEGATIVE rotation about Y - because Y-up right-handed rotation
 * runs anticlockwise seen from above, while a compass runs clockwise.
 */

import { Vector3 } from "three";

import type { LocalPosition } from "../core/geodesy.js";

export function toWorld(position: LocalPosition, height = 0): Vector3 {
  return new Vector3(position.east, height, -position.north);
}

/** Rotation about Y that points a model's -Z forward along the given true bearing. */
export function headingToRotationY(headingDegreesTrue: number): number {
  return -(headingDegreesTrue * Math.PI) / 180;
}
