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

/**
 * How much of the surface's shape has to survive for it still to count as the same wave.
 *
 * `visibility.ts` needs a distance over which a floating vessel and the water under her move
 * together, and this is the choice that fixes it: the correlation length is then where the
 * along-line autocorrelation first falls to this. A half is the usual coherence convention -
 * past it the surface is more different from hers than the same.
 *
 * The LENGTH is not a constant, because it comes out of the spectrum. It is a fixed fraction
 * of the peak wavelength - 0.116 of it, whatever the period - which is far shorter than the
 * wavelength itself: `k = w^2/g` squares the spread, so the wavenumber spectrum is much
 * broader than the frequency one and the surface decorrelates within a fraction of a wave.
 */
const SAME_WAVE_CORRELATION = 0.5;

/** Bisection steps for the correlation length. Twenty halvings of a wavelength is millimetres. */
const CORRELATION_STEPS = 20;

/**
 * The band a sea has to lie in for any of this to mean anything.
 *
 * Not taste: the arithmetic stops returning numbers outside it. A significant height of
 * 1e308 m overflows the fully developed period relation to infinity, a period of 1e-300 s
 * overflows the spectrum's own fifth power, and either way every moment comes back NaN and
 * the panel prints "NaN%". Both are finite JSON and both pass the schema's own bounds on
 * sign, so the guard belongs here as well as there - `seawayOf` is exported and a caller
 * that has not been through `validateScenario` can reach it.
 *
 * The values are far outside anything a report will hold. The highest significant height
 * ever measured is 19 m, in the North Atlantic in 2013; swell periods reach the low
 * twenties. A sea beyond these clamps to them and gets an absurd but finite answer, which
 * is a better failure than a blank one.
 *
 * **The schema states the same bounds, and they have to stay the same numbers.** Raise the
 * schema's and leave these and a stated 35 m sea validates, then draws silently at 30 - a
 * picture quietly understating a figure the file gives. `test/seaway.spec.ts` holds the
 * two together, since one of them is JSON and cannot import the other.
 */
export const HEIGHT_LIMIT_METRES = 30;
export const PERIOD_LIMITS_SECONDS = { least: 0.5, most: 30 };

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
  /** Wavelength at the peak, in deep water. */
  peakWavelengthMetres: number;
  /**
   * How far along the surface it stays the same wave: where the autocorrelation first falls
   * to `SAME_WAVE_CORRELATION`.
   *
   * Much shorter than the peak wavelength - about an eighth of it - and that is the point.
   * `visibility.ts` uses it to exclude the stretch where a floating vessel and the water
   * cannot be treated as independent, and using the wavelength there would throw away nine
   * times as much line as the sea's own coherence justifies.
   */
  correlationLengthMetres: number;
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
  /**
   * Where the peak period came from: the file, the stated wind, or backwards out of the
   * height. Not a boolean, because there are three answers and a page has to name which.
   */
  periodFrom: "stated" | "wind" | "height";
  /** Likewise for the direction: the file, the stated wind, or a bearing this tool chose. */
  directionFrom: "stated" | "wind" | "assumed";
  /**
   * Where the sea comes from, or null where the source does not say - which is every sea
   * state, since the class carries no direction at all. Null rather than a default, so that
   * whatever draws it has to decide what to do about not knowing and say what it decided.
   */
  fromDegreesTrue: number | null;
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
  const wind = windFrom(environment);
  const waves = environment?.waves;
  const period = periodFor(waves, wind);
  const direction = directionFor(waves, wind);

  if (waves?.significantHeightMetres !== undefined) {
    const seaway = seawayOf(waves.significantHeightMetres, period.seconds);
    return {
      calm: seaway,
      rough: seaway,
      source: "stated",
      derivation: waves.derivation,
      roughEndIsOpen: false,
      periodFrom: period.from,
      ...direction,
    };
  }
  return fromSeaState(environment?.seaState, period, direction);
}

