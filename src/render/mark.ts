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
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  type ColorRepresentation,
} from "three";

import { CHOSEN, drawnAppearance, type DrawnMark } from "../actors/mark/appearance.js";
import type { BuoyageRegion, Topmark } from "../actors/mark/buoyage.js";
import type { LightColour } from "../core/light-character.js";
import type {
  Mark,
  MarkColour,
  MarkConstruction,
  MarkKind,
  MarkPattern,
  MarkShape,
} from "../core/types.js";

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
  /**
   * **A height by kind, though the datum is the same for both.** Both figures are metres
   * above the water; what differs is what is usual. 2.4 m is about right for a buoy's body
   * and would be a stump for a structure on a shoal, so one number covering both would not be
   * one assumption used twice but a second, worse one made silently.
   */
  heightMetres: Record<MarkKind, number>;
}

export const ASSUMED_MARK: AssumedMark = {
  shape: CHOSEN.shape,
  heightMetres: { buoy: 2.4, beacon: 8 },
};

const COLOURS: Record<MarkColour, ColorRepresentation> = {
  green: 0x1f7a3d,
  red: 0xb02a2a,
  yellow: 0xd8b430,
  black: 0x1a1a1a,
  white: 0xe8e8e8,
  blue: 0x2a4fb0,
};

/** How tall a beacon stands, how wide it is, and how far its footing goes below the water. */
interface Structure {
  heightMetres: number;
  width: number;
  footing: number;
}

/** The profile a band or a stripe is cut out of: three numbers that always travel together. */
interface Outline {
  shape: MarkShape;
  radius: number;
  length: number;
}

/** How wide the body is against its height, and how much of it floats under. */
const PROPORTIONS: Record<MarkShape, { width: number; draught: number }> = {
  pillar: { width: 0.55, draught: 0.5 },
  spar: { width: 0.22, draught: 1.1 },
  can: { width: 0.95, draught: 0.45 },
  conical: { width: 0.9, draught: 0.45 },
  spherical: { width: 1.1, draught: 0.5 },
};

/** What a light shows, painted the way a lamp is rather than the way a hull is. */
export const LAMP_COLOURS: Record<LightColour, ColorRepresentation> = {
  white: 0xfff4d6,
  red: 0xff4d4d,
  green: 0x4dff88,
  yellow: 0xffe14d,
  blue: 0x6ab8ff,
};

/** A lamp with its own material, so whatever drives the rhythm can set the colour it shows. */
export type Lamp = Points<BufferGeometry, PointsMaterial>;

export interface MarkParts {
  group: Group;
  /**
   * Body height **above the water**, which is what a panel reports and a sightline wants.
   * A beacon's drawn footing goes below that and is not counted here: it is this renderer
   * standing the structure on something, not a sounding.
   */
  heightMetres: number;
  /**
   * The lamp, where the file says the mark carried one. Null otherwise - **and null is not
   * an unlit mark**: a report that does not mention the light is the ordinary case, and
   * drawing a dark lamp on top of the structure would state something the source did not.
   * `render/player.ts` shows and hides it; `actors/mark/light.ts` decides when.
   */
  lamp: Lamp | null;
}

export function buildMark(mark: Mark, region: BuoyageRegion | null = null): MarkParts {
  const height = mark.heightMetres ?? ASSUMED_MARK.heightMetres[mark.kind];
  const drawn = drawnAppearance(mark, region);
  const paint = painter(drawn.pattern.value);

  const group = new Group();
  group.name = `mark:${mark.id}`;
  const shape = drawn.shape?.value ?? ASSUMED_MARK.shape;
  const staff = carriesAStaff(shape, drawn.construction !== null);
  for (const part of standing(drawn, shape, height, paint)) group.add(part);
  if (staff) group.add(mast(height, paint(0)));

  for (const part of above(drawn, height, staff)) group.add(part);
  return withLamp(mark, group, height, staff);
}

/**
 * The topmark, where there is one to draw.
 *
 * Two of the four things `drawnAppearance` can say about a topmark have nothing to draw: that
 * the file said there was none, and that it said there was one without saying what the mark
 * was for. Both are statements, and `ui/panels.ts` prints them - here they are simply not
 * shapes.
 */
function above(drawn: DrawnMark, height: number, staff: boolean): Mesh[] {
  const shape = drawn.topmark?.value;
  if (!shape || shape === "carried one") return [];
  return topmark(shape, height, staff);
}

