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

import type { Vessel } from "../core/types.js";

/**
 * Freeboard and superstructure height are not in the data, and these are guesses.
 *
 * They are the two that a catalogue of ship classes is meant to replace (issue #8), because
 * neither varies smoothly with size: freeboard is depth minus draught, and depth is set by
 * class - a 499 GT Japanese coaster is 6.8 to 7.4 m of it whatever else about her varies.
 * The scenario already carries the draught; what is missing is the depth, and that has to
 * come from a source rather than from here.
 */
const FREEBOARD_FRACTION_OF_BEAM = 0.55;
const BRIDGE_HEIGHT_FRACTION_OF_BEAM = 0.75;

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
  if (!offsets) return { metres: -vessel.loaMetres * BRIDGE_FRACTION_AFT, fromOffsets: false };
  return {
    metres: -(offsets.fromBowMetres - offsets.fromSternMetres) / 2,
    fromOffsets: true,
  };
}

/**
 * Whether the bow comes to a point or is square across.
 *
 * One of the three things that actually resolve at the sizes these hulls occupy - at a 3 km
 * view the reference case's pushing unit is twelve pixels wide, where block coefficient is
 * invisible and a square bow is not. A pushing unit is a pusher against the stern of a
 * barge, and a barge is a box; drawn with a raked stem it reads as a ship she is not.
 *
 * From `type`, which is a statement the file already makes, rather than from a catalogue.
 */
function isBoxBowed(vessel: Vessel): boolean {
  return vessel.type === "pushing-ahead";
}

/**
 * Plan-view outline as fractions of length, measured from the stern. Squared off aft,
 * parallel through the middle, and forward either pointed or square - enough for the
 * silhouette to read as the right kind of ship from overhead and from another bridge.
 */
function planOutline(length: number, beam: number, boxBow: boolean): Shape {
  const halfBeam = beam / 2;
  const shape = new Shape();

  // Working in (x = starboard, y = forward) and converting to the XZ plane on extrude.
  const stern = -length / 2;
  const bow = length / 2;
  const shoulder = stern + length * 0.68;

  shape.moveTo(0, stern);
  shape.lineTo(halfBeam * 0.85, stern);
  shape.lineTo(halfBeam, stern + length * 0.12);
  shape.lineTo(halfBeam, shoulder);
  if (boxBow) {
    // Straight out to the stem and square across it: the rake of a barge's bow is above the
    // waterline, so from overhead it is a rectangle.
    shape.lineTo(halfBeam, bow);
    shape.lineTo(-halfBeam, bow);
  } else {
    shape.quadraticCurveTo(halfBeam, stern + length * 0.92, 0, bow);
    shape.quadraticCurveTo(-halfBeam, stern + length * 0.92, -halfBeam, shoulder);
  }
  shape.lineTo(-halfBeam, stern + length * 0.12);
  shape.lineTo(-halfBeam * 0.85, stern);
  shape.closePath();

  return shape;
}

export function buildHull(vessel: Vessel, colour: ColorRepresentation): HullParts {
  const beam = vessel.beamMetres;
  const freeboard = beam * FREEBOARD_FRACTION_OF_BEAM;
  const bridgeHeight = beam * BRIDGE_HEIGHT_FRACTION_OF_BEAM;
  const bridge = bridgeOffsetOf(vessel);

  const group = new Group();
  group.add(hullMesh(vessel, freeboard, colour));
  group.add(bridgeMesh(vessel, freeboard, bridgeHeight, bridge.metres));

  return {
    group,
    eyeHeightMetres: freeboard + bridgeHeight * 0.85,
    bridgeOffsetForwardMetres: bridge.metres,
    bridgeFromOffsets: bridge.fromOffsets,
  };
}

function hullMesh(vessel: Vessel, freeboard: number, colour: ColorRepresentation): Mesh {
  const geometry = new ExtrudeGeometry(
    planOutline(vessel.loaMetres, vessel.beamMetres, isBoxBowed(vessel)),
    {
      depth: freeboard,
      bevelEnabled: false,
    },
  );
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
  const bridge = new Mesh(
    new BoxGeometry(vessel.beamMetres * 0.62, height, vessel.loaMetres * 0.1),
    new MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.7 }),
  );
  bridge.position.set(0, freeboard + height / 2, -offsetForward);
  return bridge;
}
