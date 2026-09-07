/**
 * The sea as a set of numbers, and where each of them came from.
 *
 * A report states a sea state, or nothing. Everything a reconstruction wants to know about
 * the sea - how much of the time a low target is behind a crest, how big the biggest wave
 * of the passage was - follows from two figures it never states: a significant height and
 * a period. This module turns what is written down into those two, keeps the width of the
 * class it came out of, and says which parts were assumed.
 *
 * In `core/` and not beside the renderer because the sea is evidence before it is scenery:
 * `visibility.ts` needs it to answer whether a ship could be seen, and that question is
 * asked by the panels today and by a radar view later.
 *
 * ## Significant height is the mean of the highest third, not the height of the waves
 *
 * The single most expensive misreading available here. Individual waves run well above it -
 * the mean of the highest tenth is 1.27 Hs, of the highest hundredth 1.67 Hs - and the
 * largest in a passage grows with its length: about 1.9 Hs over the eighty-seven minutes of
 * this project's reference case. Anything that treats Hs as "the wave height" loses the
 * tail, and the tail is what hides a ship.
 *
 * The surface itself is Gaussian with a standard deviation of Hs/4. That is not an
 * approximation on top of Hs; for a narrow-band linear sea it IS the definition, and it is
 * what makes the level-crossing arithmetic in `visibility.ts` closed-form.
 */

import type { Derivation, Environment } from "./types.js";

const GRAVITY_METRES_PER_SECOND_SQUARED = 9.80665;

/**
 * JONSWAP peak enhancement. 3.3 is the value fitted in the original North Sea campaign and
 * the usual default; 1.0 makes it Pierson-Moskowitz, a fully developed sea.
 *
 * It changes the SHAPE and so the periods, but it cannot change Hs/4: the spectrum is
 * normalised to the significant height rather than to a wind speed. That is the useful
 * separation here - the hidden fraction in `visibility.ts` depends only on the standard
 * deviation, so arguing about gamma cannot move the main figure, only the rate.
 */
const PEAK_ENHANCEMENT = 3.3;

/**
 * Where to stop integrating the high-frequency tail, as a fraction of the peak period.
 *
 * A named constant because it is a real choice, not a detail. The second moment IN
 * WAVENUMBER diverges logarithmically - `k^2 S(w)` falls off as `w^-1` - so the
 * root-mean-square wavenumber, and with it the level-crossing rate, depends on where the
 * tail is cut. Measured: widening the cut from 0.5 Tp to 0.175 Tp, nearly a factor of
 * three, moves one occlusion figure from 76% to 89%. Real, and an order of magnitude
 * smaller than the width of a sea state class, which is the uncertainty that actually
 * governs (a factor of 54 on the same figure).
 *
 * Frequency moments do not diverge, so the zero-crossing period is not affected.
 */
const TAIL_CUTOFF_FRACTION_OF_PEAK = 0.35;

/**
 * Where to stop for the moments that DO converge.
 *
 * Forty times the peak, which is not a choice so much as far enough: the frequency moments
 * are still creeping in at ten, and only here does the zero-crossing period settle on the
 * published ratio for this spectrum. Cutting them at the tail cutoff above - which is only
 * there because the wavenumber moment diverges - would have left the period six per cent
 * long, an implementation detail passing itself off as a property of the sea.
 */
const CONVERGENCE_LIMIT_OVER_PEAK = 40;

const SPECTRUM_STEPS = 4000;

/** Numbers that describe one sea. Everything here is derived; nothing is transcribed. */
export interface Seaway {
  significantHeightMetres: number;
  peakPeriodSeconds: number;
  /** Standard deviation of the surface, Hs/4. */
  surfaceStdDevMetres: number;
  /** Mean interval between upward zero crossings, from the spectrum's frequency moments. */
  zeroCrossingPeriodSeconds: number;
  /**
   * Root-mean-square wavenumber, which sets how often the surface crosses a level in
   * SPACE. See `TAIL_CUTOFF_FRACTION_OF_PEAK`: this one is cutoff-dependent.
   */
  rmsWavenumberPerMetre: number;
  /**
   * Wavelength at the peak, in deep water. The distance over which the sea stops being the
   * same wave, which is what `visibility.ts` needs to know how far from a floating vessel
   * the surface can be treated as moving independently of her.
   */
  peakWavelengthMetres: number;
}

/**
 * What the source allows the sea to have been - a pair, not a figure.
 *
 * A sea state is a class, and a wide one: state 4 spans 1.25 to 2.5 m. Reporting its
 * midpoint would state a precision the source does not have, and the quantity that comes
 * out the other end is exponential in Hs, so the class width alone can move an answer by a
 * factor of fifty. Carrying both ends lets a reader see when a conclusion survives the
 * whole class - which is the finding worth having - and when it does not.
 */
