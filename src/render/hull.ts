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

/** Freeboard and superstructure are not in the data; these keep the proportions sane. */
const FREEBOARD_FRACTION_OF_BEAM = 0.55;
const BRIDGE_HEIGHT_FRACTION_OF_BEAM = 0.75;

export interface HullParts {
  group: Group;
  /** Height above the waterline of the bridge windows, in metres. */
  eyeHeightMetres: number;
  /** Distance forward of the hull centre where the bridge sits, in metres. */
  bridgeOffsetForwardMetres: number;
}

/**
 * Plan-view outline as fractions of length, measured from the stern. Pointed forward,
 * squared off aft, parallel through the middle - enough for the silhouette to read as a
 * ship from overhead and from another bridge.
 */
function planOutline(length: number, beam: number): Shape {
  const halfBeam = beam / 2;
  const shape = new Shape();

  // Working in (x = starboard, y = forward) and converting to the XZ plane on extrude.
  const stern = -length / 2;
  const bow = length / 2;

  shape.moveTo(0, stern);
  shape.lineTo(halfBeam * 0.85, stern);
  shape.lineTo(halfBeam, stern + length * 0.12);
  shape.lineTo(halfBeam, stern + length * 0.68);
  shape.quadraticCurveTo(halfBeam, stern + length * 0.92, 0, bow);
  shape.quadraticCurveTo(-halfBeam, stern + length * 0.92, -halfBeam, stern + length * 0.68);
  shape.lineTo(-halfBeam, stern + length * 0.12);
  shape.lineTo(-halfBeam * 0.85, stern);
  shape.closePath();

  return shape;
}

export function buildHull(vessel: Vessel, colour: ColorRepresentation): HullParts {
  const length = vessel.loaMetres;
  const beam = vessel.beamMetres;
  const freeboard = beam * FREEBOARD_FRACTION_OF_BEAM;
  const bridgeHeight = beam * BRIDGE_HEIGHT_FRACTION_OF_BEAM;
  // A pusher unit and a tanker put the bridge in different places, but the scenario does
  // not say where. Aft is right for almost everything that appears in a collision report.
  const bridgeOffsetForward = -length * 0.32;

  const group = new Group();
  group.add(hullMesh(vessel, freeboard, colour));
  group.add(bridgeMesh(vessel, freeboard, bridgeHeight, bridgeOffsetForward));

  return {
    group,
    eyeHeightMetres: freeboard + bridgeHeight * 0.85,
    bridgeOffsetForwardMetres: bridgeOffsetForward,
  };
}

function hullMesh(vessel: Vessel, freeboard: number, colour: ColorRepresentation): Mesh {
  const geometry = new ExtrudeGeometry(planOutline(vessel.loaMetres, vessel.beamMetres), {
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
  const bridge = new Mesh(
    new BoxGeometry(vessel.beamMetres * 0.62, height, vessel.loaMetres * 0.1),
    new MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.7 }),
  );
  bridge.position.set(0, freeboard + height / 2, -offsetForward);
  return bridge;
}
