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
 *
 * **A beacon does none of that.** It is built on a foundation on the shoal it marks, so it
 * neither heaves nor tilts, and it has no IALA body shape - a can is port hand and a cone
 * starboard, and a structure means nothing at all. The schema refuses a shape on one.
 *
 * **Its stated height is above the WATER, like a buoy's**, and the footing drawn below the
 * surface is not part of it. Nothing states how deep the ground under a beacon is, so a
 * height measured from the foundation could not be placed against the water at all - and a
 * structure hanging in mid-air is not a picture either, which is why there is a footing at
 * all. `ui/panels.ts` says that the part below the water is drawn rather than reported.
 */

import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type ColorRepresentation,
} from "three";

import type { Mark, MarkColour, MarkShape } from "../core/types.js";

/**
 * Where a report says nothing. A pillar is the commonest shape in open water, 2.4 m of body
 * about the usual for one, and 8 m above the water about the usual for a small light
 * beacon. All of them are assumptions, and `ui/panels.ts` names them as such beside the
 * mark they were used for - on screen a chosen pillar and a stated one look exactly alike,
 * and a can is port hand where a cone is starboard.
 *
 * **Exported so the page reads them rather than repeating them.** Written out twice they
 * drift: change the shape drawn here and the panel goes on naming the old one, which is the
 * page and the picture disagreeing about the same buoy - the fault this whole object exists
 * to declare away.
 */
export interface AssumedMark {
  shape: MarkShape;
  colour: MarkColour;
  /**
   * **A height by kind, though the datum is the same for both.** Both figures are metres
   * above the water; what differs is what is usual. 2.4 m is about right for a buoy's body
   * and would be a stump for a structure on a shoal, so one number covering both would not be
   * one assumption used twice but a second, worse one made silently.
   */
  heightMetres: Record<Mark["kind"], number>;
}

export const ASSUMED_MARK: AssumedMark = {
  shape: "pillar",
  colour: "yellow",
  heightMetres: { buoy: 2.4, beacon: 8 },
};

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
  const height = mark.heightMetres ?? ASSUMED_MARK.heightMetres[mark.kind];
  const material = new MeshStandardMaterial({
    color: COLOURS[mark.colour ?? ASSUMED_MARK.colour],
    roughness: 0.65,
    metalness: 0.05,
  });

  const group = new Group();
  group.name = `mark:${mark.id}`;
  if (mark.kind === "beacon") {
    for (const part of beacon(height, material)) group.add(part);
    return { group, heightMetres: height };
  }

  const shape = mark.shape ?? ASSUMED_MARK.shape;
  group.add(body(shape, height, PROPORTIONS[shape], material));
  if (shape === "pillar" || shape === "spar") group.add(mast(height, material));
  return { group, heightMetres: height };
}

/**
 * A beacon: a structure standing on a foundation, not a body floating on a surface.
 *
 * Drawn from the water DOWN as well as up, because that is what it does - it is built on
 * the shoal it marks and the sea runs past it. A buoy's body straddles a waterline it
 * follows; this one passes through a waterline that moves around it.
 *
 * **`heightMetres` is the part above the water, and only that part.** The footing goes below
 * the surface as well, but its depth is invented here - nothing in the format says how deep
 * the ground is - so it must not be counted into a height a report stated. Sinking the
 * structure until it stood `heightMetres` tall from the plinth would move the top down by an
 * amount nobody measured, and the top is what a sightline asks about.
 *
 * One form for now. What kind of structure - a tower, a lattice, a column, a pile - is a
 * vocabulary the format does not have yet, and inventing one here would put a shape on the
 * screen that the file never chose. Issue #42.
 */
function beacon(heightMetres: number, material: MeshStandardMaterial): Mesh[] {
  const width = heightMetres * 0.28;
  // Enough of a base to read as standing on something rather than hovering. It is not a
  // stated depth: nothing here knows how deep the shoal is, which is why it is proportional
  // to the structure rather than to any figure claiming to be a sounding.
  const footing = heightMetres * 0.35;

  const column = new Mesh(
    new CylinderGeometry(width * 0.35, width * 0.5, heightMetres + footing, 12),
    material,
  );
  column.position.y = (heightMetres - footing) / 2;

  const plinth = new Mesh(new CylinderGeometry(width, width, footing * 0.5, 12), material);
  plinth.position.y = -footing * 0.75;
  return [column, plinth];
}

/**
 * The float itself, straddling the waterline.
 *
 * Some of it goes below: a buoy sitting exactly on the surface reads as a toy, and in a
 * trough the water would otherwise be seen through the gap underneath it.
 *
 * **The silhouette has to be the shape the panel names.** A shape is a statement in the
 * buoyage - a can is port hand, a cone starboard, a sphere safe water - so a spherical mark
 * drawn as a flat-topped drum is the page and the picture disagreeing about what was there.
 * `test/mark.spec.ts` holds each outline by its own profile rather than by its geometry
 * class: constant width for a drum, narrowing for a cone, widest in the middle for a
 * sphere.
 */
function body(
  shape: MarkShape,
  heightMetres: number,
  proportions: { width: number; draught: number },
  material: MeshStandardMaterial,
): Mesh {
  const radius = heightMetres * proportions.width * 0.5;
  const draught = heightMetres * proportions.draught;
  const mesh = new Mesh(outline(shape, radius, heightMetres + draught), material);
  mesh.position.y = (heightMetres - draught) / 2;
  return mesh;
}

function outline(shape: MarkShape, radius: number, length: number): BufferGeometry {
  if (shape === "spherical") {
    // Squashed a little, as a spherical mark is: the width is the part that reads.
    const sphere = new SphereGeometry(radius, 20, 14);
    sphere.scale(1, length / (2 * radius), 1);
    return sphere;
  }
  const top = shape === "conical" ? 0.15 : 1;
  return new CylinderGeometry(radius * top, radius, length, 16);
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