/** The body of a buoy, or the structure of a beacon - the parts that stand in the water. */
function standing(drawn: DrawnMark, shape: MarkShape, height: number, paint: Painter): Mesh[] {
  return drawn.construction
    ? beacon(height, drawn.construction.value, paint)
    : body(shape, height, drawn.pattern.value, paint);
}

/**
 * A topmark needs something to sit on, and so does a lamp.
 *
 * A pillar or a spar carries a staff above its body; a can or a cone is a body with a flat
 * top and needs none. **A beacon needs none either** - the structure IS the support, and a
 * staff on top of it would put its light half as high again as the height the file stated.
 */
function carriesAStaff(shape: MarkShape, built: boolean): boolean {
  return !built && (shape === "pillar" || shape === "spar");
}

/**
 * The colours as they sit on the body, given to each part as it is built.
 *
 * A closure rather than a material, because a banded mark is several meshes and each takes
 * the colour of the band it falls in. **Drawn as geometry rather than as a texture**: a
 * canvas would put a DOM in the way of every test that builds a mark in Node, and the bands
 * are what the tests need to be able to measure.
 */
type Painter = (fraction: number) => MeshStandardMaterial;

function painter(pattern: MarkPattern): Painter {
  const colours = pattern.colours.length > 0 ? pattern.colours : CHOSEN.pattern.colours;
  return (fraction: number) => {
    const index = Math.min(Math.floor(fraction * colours.length), colours.length - 1);
    return paintOf(colours[index] ?? "yellow");
  };
}

function paintOf(colour: MarkColour): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: COLOURS[colour], roughness: 0.65, metalness: 0.05 });
}

/**
 * The lamp goes at the top of whatever was just built, which is where one is.
 *
 * Hidden as it is made. A light that came on the moment a stage was built would flash once
 * out of rhythm before the clock had said anything, and the first thing a viewer reads off a
 * mark at night is its rhythm.
 */
function withLamp(mark: Mark, group: Group, heightMetres: number, onAStaff: boolean): MarkParts {
  if (!mark.light) return { group, heightMetres, lamp: null };

  const lamp: Lamp = new Points(
    new BufferGeometry().setAttribute(
      "position",
      new Float32BufferAttribute([0, topOf(heightMetres, onAStaff), 0], 3),
    ),
    new PointsMaterial({
      color: LAMP_COLOURS.white,
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
    }),
  );
  lamp.name = `lamp:${mark.id}`;
  lamp.visible = false;
  group.add(lamp);
  return { group, heightMetres, lamp };
}

/**
 * Above the staff where one was drawn, and on top of the body where none was.
 *
 * **Asked of the staff that was actually built**, not of the file's own `shape`. A safe-water
 * mark is a sphere with no staff, and its shape comes from its purpose rather than from a
 * stated field - read the field instead and its lamp is placed three quarters of its own
 * height above nothing at all.
 */