export interface SeaEstimate {
  /** The calm end of what the source allows. */
  calm: Seaway;
  /** The rough end. Equal to `calm` where the source states a height. */
  rough: Seaway;
  source: "stated" | "sea-state";
  derivation: Derivation;
  /** Sea state 9 is "over 14 m": `rough` is then a floor and not a bound. */
  roughEndIsOpen: boolean;
  /** The period was assumed from the height, the source having stated none. */
  periodAssumed: boolean;
}

/**
 * WMO code 3700. The upper bound of state 9 is open; 14 m stands in for it and
 * `roughEndIsOpen` says so rather than letting the number pass as a bound.
 */
export const SEA_STATE_HEIGHT_METRES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 0.1],
  [0.1, 0.5],
  [0.5, 1.25],
  [1.25, 2.5],
  [2.5, 4],
  [4, 6],
  [6, 9],
  [9, 14],
  [14, 14],
];

/**
 * The sea the scenario allows, or null when it says nothing at all.
 *
 * A stated height is used as stated and both ends collapse onto it. A sea state gives the
 * bounds of its class. Nothing gives null, which is the honest answer and not a zero: an
 * unstated sea is not a calm one, and defaulting to flat water is the claim this whole
 * change exists to stop making.
 */
export function seawayFrom(environment: Environment | undefined): SeaEstimate | null {
  const waves = environment?.waves;
  if (waves?.significantHeightMetres !== undefined) {
    const seaway = seawayOf(waves.significantHeightMetres, waves.peakPeriodSeconds);
    return {
      calm: seaway,
      rough: seaway,
      source: "stated",
      derivation: waves.derivation,
      roughEndIsOpen: false,
      periodAssumed: waves.peakPeriodSeconds === undefined,
    };
  }
  return fromSeaState(environment?.seaState);
}

function fromSeaState(seaState: number | null | undefined): SeaEstimate | null {
  if (seaState === null || seaState === undefined) return null;
  const band = SEA_STATE_HEIGHT_METRES[seaState];
  if (!band) return null;
  return {
    calm: seawayOf(band[0], undefined),
    rough: seawayOf(band[1], undefined),
    source: "sea-state",
    // A sea state is somebody's estimate of the sea from its appearance, so the figures it
    // yields were reconstructed from a description rather than recorded.
    derivation: "inferred",
    roughEndIsOpen: seaState === SEA_STATE_HEIGHT_METRES.length - 1,
    periodAssumed: true,
  };
}

/** One sea, from a height and either a stated period or the assumed one. */
export function seawayOf(significantHeightMetres: number, peakPeriodSeconds?: number): Seaway {
  const height = Math.max(significantHeightMetres, 0);
  const period = peakPeriodSeconds ?? assumedPeakPeriodSeconds(height);
  return {
    significantHeightMetres: height,
    peakPeriodSeconds: period,
    surfaceStdDevMetres: height / 4,
    peakWavelengthMetres: (GRAVITY_METRES_PER_SECOND_SQUARED * period * period) / (2 * Math.PI),
    ...periodsAndWavenumber(period),
  };
}

/**
 * A period for a sea whose height is all that is known.
 *
 * The Pierson-Moskowitz relations for a fully developed sea, run backwards: Hs = 0.21 U^2/g
 * and the peak at 0.877 g/U give a period from a height without a wind speed.
 *
 * **It runs long in enclosed water.** A fully developed sea is the longest one that height
 * can belong to; a fetch-limited sea - the Inland Sea, where this project's reference case
 * happened - is steeper, so its real period is shorter and its waves cross a sight line
 * more often. The assumption therefore errs towards saying a target was VISIBLE. State
 * `environment.waves.peakPeriodSeconds` and this is not used.
 */
export function assumedPeakPeriodSeconds(significantHeightMetres: number): number {
  if (significantHeightMetres <= 0) return 1;
  const g = GRAVITY_METRES_PER_SECOND_SQUARED;
  const windSpeed = Math.sqrt((significantHeightMetres * g) / 0.21);
  return (2 * Math.PI * windSpeed) / (0.877 * g);
}

/**
 * One spectral moment, integrated rather than looked up.
 *
 * Shape only: every use of this is a ratio of two moments, so JONSWAP's leading constant
 * cancels and no wind speed is needed. Stepped geometrically because the spectrum spans
 * more than two decades while its peak is a few per cent of the peak frequency wide -
 * evenly spaced points either miss the peak or waste thousands on the tail.
 */
