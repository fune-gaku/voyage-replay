/**
 * Hull geometry generated from the two dimensions the scenario actually carries.
 *
 * No imported ship models. The scenario gives length overall and beam, so a generated
 * hull is the only one guaranteed to be the right size - and a borrowed model of some
 * other ship, scaled to fit, is a picture of a different vessel. Low-poly is fine:
 * what makes a reconstruction read as real is the motion and the lights, not the shading.
 *
 * Local axes: +X starboard, +Y up, -Z forward. Origin at the hull's centre on the
 * waterline - NOT at the position a track reports, which is the GPS antenna and can sit
 * most of a ship's length from the centre. Moving between the two is the caller's job and
 * is done once, in player.ts, from the offsets in actors/vessel/reference-point.
 */

import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  type ColorRepresentation,
} from "three";

import { assumedHeights } from "../actors/vessel/heights.js";
import {
  hullDimensions,
  isBoxBowed,
  offsetsMeasureHull,
  planOutline,
} from "../actors/vessel/hull-shape.js";
import type { Vessel } from "../core/types.js";

/**
 * Where the bridge goes when nothing measured says otherwise, as a fraction of length aft
 * of the middle. Only ever a fallback: see `bridgeOffsetOf`.
 */
const BRIDGE_FRACTION_AFT = 0.32;

export interface HullParts {
  group: Group;
  /** Height above the waterline of the bridge windows, in metres. */
  eyeHeightMetres: number;
  /** Distance forward of the hull centre where the bridge sits, in metres. Negative is aft. */
  bridgeOffsetForwardMetres: number;
  /** Whether that came from the ship's own offsets or from the fraction above. */
  bridgeFromOffsets: boolean;
}

/**
 * Where the bridge is, from the one measurement that says so.
 *
 * A GPS antenna sits on the wheelhouse top or beside it on most merchant ships, so where
 * the four AIS dimensions put the antenna is where the bridge is - to a few metres, from a
 * figure the ship transmitted about herself. The fraction it replaces is a guess that
 * happens to fit the two ships in `examples/`: 0.32 of the length aft of the middle against
 * a measured 0.30 for the tanker and 0.36 for the pushing unit. It would not fit a
 * conventional cargo ship with her house amidships, and the offsets would.
 *
 * Sign: the antenna is `(bow - stern) / 2` FORWARD of the hull's centre, so the bridge is
 * that far forward too - which for a ship with her house aft is a negative number.
 */
function bridgeOffsetOf(vessel: Vessel): { metres: number; fromOffsets: boolean } {
  const offsets = vessel.referencePointOffsets;
  // **Stated is not measured, and the same test decides it as decides her size.** Four zeroes
  // are a valid file and measure nothing; taking them here would put her bridge amidships and
  // call it measured, on a hull the page has already said fell back to the particulars.
  if (!offsets || !offsetsMeasureHull(vessel)) {
    return { metres: -vessel.loaMetres * BRIDGE_FRACTION_AFT, fromOffsets: false };
  }
  return {
    metres: -(offsets.fromBowMetres - offsets.fromSternMetres) / 2,
    fromOffsets: true,
  };
}

/**
 * The outline as a three.js `Shape`, from the points `actors/vessel/hull-shape.ts` holds.
 *
 * **The shape used to be defined here, and that is why a range between hulls disagreed with
 * the hulls.** It is generated rather than imported - a borrowed model scaled to fit is a
 * picture of a different ship - so it has to be reachable by everything that measures against
 * it, and `render/` is not somewhere `actors/` may reach.
 *
 * Working in (x = starboard, y = forward) and converting to the XZ plane on extrude.
 */
function outlineShape(vessel: Vessel): Shape {
  const points = planOutline(hullDimensions(vessel), isBoxBowed(vessel));
  const shape = new Shape();
  const [first, ...rest] = points;
  if (!first) return shape;
  shape.moveTo(first.starboardMetres, first.forwardMetres);
  for (const point of rest) shape.lineTo(point.starboardMetres, point.forwardMetres);
  shape.closePath();
  return shape;
}

export function buildHull(vessel: Vessel, colour: ColorRepresentation): HullParts {
  // Vertical dimensions are all assumed - see `actors/vessel/heights.ts` and issue #8.
  const heights = assumedHeights(vessel);
  const freeboard = heights.freeboardMetres;
  const bridgeHeight = heights.superstructureMetres - freeboard;
  const bridge = bridgeOffsetOf(vessel);

  const group = new Group();
  group.add(hullMesh(vessel, freeboard, colour));
  group.add(bridgeMesh(vessel, freeboard, bridgeHeight, bridge.metres));

  return {
    group,
    eyeHeightMetres: heights.eyeMetres,
    bridgeOffsetForwardMetres: bridge.metres,
    bridgeFromOffsets: bridge.fromOffsets,
  };
}

function hullMesh(vessel: Vessel, freeboard: number, colour: ColorRepresentation): Mesh {
  const geometry = new ExtrudeGeometry(outlineShape(vessel), {
    depth: freeboard,
    bevelEnabled: false,
  });
  // The shape was drawn in (starboard, forward) and extruded along +Z. rotateX(-90 deg)
  // maps (x, y, z) to (x, z, -y): the extrusion becomes height above the waterline, and
  // the bow - drawn at +y - lands at -Z, which is the forward this project uses.
  geometry.rotateX(-Math.PI / 2);

  return new Mesh(
    geometry,
    new MeshStandardMaterial({ color: colour, roughness: 0.85, metalness: 0.05 }),
  );
}

function bridgeMesh(
  vessel: Vessel,
  freeboard: number,
  height: number,
  offsetForward: number,
): Mesh {
  // Scaled off the hull that is drawn, not off the particulars, or the house sits on a ship
  // of a slightly different size from the one under it.
  const hull = hullDimensions(vessel);
  const bridge = new Mesh(
    new BoxGeometry(hull.beamMetres * 0.62, height, hull.lengthMetres * 0.1),
    new MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.7 }),
  );
  bridge.position.set(0, freeboard + height / 2, -offsetForward);
  return bridge;
}
