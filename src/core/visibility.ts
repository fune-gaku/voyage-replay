/**
 * Whether the sea was between one ship and another.
 *
 * `horizon.ts` says how far a sight line clears the mean surface; `seaway.ts` says how the
 * surface moves. This puts them together and answers the question a report is usually
 * arguing about - could she have been seen - with the one thing it can honestly produce:
 * a pair of bounds.
 *
 * ## Why the minimum clearance is not the answer
 *
 * The obvious version asks for the probability that the surface, at the one point where
 * the sight line comes closest to it, is above that point. It is wrong by one to two
 * orders of magnitude, and always in the same direction.
 *
 * The clearance is quadratic about the grazing point - `c(x) = A + (x - x*)^2 / 2R` - so
 * it takes KILOMETRES to rise by a single standard deviation: 2.1 km at Hs 1.25 m, 3.0 km
 * at Hs 2.5 m. Hundreds of waves stand within a whisker of the line, and the target is
 * hidden if ANY of them is over it. Measured against a spectral Monte Carlo, for an 8 m eye
 * on a 1.5 m freeboard at 13 km in a 1.25 m sea: point probability 0.1%, truth 48%.
 *
 * So the crossing rate is integrated ALONG the line instead - the Rice form, one closed
 * expression, no random numbers, so a scenario reads the same every time it is opened.
 *
 * ## Two bounds, because the target floats too
 *
 * Every height here is above the MEAN surface, but a vessel rides the sea: she drops into
 * troughs, which hides her, and rises on crests, which shows her. Which effect wins
 * REVERSES with range. Near the horizon her rise lifts her clear; closer in, her drop
 * matters more than the crests do. Measured, 8 m eye on 1.5 m freeboard in a 2 m sea:
 *
 * | range | held rigid | riding |
 * |---|---|---|
 * | 8 km | 18% | 36% |
 * | 11 km | 82% | 64% |
 * | 13 km | 100% | 94% |
 *
 * Neither is the safe side, so neither can be chosen. Both are returned. Which is nearer
 * the truth depends on her length against the wavelength, which is her heave response -
 * exactly what issue #32 holds back for want of a recorded GM. Picking one here would be
 * making that judgement quietly.
 *
 * **A riding vessel cannot be hidden by the wave she is sitting on.** Where the sea is still
 * the same wave as the one under her, her height above it is her height whatever the sea is
 * doing; treating that stretch as an independent surface lets the arithmetic put her in a
 * trough and raise a crest beneath her at the same instant. That stretch is excluded, and
 * its width is the seaway's OWN correlation length - not its wavelength, which is nine
 * times longer and would throw away real crests the sea does support.
 *
 * The correction is worth about two tenths of a point, because the surface decorrelates in
 * about an eighth of a wave - five metres against a sight line of kilometres. It is here
 * because the case it removes is impossible rather than unlikely, which is a different
 * argument from it being large; the version that used a whole wavelength was worth five
 * times more and was wrong.
 *
 * ## Known biases, in both directions
 *
 * - **Rice runs high.** Level crossings cluster, so counting them independently
 *   over-predicts. Against the Monte Carlo above it reads 69% where the truth is 48%.
 * - **A long-crested sea runs low.** This works along one line. Real seas are short
 *   crested, which decorrelates the surface along it and makes blocking likelier.
 */

import { clearanceMetres, crestOcclusionMetres, type Sightline } from "./horizon.js";
import { exceedanceProbability, type SeaEstimate, type Seaway } from "./seaway.js";

const ALONG_LINE_STEPS = 600;

/** Nodes each way over the target's own rise and fall. Sixteen matches Gauss-Hermite to
 * under a tenth of a percentage point, which is far inside the width of a sea state. */
const HEAVE_NODES = 16;
const HEAVE_LIMIT_SIGMA = 4;

/** How the target sits in the sea, for one of the two bounds. */
interface Ride {
  /** Her own displacement from the mean surface, which tilts the whole sight line. */
  liftMetres: number;
  /**
   * How much of the line nearest her moves with her rather than independently: the seaway's
   * correlation length. Zero for a vessel held rigid at a fixed height above the mean
   * surface, since then nothing does.
   */
  coupledMetres: number;
}

const HELD_RIGID: Ride = { liftMetres: 0, coupledMetres: 0 };

export interface Occlusion {
  /** Held at a fixed height above the mean surface. */
  rigidFraction: number;
  /** Rising and falling with the surface under her. */
  ridingFraction: number;
}

/** The narrowest honest answer: the widest of the bounds the source and the sea allow. */
export interface OcclusionBounds {
  lowestFraction: number;
  highestFraction: number;
  /**
   * Whether the top of that range is a floor rather than a bound.
   *
   * Sea state 9 is "over 14 m" with nothing above it, so the roughest sea the source allows
   * has no height and the pair stops being an interval. Saying so is the difference between
   * a range and a minimum, and a cell that printed the closed one would be making exactly
   * the claim this module exists to stop making.
   */
  highestFractionIsFloor: boolean;
  /** The crest height at which occlusion starts. Geometry alone - no sea assumed. */
  crestThresholdMetres: number;
}