function topOf(heightMetres: number, onAStaff: boolean): number {
  return onAStaff ? heightMetres * 1.75 : heightMetres;
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
function beacon(heightMetres: number, construction: MarkConstruction, paint: Painter): Mesh[] {
  const width = heightMetres * 0.28;
  // Enough of a base to read as standing on something rather than hovering. It is not a
  // stated depth: nothing here knows how deep the shoal is, which is why it is proportional
  // to the structure rather than to any figure claiming to be a sounding.
  const footing = heightMetres * 0.35;
  const structure: Structure = { heightMetres, width, footing };
  const parts =
    construction === "lattice"
      ? lattice(structure, paint)
      : [uprights(structure, construction, paint)];

  // A pile is driven into the ground and stands on nothing else. The others are built on a
  // base, which is the difference a viewer reads between a structure and a stake.
  if (construction !== "pile") {
    const plinth = new Mesh(new CylinderGeometry(width, width, footing * 0.5, 12), paint(1));
    plinth.position.y = -footing * 0.75;
    parts.push(plinth);
  }
  return parts;
}

/**
 * A tower tapers hard, a column barely, a pile is a stake. That is the whole of what these
 * words distinguish - the form is engineering and means nothing, which is why it is a field
 * of its own and not part of the buoyage's vocabulary.
 */
function uprights(structure: Structure, construction: MarkConstruction, paint: Painter): Mesh {
  const { heightMetres, width, footing } = structure;
  const profile: Record<MarkConstruction, [number, number]> = {
    tower: [0.22, 0.75],
    lattice: [0.3, 0.7],
    column: [0.35, 0.5],
    pile: [0.14, 0.16],
  };
  const [top, bottom] = profile[construction];
  const mesh = new Mesh(
    new CylinderGeometry(width * top, width * bottom, heightMetres + footing, 12),
    paint(0),
  );
  mesh.position.y = (heightMetres - footing) / 2;
  return mesh;
}

/**
 * Four legs leaning inward with bracing across them - a framework rather than a solid, which
 * is what a lattice reads as at any distance where the members themselves are too fine to see.
 */
function lattice(structure: Structure, paint: Painter): Mesh[] {
  const { heightMetres, width, footing } = structure;
  const leg = width * 0.09;
  const length = heightMetres + footing;
  const parts: Mesh[] = [];
  const corners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [x, z] of corners) {
    const mesh = new Mesh(new CylinderGeometry(leg, leg, length, 6), paint(0));
    mesh.position.set(x * width * 0.4, (heightMetres - footing) / 2, z * width * 0.4);
    parts.push(mesh);
  }
  for (const level of [0.35, 0.75]) {
    const bar = new Mesh(new BoxGeometry(width * 0.9, leg * 1.5, width * 0.9), paint(level));
    bar.position.y = heightMetres * level;
    parts.push(bar);
  }
  return parts;
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
  pattern: MarkPattern,
  paint: Painter,
): Mesh[] {
  const proportions = PROPORTIONS[shape];
  const radius = heightMetres * proportions.width * 0.5;
  const draught = heightMetres * proportions.draught;
  const length = heightMetres + draught;

  const outline: Outline = { shape, radius, length };
  const parts =
    pattern.kind === "vertical stripes"
      ? stripes(outline, pattern.colours.length, paint)
      : bands(outline, pattern.colours.length, paint);
  for (const part of parts) part.position.y += (heightMetres - draught) / 2;
  return parts;
}

/**
 * Horizontal bands, top to bottom - which is how every cardinal mark says which quadrant it
 * is, and how an isolated danger says it is one.
 *
 * Each band is its own slice of the profile, so a cone stays a cone: the slice takes its
 * radii off the outline at its own top and bottom edges rather than being a cylinder
 * pretending to be part of one.
 */
function bands(outline: Outline, count: number, paint: Painter): Mesh[] {
  const bandCount = Math.max(count, 1);
  const parts: Mesh[] = [];
  for (let i = 0; i < bandCount; i += 1) {
    const from = i / bandCount;
    const to = (i + 1) / bandCount;
    const mesh = new Mesh(slice(outline, from, to), paint(from));
    // A sphere's slices carry their own place within the geometry; a cylinder's are centred.
    const middle = outline.length / 2 - ((from + to) / 2) * outline.length;
    if (outline.shape !== "spherical") mesh.position.y = middle;
    parts.push(mesh);
  }
  return parts;
}

/**
 * Vertical stripes, around the body - the safe-water mark's red and white, and the emergency
 * wreck buoy's blue and yellow. Wedges of the body itself rather than a pattern painted onto
 * it, so the silhouette is untouched and the colours turn with the mark.
 */
function stripes(outline: Outline, count: number, paint: Painter): Mesh[] {
  const stripeCount = Math.max(count, 1);
  const parts: Mesh[] = [];
  for (let i = 0; i < stripeCount; i += 1) {
    const from = (i / stripeCount) * Math.PI * 2;
    const width = (Math.PI * 2) / stripeCount;
    parts.push(new Mesh(wedge(outline, from, width), paint(i / stripeCount)));
  }
  return parts;
}

/** One horizontal slice of the outline, between two fractions of its height from the top. */
function slice({ shape, radius, length }: Outline, from: number, to: number): BufferGeometry {
  if (shape === "spherical") {
    const sphere = new SphereGeometry(
      radius,
      20,
      14,
      0,
      Math.PI * 2,
      from * Math.PI,
      (to - from) * Math.PI,
    );
    sphere.scale(1, length / (2 * radius), 1);
    return sphere;
  }
  const narrow = shape === "conical" ? 0.15 : 1;
  const at = (fraction: number): number => radius * (narrow + (1 - narrow) * fraction);
  return new CylinderGeometry(at(from), at(to), (to - from) * length, 16);
}

/** One vertical wedge of the outline, an angle wide. */
function wedge({ shape, radius, length }: Outline, from: number, width: number): BufferGeometry {
  if (shape === "spherical") {
    const sphere = new SphereGeometry(radius, 20, 14, from, width);
    sphere.scale(1, length / (2 * radius), 1);
    return sphere;
  }
  const narrow = shape === "conical" ? 0.15 : 1;
  return new CylinderGeometry(radius * narrow, radius, length, 16, 1, false, from, width);
}