/**
 * Where the sea runs, in order of how much the source is actually saying.
 *
 * A stated wave direction wins outright: swell runs from wherever its storm was, which is
 * the ordinary case, so the wind does not overrule an observation of the waves themselves.
 * A wind sea runs WITH the wind, and both are stated as the direction they come from, so
 * the bearing carries across unchanged.
 *
 * Adding a wind does not remove the assumption; it puts a step in front of it.
 */
function directionFor(
  waves: Environment["waves"],
  wind: WindEstimate | null,
): { fromDegreesTrue: number | null; directionFrom: SeaEstimate["directionFrom"] } {
  if (waves?.fromDegreesTrue !== undefined) {
    return { fromDegreesTrue: waves.fromDegreesTrue, directionFrom: "stated" };
  }
  if (wind?.fromDegreesTrue !== null && wind?.fromDegreesTrue !== undefined) {
    return { fromDegreesTrue: wind.fromDegreesTrue, directionFrom: "wind" };
  }
  return { fromDegreesTrue: null, directionFrom: "assumed" };
}

/**
 * The peak period, taken from the most direct thing the file offers.
 *
 * A stated period first. Then a stated wind SPEED, which runs Pierson-Moskowitz the way it
 * was derived rather than backwards out of a height. A Beaufort force does not qualify: it
 * is a class, and picking a period from it would mean picking a speed out of the middle of
 * one, which is the invention `SEA_STATE_HEIGHT_METRES` refuses to make about heights.
 *
 * The round trip disappears; **the bias does not**. Both routes assume a fully developed
 * sea, so both run long in enclosed water.
 */
function periodFor(
  waves: Environment["waves"],
  wind: WindEstimate | null,
): { seconds: number | undefined; from: SeaEstimate["periodFrom"] } {
  if (waves?.peakPeriodSeconds !== undefined) {
    return { seconds: waves.peakPeriodSeconds, from: "stated" };
  }
  if (wind?.source === "speed") {
    return { seconds: periodFromWindSeconds(wind.fastestKnots), from: "wind" };
  }
  return { seconds: undefined, from: "height" };
}

function fromSeaState(
  seaState: number | null | undefined,
  period: { seconds: number | undefined; from: SeaEstimate["periodFrom"] },
  direction: { fromDegreesTrue: number | null; directionFrom: SeaEstimate["directionFrom"] },
): SeaEstimate | null {
  if (seaState === null || seaState === undefined) return null;
  const band = SEA_STATE_HEIGHT_METRES[seaState];
  if (!band) return null;
  return {
    calm: seawayOf(band[0], period.seconds),
    rough: seawayOf(band[1], period.seconds),
    source: "sea-state",
    // A sea state is somebody's estimate of the sea from its appearance, so the figures it
    // yields were reconstructed from a description rather than recorded.
    derivation: "inferred",
    roughEndIsOpen: seaState === SEA_STATE_HEIGHT_METRES.length - 1,
    periodFrom: period.from,
    ...direction,
  };
}

/** One sea, from a height and either a stated period or the assumed one. */
export function seawayOf(significantHeightMetres: number, peakPeriodSeconds?: number): Seaway {
  const height = clamp(significantHeightMetres, 0, HEIGHT_LIMIT_METRES);
  const period = clamp(
    peakPeriodSeconds ?? assumedPeakPeriodSeconds(height),
    PERIOD_LIMITS_SECONDS.least,
    PERIOD_LIMITS_SECONDS.most,
  );
  const wavelength = (GRAVITY_METRES_PER_SECOND_SQUARED * period * period) / (2 * Math.PI);
  return {
    significantHeightMetres: height,
    peakPeriodSeconds: period,
    surfaceStdDevMetres: height / 4,
    peakWavelengthMetres: wavelength,
    correlationLengthMetres: correlationLengthOf(period, wavelength),
    ...periodsAndWavenumber(period),
  };
}

