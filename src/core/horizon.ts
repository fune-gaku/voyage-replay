/**
 * How far you can see, and how much of what is out there the earth is hiding.
 *
 * Everything else in this project works on a flat tangent plane, and for a few kilometres
 * that is right to within centimetres - see `geodesy.ts`. A bridge view is not a few
 * kilometres. Land is looked at out to forty of them, and on a flat plane every one of
 * those coastlines shows its own waterline, which is the one thing a seafarer reads as
 * wrong in a single glance: what you actually see at twenty-five miles is a summit with no
 * shore under it.
 *
 * Arithmetic only, and in `core/` rather than beside the renderer that first needed it,
 * because "how far off is that headland, and is its foot below the horizon" is a question
 * the panels and any future radar view will ask too, and two derivations of it would be
 * two answers.
 *
 * ## The two things this gets right that the schoolbook version does not
 *
 * - **Light bends towards the earth, so the horizon is further off than geometry says.**
 *   The standard allowance is a coefficient of 0.13, which is the same as working on an
 *   earth of R/(1-k) - 7323 km against the real 6371. Left out, the horizon comes up seven
 *   per cent short.
 * - **The dip of the horizon is not the interesting part.** From a twenty-metre eye it is
 *   eight minutes of arc, which in a 55-degree window on a tall canvas is under two pixels.
 *   What matters is the sinking: 27 m at twenty kilometres, 171 m at fifty.
 *
 * Non-standard refraction - the ducting that lifts a ship over the horizon on a calm
 * evening - is not modelled. It cannot be: no report records it. The coefficient is one
 * named constant so that the day somebody wants to argue about it, there is one place.
 */

export const EARTH_RADIUS_METRES = 6_371_008.8;

/** Standard atmospheric refraction. See the note above before changing it. */
export const REFRACTION_COEFFICIENT = 0.13;

/** The radius to do the arithmetic on, with refraction folded in. */
export const EFFECTIVE_RADIUS_METRES = EARTH_RADIUS_METRES / (1 - REFRACTION_COEFFICIENT);

/**
 * Distance to the visible horizon from an eye at this height, in metres.
 *
 * The familiar 2.08 x sqrt(height) in nautical miles is this same figure: a twenty-metre
 * eye sees 17.1 km, which is 9.2 miles.
 */
export function horizonMetres(eyeHeightMetres: number): number {
  return Math.sqrt(2 * EFFECTIVE_RADIUS_METRES * Math.max(eyeHeightMetres, 0));
}

/**
 * How far the surface has fallen away at this distance from the observer's own foot.
 *
 * This is what everything in a bridge view is displaced by, and it is measured from the
 * eye's position on the water rather than from the eye itself: the observer stays their own
 * height above their own patch of sea however high they are standing.
 */
export function dropMetres(distanceMetres: number): number {
  return (distanceMetres * distanceMetres) / (2 * EFFECTIVE_RADIUS_METRES);
}

/**
 * How much of a distant object's own height is below the horizon, in metres.
 *
 * Zero inside the horizon, and the whole of it once the object is short enough and far
 * enough. From a twenty-metre eye: nothing at ten kilometres, 0.6 m at twenty, 11 m at
 * thirty, 74 m at fifty.
 */
export function hiddenHeightMetres(eyeHeightMetres: number, distanceMetres: number): number {
  const beyond = distanceMetres - horizonMetres(eyeHeightMetres);
  return beyond <= 0 ? 0 : dropMetres(beyond);
}