/**
 * The shape on top, which is a mark's daylight statement when its colours cannot be told
 * apart - and for a cardinal mark, the only thing that separates north from south by day.
 *
 * R1001 calls the double cone "a very important feature of every Cardinal mark by day", to be
 * used "as large as possible with a clear separation between the cones", and says the same of
 * the isolated danger's two spheres. Drawn large and clearly apart for that reason: close the
 * gap and a west cardinal's point-to-point cones read as one diamond.
 */
function topmark(
  mark: { shape: Topmark; colour: MarkColour },
  heightMetres: number,
  onAStaff: boolean,
): Mesh[] {
  const size = heightMetres * 0.3;
  const it = {
    size,
    gap: size * 0.5,
    base: onAStaff ? heightMetres * 1.75 : heightMetres,
    paint: paintOf(mark.colour),
  };
  return byShape(mark.shape, it);
}

interface TopmarkPlace {
  size: number;
  gap: number;
  base: number;
  paint: MeshStandardMaterial;
}

/**
 * Base to base is east and point to point is west; points up is north and points down is
 * south. **Nothing else tells the four apart by day**, so the pairing of the two cones is
 * the whole message and a mirrored pair is a different quadrant.
 */
const CONE_PAIRS: Partial<Record<Topmark, [boolean, boolean]>> = {
  "two cones point up": [true, true],
  "two cones point down": [false, false],
  "two cones base to base": [false, true],
  "two cones point to point": [true, false],
};

/**
 * The rest, which are one or two of a single shape - and the two crosses, which differ only
 * in how far they are turned.
 */
function byShape(shape: Topmark, it: TopmarkPlace): Mesh[] {
  const lower = it.base + it.size / 2;
  const upper = it.base + it.size * 1.5 + it.gap;
  const pair = CONE_PAIRS[shape];
  if (pair) return [cone(it, lower, pair[0]), cone(it, upper, pair[1])];

  switch (shape) {
    case "two spheres":
      return [ball(it, lower), ball(it, upper)];
    case "sphere":
      return [ball(it, lower)];
    case "can":
      return [drum(it, lower)];
    case "cone point up":
      return [cone(it, lower, true)];
    // An X for a special mark (Table 9), an upright cross for an emergency wreck buoy
    // (Table 11). Drawn alike, one would be read as the other.
    case "saltire":
      return cross(it, lower, Math.PI / 4);
    case "upright cross":
      return cross(it, lower, 0);
    default:
      // The four cone pairs, already answered above. Reached only if one is added to the
      // vocabulary and left out of the table, which is a thing to notice rather than to draw.
      return [];
  }
}

function cone(it: TopmarkPlace, y: number, pointUp: boolean): Mesh {
  const mesh = new Mesh(new ConeGeometry(it.size * 0.5, it.size, 12), it.paint);
  if (!pointUp) mesh.rotation.z = Math.PI;
  mesh.position.y = y;
  return mesh;
}

function ball(it: TopmarkPlace, y: number): Mesh {
  const mesh = new Mesh(new SphereGeometry(it.size * 0.5, 16, 12), it.paint);
  mesh.position.y = y;
  return mesh;
}

function drum(it: TopmarkPlace, y: number): Mesh {
  const mesh = new Mesh(new CylinderGeometry(it.size * 0.5, it.size * 0.5, it.size, 12), it.paint);
  mesh.position.y = y;
  return mesh;
}

/** Two arms at right angles, turned by `lean` - nought upright, a quarter turn for an X. */
function cross(it: TopmarkPlace, y: number, lean: number): Mesh[] {
  return [lean, lean + Math.PI / 2].map((turn) => {
    const arm = new Mesh(new BoxGeometry(it.size * 0.22, it.size, it.size * 0.22), it.paint);
    arm.rotation.z = turn;
    arm.position.y = y;
    return arm;
  });
}

/** The staff a topmark and a lamp sit on. */
function mast(heightMetres: number, material: MeshStandardMaterial): Mesh {
  const length = heightMetres * 0.75;
  const mesh = new Mesh(
    new CylinderGeometry(heightMetres * 0.05, heightMetres * 0.05, length, 8),
    material,
  );
  mesh.position.y = heightMetres + length / 2;
  return mesh;
}