/** NaN clamps to the low end rather than through: it is not a height or a period. */
function clamp(value: number, least: number, most: number): number {
  return value > least ? Math.min(value, most) : least;
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
  return weightedMoment(peakRadiansPerSecond, (w) => w ** order, from, to);
}

/** The same integral with an arbitrary weight, which the correlation needs a cosine for. */
function weightedMoment(
  peakRadiansPerSecond: number,
  weight: (w: number) => number,
  from: number,
  to: number,
): number {
  const ratio = (to / from) ** (1 / SPECTRUM_STEPS);
  let total = 0;
  let w = from;
  for (let i = 0; i <= SPECTRUM_STEPS; i += 1) {
    const ends = i === 0 || i === SPECTRUM_STEPS ? 0.5 : 1;
    // d(omega) = omega * d(ln omega), and ln(ratio) is that constant step.
    total += ends * weight(w) * density(w, peakRadiansPerSecond) * w * Math.log(ratio);
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
 * The along-line autocorrelation of the surface at one separation.
 *
 * `int S(w) cos(k(w) d) dw / int S(w) dw`, over the same truncated range the wavenumber
 * moment uses, since it is the same question about the same short waves.
 */
function correlationAt(peakPeriodSeconds: number, separationMetres: number): number {
  const peak = (2 * Math.PI) / peakPeriodSeconds;
  const from = peak / 6;
  const to = peak / TAIL_CUTOFF_FRACTION_OF_PEAK;
  const cosine = (w: number): number =>
    Math.cos(((w * w) / GRAVITY_METRES_PER_SECOND_SQUARED) * separationMetres);
  return weightedMoment(peak, cosine, from, to) / moment(peak, 0, from, to);
}

/**
 * Where the surface stops being the same wave, by bisection.
 *
 * The correlation is not monotone - it goes negative and comes back - so bracketing on
 * `[0, peak wavelength]` is only safe because it never climbs back over the threshold.
 * Measured: past the first crossing it peaks at 0.474 against a threshold of 0.5, and that
 * holds for every period and for peak enhancements from 1 to 7, since the shape is
 * scale-free. Raise `SAME_WAVE_CORRELATION` much above a half and this stops being true.
 */
function correlationLengthOf(peakPeriodSeconds: number, peakWavelengthMetres: number): number {
  let inside = 0;
  let outside = peakWavelengthMetres;
  for (let i = 0; i < CORRELATION_STEPS; i += 1) {
    const middle = (inside + outside) / 2;
    if (correlationAt(peakPeriodSeconds, middle) > SAME_WAVE_CORRELATION) inside = middle;
    else outside = middle;
  }
  return outside;
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

/**
 * How many components a drawn sea is built from.
 *
 * Few enough to evaluate per fragment, many enough not to read as a handful of sine waves.
 *
 * **`render/waves.ts` takes its shader array length from this and must go on doing so.** The
 * amplitudes here are shared out so that ALL of them together have the variance the
 * significant height demands; a shader that carried fewer would drop the remainder silently,
 * and the drawn sea would be flatter than the sea the panels reason about while every number
 * on the page stayed right. That is the one invariant this whole change rests on, undone by
 * a constant.
 *
 * **The band is the same one the moments are taken over, and that is not tidiness.** The
 * root-mean-square wavenumber - what decides how often the surface crosses a sight line in
 * `visibility.ts` - is a property of which waves are in the sea. Draw a narrower band and
 * the picture is a smoother sea than the one the panels are reasoning about: same
 * significant height, fewer crossings, and the two halves of the tool quietly disagree
 * about the same water. Short waves carry little height and most of the slope, which is
 * exactly what makes them cheap to leave out and wrong to.
 */
export const DRAWN_COMPONENTS = 24;

/**
 * Directional spreading: the `s` of the Longuet-Higgins form, `D(theta) ~ cos^2s(theta/2)`,
 * with theta measured from the mean direction over the whole circle.
 *
 * **The half-angle is the whole of the form and not a detail.** Written `cos^2s(theta)`
 * instead - which is a different published spreading function - the same exponent gives a
 * far wider fan: a quarter of the weight still at ninety degrees off the sea's stated
 * direction, so the picture argues with the figure it was given.
 *
 * Six is towards the middle of what has been measured for wind sea near the spectral peak,
 * where the range usually quoted is about five to ten. Real spreading is not one number:
 * it is narrowest at the peak and broadens away from it in both directions, which is not
 * modelled here.
 *
 * A sea drawn from a single direction is corduroy - long parallel crests no wind sea has -
 * and it also makes occlusion far too correlated across bearing, which is why some spread
 * is needed at all.
 */
export const SPREADING_EXPONENT = 6;

/**
 * Which way a sea runs when nothing says.
 *
 * Arbitrary, and that is the problem rather than the solution: a sea state carries no
 * direction at all, so without this every such scenario would still have to be drawn
 * running SOMEWHERE, and a narrow spread makes that somewhere plainly readable off the
 * picture. There is no honest default bearing, only a declared one - `ui/panels.ts` names
 * it beside the sea it was used for, which is the whole of what makes drawing it allowable.
 *
 * What would actually fix it is a wind: a wind sea runs with the wind, reports state wind
 * far more often than they state waves, and `environment` has no field for it yet.
 */
export const ASSUMED_DIRECTION_DEGREES_TRUE = 0;

/** One sinusoid of a drawn sea. Deep water throughout, so `omega^2 = g k`. */
export interface WaveComponent {
  amplitudeMetres: number;
  wavenumberPerMetre: number;
  angularFrequencyPerSecond: number;
  /** Direction of TRAVEL, radians clockwise from north. */
  directionRadians: number;
  phaseRadians: number;
}

/**
 * A sea as a sum of sinusoids, for something that has to draw it.
 *
 * **The randomness is not added; it comes out of doing this properly.** Amplitudes are the
 * spectrum's own - `a = sqrt(2 S dw)` - and only the PHASES are random. The sum is then
 * Gaussian by the central limit theorem, the individual wave heights come out Rayleigh, and
 * the significant height is right by construction. Randomising amplitudes instead puts the
 * variance in twice and Hs stops matching.
 *
 * Two things about how the frequencies are picked:
 *
 * - **Not evenly spaced.** A sum of components on a regular grid repeats exactly, with a
 *   period of `2 pi / dw`: 32 components over a typical band come back round every two
 *   minutes, and the reference case would loop forty times. Sampling within each bin breaks
 *   the commensurability.
 * - **Deterministically.** The generator is seeded from the sea itself, so a scenario opens
 *   with the same sea every time. A reconstruction whose sea is different on every viewing
 *   is not one.
 */
export function waveComponents(
  seaway: Seaway,
  fromDegreesTrue: number = ASSUMED_DIRECTION_DEGREES_TRUE,
): WaveComponent[] {
  if (seaway.significantHeightMetres <= 0) return [];
  const peak = (2 * Math.PI) / seaway.peakPeriodSeconds;
  const random = seededRandom(seaway);
  const travelling = ((fromDegreesTrue + 180) * Math.PI) / 180;

  // The fan of directions is filled evenly and then SHUFFLED. Handing them out in
  // frequency order ties direction to wavelength - long waves from one bearing, short ones
  // from another, in a monotonic sweep - which is a fan rotating with scale, and reads as
  // wrong immediately even though every component is individually correct.
  const angles = shuffled(
    Array.from({ length: DRAWN_COMPONENTS }, (_, i) => spreadAngle((i + 0.5) / DRAWN_COMPONENTS)),
    random,
  );
  const drawn = frequencyBins(peak).map((bin, index) => ({
    ...bin,
    directionRadians: travelling + (angles[index] ?? 0),
    phaseRadians: random() * 2 * Math.PI,
    sampled: bin.from + (bin.to - bin.from) * random(),
  }));

  return normalised(drawn, seaway.surfaceStdDevMetres, peak);
}

/**
 * Bins of EQUAL ENERGY, not of equal width.
 *
 * The obvious version spaces them geometrically across the band and is badly wrong: the
 * band runs from a sixth of the peak frequency to nearly three times it, almost all of the
 * variance sits within a factor of two of the peak, and evenly spread components spend most
 * of themselves on frequencies that carry nothing. Measured on a 3 m sea, that left four
 * components holding 79 per cent of the variance and the first four holding none at all -
 * a sea that is four sine waves, whose two largest beat against each other on a 258-second
 * cycle. It reads as a pulse, which no sea has.
 *
 * Cutting the spectrum into equal shares instead puts every component where there is
 * something to carry, so they come out at much the same amplitude and the sum reads as a
 * continuum. It is also the standard way to sample a spectrum, for this reason.
 */
function frequencyBins(peak: number): { from: number; to: number }[] {
  const lowest = peak / 6;
  const highest = peak / TAIL_CUTOFF_FRACTION_OF_PEAK;
  const steps = 4000;
  const ratio = (highest / lowest) ** (1 / steps);

  const cumulative: { w: number; energy: number }[] = [{ w: lowest, energy: 0 }];
  let running = 0;
  let w = lowest;
  for (let i = 0; i < steps; i += 1) {
    const next = w * ratio;
    running += density(w, peak) * (next - w);
    cumulative.push({ w: next, energy: running });
    w = next;
  }

  const share = running / DRAWN_COMPONENTS;
  const edges = [lowest];
  let at = 0;
  for (let i = 1; i <= DRAWN_COMPONENTS; i += 1) {
    while (at < cumulative.length - 1 && (cumulative[at]?.energy ?? 0) < share * i) at += 1;
    edges.push(cumulative[at]?.w ?? highest);
  }
  return Array.from({ length: DRAWN_COMPONENTS }, (_, i) => ({
    from: edges[i] ?? lowest,
    to: edges[i + 1] ?? highest,
  }));
}

interface Drawn {
  from: number;
  to: number;
  sampled: number;
  directionRadians: number;
  phaseRadians: number;
}

/**
 * Amplitudes from the spectrum, then scaled so the whole sum has the variance the
 * significant height demands. The scaling is what keeps a truncated band honest: the
 * components left out carried some variance, and without it the drawn sea would be flatter
 * than the sea the panels are reasoning about.
 */
function normalised(drawn: Drawn[], sigma: number, peak: number): WaveComponent[] {
  const energies = drawn.map((c) => density(c.sampled, peak) * (c.to - c.from));
  const total = energies.reduce((sum, e) => sum + e, 0);
  return drawn.map((c, i) => {
    const share = (energies[i] ?? 0) / total;
    const amplitude = Math.sqrt(2 * share) * sigma;
    return {
      amplitudeMetres: amplitude,
      wavenumberPerMetre: (c.sampled * c.sampled) / GRAVITY_METRES_PER_SECOND_SQUARED,
      angularFrequencyPerSecond: c.sampled,
      directionRadians: c.directionRadians,
      phaseRadians: c.phaseRadians,
    };
  });
}

/**
 * An offset from the mean direction, by inverting the spreading function's integral
 * numerically over the whole circle.
 *
 * The whole circle rather than a quarter turn each way, because the form already goes to
 * zero at a half turn - `cos^2s(theta/2)` is exactly nought at theta = 180 degrees - so
 * clipping it would only distort what it already handles. It also leaves the published
 * identity for the mean resultant length, `s / (s + 1)`, exactly true of what comes out,
 * which is what `test/seaway.spec.ts` holds this against.
 *
 * Deterministic in the component's index rather than random, so the fan is filled evenly
 * instead of clumping.
 */
function spreadAngle(fraction: number): number {
  const limit = Math.PI;
  const steps = 400;
  let total = 0;
  const weights: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = -limit + (2 * limit * i) / steps;
    const weight = Math.cos(angle / 2) ** (2 * SPREADING_EXPONENT);
    weights.push(weight);
    total += weight;
  }
  let running = 0;
  for (let i = 0; i <= steps; i += 1) {
    running += (weights[i] ?? 0) / total;
    if (running >= fraction) return -limit + (2 * limit * i) / steps;
  }
  return limit;
}

/** Fisher-Yates, on the same seeded generator, so the shuffle is part of the same sea. */
function shuffled(values: number[], random: () => number): number[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/**
 * Mulberry32, seeded from the sea's own figures.
 *
 * Any small generator would do; what matters is that it is here rather than `Math.random`,
 * so the same scenario draws the same sea on every opening and a screenshot taken today can
 * be compared with one taken next year.
 */
function seededRandom(seaway: Seaway): () => number {
  let state = Math.floor(seaway.significantHeightMetres * 1000 + seaway.peakPeriodSeconds * 7919);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The surface at one place and instant: where it is, and which way it is tilted. */
export interface SurfacePoint {
  heightMetres: number;
  /** Rise per metre eastward, and per metre northward. */
  slopeEast: number;
  slopeNorth: number;
}

/**
 * The same sum the water's shader evaluates, on the processor.
 *
 * Anything that floats needs this: a buoy sitting on a sea drawn from one wave field while
 * it rides another is a buoy hovering over the water, and the two fields have to be the
 * same object or the picture contradicts itself - which is the whole argument of #30 and
 * #31, one layer down.
 *
 * Kept beside `waveComponents` rather than in the renderer because it is the sea's own
 * definition, and because whatever eventually answers "how did she move in it" - issue #32
 * - has to be able to ask.
 *
 * The projection is `k (east sin d + north cos d)`, which is the distance along the
 * direction the wave travels. `render/waves.ts` writes the same thing in the scene's axes,
 * where north is -z; the two must stay in step by eye, since no test can compile GLSL.
 */
export function surfaceAt(
  components: WaveComponent[],
  at: { eastMetres: number; northMetres: number },
  secondsFromStart: number,
): SurfacePoint {
  const point = { heightMetres: 0, slopeEast: 0, slopeNorth: 0 };
  for (const wave of components) {
    const east = Math.sin(wave.directionRadians);
    const north = Math.cos(wave.directionRadians);
    const along = wave.wavenumberPerMetre * (at.eastMetres * east + at.northMetres * north);
    const phase = along - wave.angularFrequencyPerSecond * secondsFromStart + wave.phaseRadians;
    point.heightMetres += wave.amplitudeMetres * Math.sin(phase);
    const slope = wave.amplitudeMetres * wave.wavenumberPerMetre * Math.cos(phase);
    point.slopeEast += slope * east;
    point.slopeNorth += slope * north;
  }
  return point;
}

/**
 * Beaufort, in knots. WMO's table, and the ranges are the point of it.
 *
 * A force is a class, not a figure - 5 is 17 to 21 knots - so it is kept as one, for the
 * same reason `SEA_STATE_HEIGHT_METRES` is. Force 12 is open above; `fastestIsOpen` says so
 * rather than letting 64 pass for a bound.
 */
export const BEAUFORT_KNOTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 3],
  [4, 6],
  [7, 10],
  [11, 16],
  [17, 21],
  [22, 27],
  [28, 33],
  [34, 40],
  [41, 47],
  [48, 55],
  [56, 63],
  [64, 64],
];

/**
 * How far a stated sea may exceed what the wind can raise before it is worth reporting.
 *
 * Not a tolerance on the arithmetic but on the relation: the constant in `Hs = 0.21 U^2/g`
 * is a fit with scatter - other fits give up to 0.24 - and a reported wind is a class or a
 * rounded figure. Below this the disagreement says nothing; above it, the sea is either
 * carrying a swell from somewhere else or somebody has mistranscribed.
 */
const WIND_DISAGREEMENT_MARGIN = 1.3;

/** What the file says about the wind, and how tightly it says it. */
export interface WindEstimate {
  slowestKnots: number;
  /** A floor rather than a bound where `fastestIsOpen`. */
  fastestKnots: number;
  fastestIsOpen: boolean;
  /** Where it blows FROM, or null: a report may give a force and no direction. */
  fromDegreesTrue: number | null;
  derivation: Derivation;
  /** Which figure the speed came out of, or that there was none. */
  source: "speed" | "force" | "direction-only";
}

/**
 * The wind the scenario states, or null where it states none.
 *
 * A speed is used as stated. A force gives its class. Both together take the speed, since
 * it is the narrower statement, and no attempt is made to reconcile them - a file that
 * disagrees with itself about the wind is a transcription problem and not this module's.
 */
export function windFrom(environment: Environment | undefined): WindEstimate | null {
  const wind = environment?.wind;
  if (!wind) return null;
  const stated = {
    fromDegreesTrue: wind.fromDegreesTrue ?? null,
    derivation: wind.derivation,
  };
  if (wind.speedKnots !== undefined) {
    return {
      ...stated,
      slowestKnots: wind.speedKnots,
      fastestKnots: wind.speedKnots,
      fastestIsOpen: false,
      source: "speed",
    };
  }
  return { ...stated, ...speedOfForce(wind.beaufortForce) };
}

/** A force is a class, so it comes back as one. No force at all comes back as no speed. */
function speedOfForce(
  force: number | undefined,
): Omit<WindEstimate, "fromDegreesTrue" | "derivation"> {
  const band = force === undefined ? undefined : BEAUFORT_KNOTS[force];
  if (!band) {
    return { slowestKnots: 0, fastestKnots: 0, fastestIsOpen: false, source: "direction-only" };
  }
  return {
    slowestKnots: band[0],
    fastestKnots: band[1],
    fastestIsOpen: force === BEAUFORT_KNOTS.length - 1,
    source: "force",
  };
}

const METRES_PER_SECOND_PER_KNOT = 0.514444;

/**
 * The significant height this wind raises once the sea has stopped growing.
 *
 * Pierson-Moskowitz, `Hs = 0.21 U^2 / g`, and it is an UPPER bound rather than a figure: a
 * fully developed sea needs both fetch and duration, so a sea under a rising wind or in
 * enclosed water is smaller than this. There is no corresponding lower bound, which is what
 * makes the comparison below asymmetric.
 */
export function fullyDevelopedHeightMetres(speedKnots: number): number {
  const speed = speedKnots * METRES_PER_SECOND_PER_KNOT;
  return (0.21 * speed * speed) / GRAVITY_METRES_PER_SECOND_SQUARED;
}

/** The peak period of that same fully developed sea, taken forwards from the wind. */
export function periodFromWindSeconds(speedKnots: number): number {
  const speed = speedKnots * METRES_PER_SECOND_PER_KNOT;
  if (speed <= 0) return PERIOD_LIMITS_SECONDS.least;
  return (2 * Math.PI * speed) / (0.877 * GRAVITY_METRES_PER_SECOND_SQUARED);
}

/**
 * Whether the stated sea is bigger than the stated wind can account for.
 *
 * Only ever reported in that direction. A sea SMALLER than the wind supports is the
 * ordinary case - the wind has not been blowing long enough, or the fetch is short - and
 * flagging it would train a reader to ignore the column, which is the same argument
 * `conditions.ts` makes about comparing a light condition to the sun on one axis only.
 *
 * Null where the two are not comparable: no wind, no speed in it, or no sea.
 */
export function seaExceedsWind(sea: SeaEstimate | null, wind: WindEstimate | null): boolean | null {
  if (!sea || !wind || wind.source === "direction-only") return null;
  if (wind.fastestIsOpen) return null;
  const supported = fullyDevelopedHeightMetres(wind.fastestKnots) * WIND_DISAGREEMENT_MARGIN;
  return sea.calm.significantHeightMetres > supported;
}