function moment(peakRadiansPerSecond: number, order: number, from: number, to: number): number {
  const ratio = (to / from) ** (1 / SPECTRUM_STEPS);
  let total = 0;
  let w = from;
  for (let i = 0; i <= SPECTRUM_STEPS; i += 1) {
    const ends = i === 0 || i === SPECTRUM_STEPS ? 0.5 : 1;
    // d(omega) = omega * d(ln omega), and ln(ratio) is that constant step.
    total += ends * w ** order * density(w, peakRadiansPerSecond) * w * Math.log(ratio);
    w *= ratio;
  }
  return total;
}

/**
 * The two periods and the wavenumber this module reports, from one spectrum.
 *
 * The zero-crossing period comes off the converged range; the root-mean-square wavenumber
 * off the truncated one, because that is the moment with nowhere to converge to. Both
 * divide by the variance of the SAME range they were taken over, which is what makes the
 * wavenumber the ratio a level-crossing rate actually wants.
 */
function periodsAndWavenumber(peakPeriodSeconds: number): {
  zeroCrossingPeriodSeconds: number;
  rmsWavenumberPerMetre: number;
} {
  const peak = (2 * Math.PI) / peakPeriodSeconds;
  const from = peak / 6;
  const converged = peak * CONVERGENCE_LIMIT_OVER_PEAK;
  const cutoff = peak / TAIL_CUTOFF_FRACTION_OF_PEAK;

  const variance = moment(peak, 0, from, converged);
  const secondMoment = moment(peak, 2, from, converged);
  // k = w^2/g in deep water, so the second moment in k is the fourth in w, over g squared.
  const fourthTruncated = moment(peak, 4, from, cutoff);
  const varianceTruncated = moment(peak, 0, from, cutoff);

  return {
    zeroCrossingPeriodSeconds: 2 * Math.PI * Math.sqrt(variance / secondMoment),
    rmsWavenumberPerMetre:
      Math.sqrt(fourthTruncated / varianceTruncated) / GRAVITY_METRES_PER_SECOND_SQUARED,
  };
}

/** The JONSWAP shape, without its leading constant. */
function density(w: number, peak: number): number {
  const width = w <= peak ? 0.07 : 0.09;
  const peakedness = Math.exp(-((w - peak) ** 2) / (2 * width * width * peak * peak));
  return (Math.exp(-1.25 * (peak / w) ** 4) / w ** 5) * PEAK_ENHANCEMENT ** peakedness;
}

/**
 * The mean of the highest `fraction` of the waves, for a Rayleigh distribution of heights.
 *
 * The definition significant height comes from, so `meanOfHighest(hs, 1/3)` returns hs and
 * anything else measures how far the tail runs past it: a tenth at 1.27, a hundredth at
 * 1.67.
 */
export function meanOfHighest(significantHeightMetres: number, fraction: number): number {
  if (fraction <= 0 || fraction > 1) return NaN;
  const scale = significantHeightMetres / 2;
  const threshold = Math.sqrt(2 * Math.log(1 / fraction));
  const tail = 0.5 * erfc(threshold / Math.SQRT2);
  return scale * (threshold + (Math.sqrt(2 * Math.PI) * tail) / fraction);
}

/**
 * How much of the time the surface stands above a level, at one place.
 *
 * The surface being Gaussian with a standard deviation of Hs/4, this is a closed form and
 * not a simulation. It is a POINT probability: `visibility.ts` needs it for the one place
 * along a sight line most likely to be crossed, and needs much more than it for the rest.
 */
export function exceedanceProbability(seaway: Seaway, levelMetres: number): number {
  const sigma = seaway.surfaceStdDevMetres;
  if (sigma <= 0) return levelMetres < 0 ? 1 : 0;
  return 0.5 * erfc(levelMetres / (sigma * Math.SQRT2));
}

/**
 * The largest single wave expected in a passage of this length.
 *
 * Grows with how long you watch, which is why a scenario's duration belongs in the
 * question. Over the reference case's eighty-seven minutes it is about 1.9 Hs - roughly
 * three times the average wave, and the one that decides whether a low target went out of
 * sight at all.
 */
export function highestExpectedMetres(seaway: Seaway, durationSeconds: number): number {
  const waves = durationSeconds / seaway.zeroCrossingPeriodSeconds;
  if (waves <= 1) return seaway.significantHeightMetres;
  return seaway.significantHeightMetres * Math.sqrt(Math.log(waves) / 2);
}

/**
 * Abramowitz and Stegun 7.1.26, good to 1.5e-7 absolute, which is far past what any figure
 * resting on a sea state class can use.
 */
function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-x * x);
}
