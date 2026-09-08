/**
 * The one plan shape of a hull, and the one pair of dimensions it is drawn at.
 *
 * **There were two of these and they disagreed.** `render/hull.ts` drew a tapered stern and a
 * curved bow at the particulars' length and beam; `test/examples.spec.ts` asked whether two
 * ships had touched using a rectangle at the AIS offsets' length and beam. Both were
 * defensible on their own and they answer differently: twelve seconds before contact on the
 * reference case the rectangle puts the two ships 5.8 m apart and the drawn outline 8.2 m,
 * because a rectangle's corner sticks out where a bow is raked, by up to half a beam.
 *
 * So the shape lives here, where `render/` and `actors/` can both reach it, and a range
 * between hulls is a range between the hulls that are drawn. This is the same move as
 * `core/light-character.ts` holding one grammar for the rhythms and `render/waves.ts` holding
 * the drawn band next to the analysed one: a rule with two homes has always disagreed with
 * itself here, eventually.
 */

import type { ReferencePointOffsets, Vessel } from "../../core/types.js";

/** A point on the hull's outline, in the ship's own frame. */
export interface PlanPoint {
  /** Towards the bow. */
  forwardMetres: number;
  /** Towards the starboard side. */
  starboardMetres: number;
}

/** How big the hull is, and which of the two sources in the file said so. */
export interface HullDimensions {
  lengthMetres: number;
  beamMetres: number;
  from: "offsets" | "particulars";
}

/**
 * **The four offsets first, because they measure the ship and the particulars describe her.**
 *
 * AIS message 5 gives the distances from the antenna to bow, stern, port and starboard, and
 * they sum to the hull. The particulars' length is often the REGISTERED length, which is a
 * tonnage measurement and shorter than length overall - `docs/format.md` says so, and on the
 * Suo-nada tanker the two sources give beams of 9.0 and 9.4 m, a difference that moves first
 * contact by a second.
 *
 * AIS rounds the four to the metre, so the sums are a metre-grained measurement rather than a
 * precise one. That is still the better of the two, and mixing them - taking length from one
 * and beam from the other - would invent a hull neither source describes.
 */
export function hullDimensions(vessel: Vessel): HullDimensions {
  const offsets = vessel.referencePointOffsets;
  if (!offsets) {
    return { lengthMetres: vessel.loaMetres, beamMetres: vessel.beamMetres, from: "particulars" };
  }
  return { ...fromOffsets(offsets), from: "offsets" };
}

function fromOffsets(offsets: ReferencePointOffsets): { lengthMetres: number; beamMetres: number } {
  return {
    lengthMetres: offsets.fromBowMetres + offsets.fromSternMetres,
    beamMetres: offsets.fromPortMetres + offsets.fromStarboardMetres,
  };
}

/**
 * How many straight segments each half of a curved bow is drawn with.
 *
 * Twelve is three.js's own default for tessellating a curve in an `ExtrudeGeometry`, and the
 * outline is handed back as points rather than as curves so that the polygon a range is
 * measured against is the polygon that gets drawn, vertex for vertex. A curve here and a
 * polyline there would be a small disagreement of exactly the kind this module exists to end.
 */
export const BOW_SEGMENTS = 12;

/** Where the parallel midbody ends, as a fraction of the length from the stern. */
const SHOULDER = 0.68;
/** And where the stern's taper ends. */
const QUARTER = 0.12;
/** Half-beam at the transom, as a fraction of the full half-beam. */
const TRANSOM = 0.85;
/** The bow curve's control point, as a fraction of the length from the stern. */
const ENTRY = 0.92;

/**
 * Whether the bow comes to a point or is square across.
 *
 * One of the three things that actually resolve at the sizes these hulls occupy - at a 3 km
 * view the reference case's pushing unit is twelve pixels wide, where block coefficient is
 * invisible and a square bow is not. A pushing unit is a pusher against the stern of a barge,
 * and a barge is a box; drawn with a raked stem it reads as a ship she is not.
 *
 * From `type`, which is a statement the file already makes, rather than from a catalogue.
 * Here rather than in `render/` because a range between hulls has to know it too, and a
 * second copy of it would put a raked bow in the arithmetic and a square one in the picture.
 */
export function isBoxBowed(vessel: Vessel): boolean {
  return vessel.type === "pushing-ahead";
}

/**
 * The hull seen from overhead, anticlockwise from the middle of the transom.
 *
 * Generated from two numbers because two numbers is what a scenario carries: a borrowed model
 * of some other ship, scaled to fit, is a picture of a different vessel. What the shape is
 * worth is bounded by that - it is the right size and a plausible plan, not this ship's lines
 * - and anything reading a range off it should say so.
 */
export function planOutline(dimensions: HullDimensions, boxBow: boolean): PlanPoint[] {
  const half = dimensions.beamMetres / 2;
  const length = dimensions.lengthMetres;
  const stern = -length / 2;
  const shoulder = stern + length * SHOULDER;
  const at = (starboardMetres: number, forwardMetres: number): PlanPoint => ({
    starboardMetres,
    forwardMetres,
  });

  return [
    at(0, stern),
    at(half * TRANSOM, stern),
    at(half, stern + length * QUARTER),
    at(half, shoulder),
    ...bow(dimensions, boxBow),
    at(-half, stern + length * QUARTER),
    at(-half * TRANSOM, stern),
  ];
}

/** The two quadratics of a raked bow, or the two corners of a square one. */
function bow(dimensions: HullDimensions, boxBow: boolean): PlanPoint[] {
  const half = dimensions.beamMetres / 2;
  const length = dimensions.lengthMetres;
  const stern = -length / 2;
  const stem = { starboardMetres: 0, forwardMetres: length / 2 };
  if (boxBow) {
    // A barge's rake is above the waterline, so from overhead it is a rectangle.
    return [
      { starboardMetres: half, forwardMetres: length / 2 },
      { starboardMetres: -half, forwardMetres: length / 2 },
    ];
  }
  const shoulder = stern + length * SHOULDER;
  const entry = stern + length * ENTRY;
  return [
    ...quadratic(
      { starboardMetres: half, forwardMetres: shoulder },
      { starboardMetres: half, forwardMetres: entry },
      stem,
    ),
    ...quadratic(
      stem,
      { starboardMetres: -half, forwardMetres: entry },
      { starboardMetres: -half, forwardMetres: shoulder },
    ),
  ];
}

/** A quadratic Bézier as `BOW_SEGMENTS` points, the start excluded and the end included. */
function quadratic(from: PlanPoint, control: PlanPoint, to: PlanPoint): PlanPoint[] {
  const points: PlanPoint[] = [];
  for (let step = 1; step <= BOW_SEGMENTS; step += 1) {
    const t = step / BOW_SEGMENTS;
    const a = (1 - t) ** 2;
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push({
      starboardMetres:
        a * from.starboardMetres + b * control.starboardMetres + c * to.starboardMetres,
      forwardMetres: a * from.forwardMetres + b * control.forwardMetres + c * to.forwardMetres,
    });
  }
  return points;
}