/** How much of the time this target is behind a crest, for one sea. */
export function occludedFraction(sightline: Sightline, seaway: Seaway): Occlusion {
  return {
    rigidFraction: blockedProbability(sightline, seaway, HELD_RIGID),
    ridingFraction: ridingProbability(sightline, seaway),
  };
}

/**
 * Across everything the source leaves open: both ends of the sea state's class, and both
 * ends of the target's response to it.
 *
 * Four numbers reduced to their extremes, because the useful reading is whether a
 * conclusion survives all of them. Where the bounds are far apart the source does not
 * settle the question; where they agree - and at 15 km in this project's reference
 * geometry every plausible sea hides a small vessel constantly - it does.
 *
 * Taking the ends is only a bracket because more sea hides more ship: a taller sea raises
 * the surface's spread faster than the period it comes with lengthens the waves, so the
 * fraction rises with significant height throughout. `test/visibility.spec.ts` holds that,
 * because if it ever stopped being true the interior of a class could sit outside the pair
 * and this function would be quietly reporting the wrong thing.
 */
export function occludedFractionBounds(
  sightline: Sightline,
  estimate: SeaEstimate,
): OcclusionBounds {
  const fractions = [estimate.calm, estimate.rough].flatMap((seaway) => {
    const { rigidFraction, ridingFraction } = occludedFraction(sightline, seaway);
    return [rigidFraction, ridingFraction];
  });
  return {
    lowestFraction: Math.min(...fractions),
    highestFraction: Math.max(...fractions),
    highestFractionIsFloor: estimate.roughEndIsOpen,
    crestThresholdMetres: crestOcclusionMetres(sightline),
  };
}

/**
 * The target riding the sea, averaged over where she is in it.
 *
 * Her own rise lifts the far end of the sight line, so the whole line tilts by her
 * displacement scaled by how far along it she stands. Averaged over a Gaussian
 * displacement by plain quadrature: the integrand is smooth and this is nowhere near the
 * dominant uncertainty.
 */
function ridingProbability(sightline: Sightline, seaway: Seaway): number {
  const sigma = seaway.surfaceStdDevMetres;
  // A flat calm lifts nobody, so the two bounds are the same answer - which is not
  // necessarily zero: the earth still hides whatever is past the horizon.
  if (sigma <= 0) return blockedProbability(sightline, seaway, HELD_RIGID);

  let weighted = 0;
  let weights = 0;
  for (let i = -HEAVE_NODES; i <= HEAVE_NODES; i += 1) {
    const z = (i / HEAVE_NODES) * HEAVE_LIMIT_SIGMA;
    const weight = Math.exp(-(z * z) / 2);
    const ride = { liftMetres: sigma * z, coupledMetres: seaway.correlationLengthMetres };
    weighted += weight * blockedProbability(sightline, seaway, ride);
    weights += weight;
  }
  return weighted / weights;
}

/**
 * The Rice form: one minus the chance of surviving every crossing along the line.
 *
 * The first term is what the crossing rate cannot see. Where the sight line runs BELOW the
 * mean surface - a target already under the horizon - crossings become rare again, because
 * the surface is hardly ever below the level to cross it upward, and the rate alone would
 * report almost nothing where the truth is certainty. Asking the single most exposed point
 * whether it is covered fixes that end without touching the other.
 */
function blockedProbability(sightline: Sightline, seaway: Seaway, ride: Ride): number {
  if (sightline.rangeMetres <= 0) return 0;
  const walk = walkTheLine(sightline, seaway, ride);
  // Every point was inside her own wave: at that range there is no independent sea between.
  if (!walk) return 0;

  const crossings = (walk.crossings * seaway.rmsWavenumberPerMetre) / (2 * Math.PI);
  const alreadyCovered = exceedanceProbability(seaway, walk.lowestClearance);
  return 1 - (1 - alreadyCovered) * Math.exp(-crossings);
}

/**
 * The clearance profile, reduced to the two numbers the Rice form wants.
 *
 * A flat calm falls out of this without a special case, which is the reason it is one
 * function rather than an early return: with no crests there is nothing to cross, so the
 * whole answer is `exceedanceProbability` of the lowest clearance - zero while the sight
 * line stays above the water, and one past the range where the earth alone has taken her.
 * An early return of zero on a still sea would have said she was in sight from beyond the
 * horizon.
 */
function walkTheLine(
  sightline: Sightline,
  seaway: Seaway,
  ride: Ride,
): { crossings: number; lowestClearance: number } | null {
  const sigma = seaway.surfaceStdDevMetres;
  const range = sightline.rangeMetres;
  const step = range / ALONG_LINE_STEPS;
  let crossings = 0;
  let lowestClearance = Infinity;

  for (let i = 0; i <= ALONG_LINE_STEPS; i += 1) {
    const at = i * step;
    // The stretch nearest her is her own wave, not an independent surface. See above.
    if (range - at < ride.coupledMetres) continue;
    const clearance = clearanceMetres(sightline, at) + ride.liftMetres * (at / range);
    lowestClearance = Math.min(lowestClearance, clearance);
    const rate = sigma > 0 ? Math.exp(-(clearance * clearance) / (2 * sigma * sigma)) : 0;
    crossings += (i === 0 || i === ALONG_LINE_STEPS ? 0.5 : 1) * rate * step;
  }
  return lowestClearance === Infinity ? null : { crossings, lowestClearance };
}
