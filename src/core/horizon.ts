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

/**
 * One line of sight, from an eye at one height to something of another height.
 *
 * Grouped rather than passed as three loose numbers because they only mean anything
 * together, and because getting the first two the wrong way round silently answers a
 * different question - the same reason `visibleLights` names whose bearing it wants.
 *
 * Both heights are above the MEAN surface. A vessel floating on a sea rides up and down
 * with it, which is a real effect and a large one at long range; it is handled where the
 * sea is known, in `core/visibility.ts`, not here. This module knows only geometry.
 */
export interface Sightline {
  eyeHeightMetres: number;
  /** Height above the waterline of the part of the target being asked about. */
  targetHeightMetres: number;
  rangeMetres: number;
}

/**
 * How far the sight line clears the mean surface, at one distance along it.
 *
 * The eye is at its own height; the target is at its own height minus the drop over the
 * whole range, because it stands on a surface that has fallen away; between them the line
 * is straight and the surface keeps falling, which is what makes this a parabola rather
 * than a wedge.
 */
export function clearanceMetres(sightline: Sightline, atMetres: number): number {
  const { eyeHeightMetres, targetHeightMetres, rangeMetres } = sightline;
  if (rangeMetres <= 0) return eyeHeightMetres;
  const target = targetHeightMetres - dropMetres(rangeMetres);
  const along = (target - eyeHeightMetres) * (atMetres / rangeMetres);
  return eyeHeightMetres + along + dropMetres(atMetres);
}

/**
 * Where along the line it comes closest to the water.
 *
 * Inside `sqrt(2R(h - f))` the minimum falls beyond the target and is clamped back to it:
 * at short range what hides a low vessel is the wave in front of HER, not the horizon, and
 * the threshold there is simply her own height.
 */
export function grazingPointMetres(sightline: Sightline): number {
  const { eyeHeightMetres, targetHeightMetres, rangeMetres } = sightline;
  if (rangeMetres <= 0) return 0;
  const rise = eyeHeightMetres - targetHeightMetres;
  const unclamped = (EFFECTIVE_RADIUS_METRES * rise) / rangeMetres + rangeMetres / 2;
  return Math.min(Math.max(unclamped, 0), rangeMetres);
}

/**
 * The crest height at which this target starts to be hidden.
 *
 * Pure geometry: it assumes nothing whatever about the sea, which is what makes it usable
 * where the sea is unknown - and the sea is always unknown, since no report this project
 * has met states a wave height. It is also the same arithmetic as the horizon, seen from a
 * different side: this reaches zero exactly where `horizonMetres(h) + horizonMetres(f)`
 * says the target drops out of sight, which is why it lives here rather than beside the
 * module that first wanted it.
 *
 * From an 8 m eye, a 1.5 m freeboard is hidden by crests above 1.50 m at 2 km, 1.41 m at
 * 11 km and 0.22 m at 15 km.
 */
export function crestOcclusionMetres(sightline: Sightline): number {
  return clearanceMetres(sightline, grazingPointMetres(sightline));
}
