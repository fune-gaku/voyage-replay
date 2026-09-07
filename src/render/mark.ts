/**
 * Sea marks, which for now means buoys.
 *
 * A buoy is the plainest instrument this renderer has for showing a sea. It is small
 * against an ocean wave - a few metres against a hundred - so it follows the surface almost
 * exactly, and a viewer reads the swell off its rise, fall and tilt more directly than off
 * the water itself. That is not only a presentational point: which side of a mark a ship
 * passed is regularly the question a report turns on.
 *
 * **It rides the sea as DRAWN, not the sea as computed.** Past the range where the water's
 * geometry fades to flat, the buoy stops heaving with it. A buoy bobbing over visibly still
 * water would be the same kind of untruth as a panel claiming more than the picture shows.
 */

import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from "three";

import type { Mark, MarkColour, MarkShape } from "../core/types.js";

/**
 * Where a report says nothing. A pillar is the commonest shape in open water, and 2.4 m of
 * body about the usual for one; both are assumptions and `ui/panels.ts` says so.
 */
const ASSUMED_SHAPE: MarkShape = "pillar";
const ASSUMED_HEIGHT_METRES = 2.4;

const COLOURS: Record<MarkColour, ColorRepresentation> = {
  green: 0x1f7a3d,
  red: 0xb02a2a,
  yellow: 0xd8b430,
  black: 0x1a1a1a,
  white: 0xe8e8e8,
};

/** How wide the body is against its height, and how much of it floats under. */
const PROPORTIONS: Record<MarkShape, { width: number; draught: number }> = {
  pillar: { width: 0.55, draught: 0.5 },
  spar: { width: 0.22, draught: 1.1 },
  can: { width: 0.95, draught: 0.45 },
  conical: { width: 0.9, draught: 0.45 },
  spherical: { width: 1.1, draught: 0.5 },
};

export interface MarkParts {
  group: Group;
  /** Body height above the waterline, which is what a panel reports and a sightline wants. */
  heightMetres: number;
}

export function buildMark(mark: Mark): MarkParts {
  const shape = mark.shape ?? ASSUMED_SHAPE;
  const height = mark.heightMetres ?? ASSUMED_HEIGHT_METRES;
  const proportions = PROPORTIONS[shape];
  const material = new MeshStandardMaterial({
    color: COLOURS[mark.colour ?? "yellow"],
    roughness: 0.65,
    metalness: 0.05,
  });

  const group = new Group();
  group.name = `mark:${mark.id}`;
  group.add(body(shape, height, proportions, material));
  if (shape === "pillar" || shape === "spar") group.add(mast(height, material));
  return { group, heightMetres: height };
}

/**
 * The float itself, straddling the waterline.
 *
 * Some of it goes below: a buoy sitting exactly on the surface reads as a toy, and in a
 * trough the water would otherwise be seen through the gap underneath it.
 */
function body(
  shape: MarkShape,
  heightMetres: number,
  proportions: { width: number; draught: number },
  material: MeshStandardMaterial,
): Mesh {
  const radius = heightMetres * proportions.width * 0.5;
  const draught = heightMetres * proportions.draught;
  const top = shape === "conical" ? 0.15 : 1;
  const geometry = new CylinderGeometry(radius * top, radius, heightMetres + draught, 16);
  const mesh = new Mesh(geometry, material);
  mesh.position.y = (heightMetres - draught) / 2;
  return mesh;
}

/** The staff a topmark and a light would sit on. Drawn, but nothing is hung on it yet. */
function mast(heightMetres: number, material: MeshStandardMaterial): Mesh {
  const length = heightMetres * 0.75;
  const mesh = new Mesh(
    new CylinderGeometry(heightMetres * 0.05, heightMetres * 0.05, length, 8),
    material,
  );
  mesh.position.y = heightMetres + length / 2;
  return mesh;
}
