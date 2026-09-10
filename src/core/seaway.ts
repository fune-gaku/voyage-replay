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
 * tail is cut. There is no converged answer to find, only a declared one.
 *
 * **0.12 of the peak period**, which for a 3 m sea is a shortest wave of 1.7 m. Chosen
 * against what the shortfall in slope actually is, measured over this spectrum at Hs 3 m and
 * the period `assumedPeakPeriodSeconds` gives it - 8.65 s, since taking these at any other
 * period describes a sea this tool never draws:
 *
 * | cut | shortest wave | rms slope | k_rms |
 * |---|---|---|---|
 * | 0.35 (was) | 14.3 m | 4.1 deg | x1.00 |
 * | 0.175 | 3.6 m | 5.4 deg | x1.30 |
 * | **0.12** | **1.7 m** | **6.0 deg** | **x1.44** |
 * | 0.05 | 0.29 m | 7.1 deg | x1.72 |
 * | 0.03 | 0.11 m | 7.7 deg | x1.87 |
 *
 * **Cox and Munk's measured slope for the wind that raises a 3 m sea is 14.2 degrees**, and
 * the table says plainly that widening this band cannot reach it: eleven-centimetre waves get
 * to eight. The rest of a real sea's slope is in capillary-gravity ripples, which a JONSWAP
 * gravity spectrum has no business describing and no renderer can draw. So this is cut where
 * the waves stop being drawable rather than where the slope comes right - and what is missing
 * is named on the page instead of being quietly integrated for.
 *
 * **The DRAWN slope used to be lower again** - 5.4 degrees against the band's 6.0 - because
 * equal-energy bins carry each bin's height variance exactly and its slope variance only
 * approximately: one frequency has to stand for a bin over which `k^2` varies, and the widest
 * bin was the whole tail. Placing the components by slope as well as by energy closes it:
 * 6.0 degrees drawn against 5.95 in the band, on the same sea. See
 * `SLOPE_SHARE_OF_COMPONENTS` and issue #50.
 *
 * Frequency moments do not diverge, so the zero-crossing period is not affected.
 */
export const TAIL_CUTOFF_FRACTION_OF_PEAK = 0.12;

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
 * Steps for the correlation integral, which is run twenty times over by the bisection.
 *
 * Coarser than the moments and deliberately so: the moments set the periods and the
 * wavenumber, where the fourth power of frequency makes the tail worth resolving, while the
 * correlation is a smooth cosine transform whose answer is a length wanted to a per cent.
 * At the moments' resolution one `seawayOf` costs 14 ms and a scenario builds several -
 * fifty times more work than the figure justifies. The published ratio it is held against,
 * 0.116 of a wavelength, is unchanged by the coarser grid.
 */
const CORRELATION_INTEGRAL_STEPS = 400;

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

/**
 * And the same for a wind, for the same reason and by the same argument.
 *
 * The schema bounds it; `windFrom` is exported and a caller that has not been through
 * `validateScenario` can reach it. 150 knots is past the strongest surface wind ever
 * recorded - 1996's 113 knots at Barrow Island, and 231 mph in a 1934 gust on Mount
 * Washington, neither of them a sea a ship is under way in.
 *
 * The lesson from the height and the period took two reviews to arrive at and was not
 * applied to this field when it was added, which is the whole of why it is written here
 * next to them rather than somewhere of its own.
 */
export const SPEED_LIMIT_KNOTS = 150;

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
   * Where the peak period came from: the file, the stated wind, backwards out of the
   * height - or nowhere, because a sea of no height has no period to have come from.
   *
   * Not a boolean, because there are four answers and a page has to name which. "none" is
   * the one that matters most: `Seaway` still carries a number there, since its type is a
   * number and the spectrum clamps whatever it is handed, and that number is a fiction.
   * Anything printing a period has to ask this first.
   */
  periodFrom: "stated" | "wind" | "height" | "none";
  /** Likewise for the direction: the file, the stated wind, or a bearing this tool chose. */
  directionFrom: "stated" | "wind" | "assumed";
  /**
   * Why the wind did not supply the period, where it did not.
   *
   * One value rather than a pair of flags, because there turned out to be four answers and
   * a pair collapsed two of them: a stated 150 knots against sea state 9 was reported as
   * "too light", when it raises 16.6 m and the real reason is that the class runs past any
   * height a finite wind can reach. A page that names the wrong refusal is worse than one
   * that names none - it makes a false statement about the reader's own figure.
   */
  periodDeclined:
    "none" | "force-is-a-class" | "wind-too-light" | "sea-has-no-ceiling" | "nothing-stated";
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
/**
 * How one sea state class ends, which is the same question `forceClass` answers about the
 * wind - and for the same reason.
 *
 * State 9 is "over 14 m" and the table's 14 is a floor. Two places knew that separately
 * until the Beaufort scale taught the lesson at its own two odd ends: scattering a special
 * case is how the second one gets missed. One function knows.
 */
export interface SeaStateClass {
  calmestMetres: number;
  /** A floor rather than a ceiling where `topIsOpen`. */
  roughestMetres: number;
  topIsOpen: boolean;
}

export function seaStateClass(seaState: number): SeaStateClass | null {
  const band = SEA_STATE_HEIGHT_METRES[seaState];
  if (!band) return null;
  return {
    calmestMetres: band[0],
    roughestMetres: band[1],
    topIsOpen: seaState === SEA_STATE_HEIGHT_METRES.length - 1,
  };
}

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
  const direction = directionFor(waves, wind);
  // The height first, because whether the wind can supply a period depends on whether it
  // could have raised this sea - and it is the ROUGH end that has to be within reach, since
  // one period is applied to both.
  const roughest = roughestHeightMetres(waves, environment?.seaState);
  const period = periodFor(waves, wind, roughest);

  if (waves?.significantHeightMetres !== undefined) {
    const seaway = seawayOf(waves.significantHeightMetres, period.seconds);
    return {
      calm: seaway,
      rough: seaway,
      source: "stated",
      derivation: waves.derivation,
      roughEndIsOpen: false,
      periodFrom: period.from,
      periodDeclined: period.declined,
      ...direction,
    };
  }
  return fromSeaState(environment?.seaState, period, direction);
}

/**
 * The ROUGHEST sea the file allows, which is what a single derived period has to fit.
 *
 * Not the gentlest, and the difference is the whole of it: one period is worked out and
 * then applied to both ends of the class. Testing the wind against the calm end passes a
 * sea state of 1.25 to 2.5 m at fourteen knots - which raises 1.44 m with the margin - and
 * then labels a 2.5 m sea's period "from the stated wind". At the bottom of the scale it is
 * worse: state 1 runs from nought, so a flat calm clears the test and puts a half-second
 * period on the rough end.
 *
 * `seaExceedsWind` still asks about the calm end, and that is not an inconsistency: it is a
 * WARNING, and a warning should be hard to raise, so it fires only where even the gentlest
 * reading is beyond the wind. This is a DERIVATION, and a derivation has to hold for every
 * sea it will be applied to. Two questions, two ends.
 */
function roughestHeightMetres(
  waves: Environment["waves"],
  seaState: number | null | undefined,
): number {
  if (waves?.significantHeightMetres !== undefined) return waves.significantHeightMetres;
  if (seaState === null || seaState === undefined) return 0;
  const band = seaStateClass(seaState);
  if (!band) return 0;
  // Infinity is not a trick: where the class is open the roughest sea the file allows really
  // is unbounded, and no finite wind can account for it - which is what the caller concludes.
  return band.topIsOpen ? Infinity : band.roughestMetres;
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
 *
 * ## And only where the wind could have raised the sea
 *
 * A stated calm with a stated two-metre swell is a valid file and a common situation - the
 * swell is another system's, running in from somewhere the wind here says nothing about.
 * Taking the period from that wind gives 0.5 seconds, because the clamp catches it, which
 * is a two-metre sea 0.4 m from crest to crest: absurd geometry under a panel reading
 * "from the stated wind".
 *
 * So the wind supplies a period only when it could have raised the sea in the first place.
 * Where it could not, the height route takes over and the page says the height was what it
 * came from.
 *
 * The height asked about is the ROUGHEST the file allows - which for sea state 9 is no
 * height at all, since that class has no ceiling and no finite wind can answer for it. `seaExceedsWind` asks about the calm end instead,
 * and the two are answering different questions: a warning should be hard to raise, and a
 * derivation has to hold everywhere it is used.
 */
function periodFor(
  waves: Environment["waves"],
  wind: WindEstimate | null,
  heightMetres: number,
): {
  seconds: number | undefined;
  from: SeaEstimate["periodFrom"];
  declined: SeaEstimate["periodDeclined"];
} {
  // A file may state a period on a sea of no height, and that is not a contradiction to be
  // swallowed: a decayed swell has a period and a direction and a significant height that
  // rounds to nothing. What the file says comes first, whatever the height.
  if (waves?.peakPeriodSeconds !== undefined) {
    return { seconds: waves.peakPeriodSeconds, from: "stated", declined: "none" };
  }
  // With nothing stated, a sea of no height has no period, and every route into one is a
  // fiction. A flat calm beside a calm wind cleared the "could this wind raise it" test on
  // nought against nought, took the relation's own zero, and had it clamped straight back to
  // the spectrum's floor - so the page read "0.5 s (from the stated wind)" over water with
  // no waves in it. Fixing the relation alone moved the lie one step down; it stops here.
  if (heightMetres <= 0) return { seconds: undefined, from: "none", declined: "none" };
  const declined = whyNotTheWind(wind, heightMetres);
  if (declined === "none" && wind) {
    return { seconds: periodFromWindSeconds(wind.fastestKnots), from: "wind", declined };
  }
  return { seconds: undefined, from: "height", declined };
}

/**
 * Which of the four refusals applies, in the order of how specific each one is.
 *
 * An open-ended sea state comes first even where a force was stated: both are true then, and
 * "no finite wind can cover this class" is the fact that would still hold if the file gave a
 * speed. Reporting the weaker of two true reasons sends a reader to fix the wrong figure.
 */
function whyNotTheWind(
  wind: WindEstimate | null,
  heightMetres: number,
): SeaEstimate["periodDeclined"] {
  if (!Number.isFinite(heightMetres)) return "sea-has-no-ceiling";
  if (!wind || wind.source === "direction-only") return "nothing-stated";
  if (wind.source === "force") return "force-is-a-class";
  return windCouldRaise(wind, heightMetres) ? "none" : "wind-too-light";
}

/**
 * Whether this wind can account for a sea of that height, asked before there is a
 * `SeaEstimate` to ask it of.
 *
 * Only ever reached with a definite speed - a Beaufort force never supplies a period - so
 * there is no open-ended wind to handle here. An open-ended SEA is handled, and by
 * arithmetic rather than a branch: its height comes through as infinity and nothing finite
 * clears it.
 */
function windCouldRaise(wind: WindEstimate, heightMetres: number): boolean {
  return fullyDevelopedHeightMetres(wind.fastestKnots) * WIND_DISAGREEMENT_MARGIN >= heightMetres;
}

function fromSeaState(
  seaState: number | null | undefined,
  period: {
    seconds: number | undefined;
    from: SeaEstimate["periodFrom"];
    declined: SeaEstimate["periodDeclined"];
  },
  direction: { fromDegreesTrue: number | null; directionFrom: SeaEstimate["directionFrom"] },
): SeaEstimate | null {
  if (seaState === null || seaState === undefined) return null;
  const band = seaStateClass(seaState);
  if (!band) return null;
  return {
    calm: seawayOf(band.calmestMetres, period.seconds),
    rough: seawayOf(band.roughestMetres, period.seconds),
    source: "sea-state",
    // A sea state is somebody's estimate of the sea from its appearance, so the figures it
    // yields were reconstructed from a description rather than recorded.
    derivation: "inferred",
    roughEndIsOpen: band.topIsOpen,
    periodFrom: period.from,
    periodDeclined: period.declined,
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
  return weightedMoment(peakRadiansPerSecond, (w) => w ** order, {
    from,
    to,
    steps: SPECTRUM_STEPS,
  });
}

/**
 * The band an integral is taken over and how finely.
 *
 * Named because the three travel together and because `max-params` said so - which is the
 * rule doing its job: the alternative was a fifth loose argument nobody could read at the
 * call site.
 */
interface Band {
  from: number;
  to: number;
  steps: number;
}

/** The same integral with an arbitrary weight, which the correlation needs a cosine for. */
function weightedMoment(
  peakRadiansPerSecond: number,
  weight: (w: number) => number,
  band: Band,
): number {
  const { from, to, steps } = band;
  const ratio = (to / from) ** (1 / steps);
  let total = 0;
  let w = from;
  for (let i = 0; i <= steps; i += 1) {
    const ends = i === 0 || i === steps ? 0.5 : 1;
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
  const band = { from, to, steps: CORRELATION_INTEGRAL_STEPS };
  return weightedMoment(peak, cosine, band) / weightedMoment(peak, () => 1, band);
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
export const DRAWN_COMPONENTS = 40;

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
  const curve = placementCurve(peak);
  const drawn = Array.from({ length: DRAWN_COMPONENTS }, (_, index) => ({
    // Stratified: one sample in each equal share of the placement measure, taken at random
    // WITHIN its share. Even shares would put the frequencies on a grid, which is the loop
    // above; one sample per share is what keeps them spread over the whole band anyway.
    ...frequencyAt(curve, (index + random()) / DRAWN_COMPONENTS),
    directionRadians: travelling + (angles[index] ?? 0),
    phaseRadians: random() * 2 * Math.PI,
  }));

  return normalised(drawn, seaway.surfaceStdDevMetres, peak);
}

/**
 * **How much of the component budget is spent resolving the sea's SLOPE rather than its
 * height**, and why a picture needs both.
 *
 * Placing components by energy alone is the standard way to sample a spectrum and it is
 * right about the water's shape: the alternative - spacing them geometrically across the
 * band - leaves four components holding 79 per cent of the variance and the first four
 * holding none at all, a sea of four sine waves whose two largest beat on a 258-second
 * cycle. It reads as a pulse, which no sea has.
 *
 * **It is wrong about the water's texture, and by an order of magnitude.** Energy is where
 * the swell is; slope is where the chop is, and slope density `k^2 S` falls as `1/omega`,
 * so every octave of the tail carries the same slope and none of them carry any energy.
 * Placing by energy alone therefore puts ONE component below a wavelength of 23 m on a 3 m
 * sea - carrying half the slope by itself - and one sinusoid of one wavelength travelling
 * in one direction is not chop, it is corrugated iron. That is what the picture showed.
 * Issue #50.
 *
 * So the components are placed by a blend of the two, each normalised to unit total first
 * so the fraction means what it says. A half is not a tuning: it is the statement that the
 * two jobs are worth the same, the shape of the swell and the texture on it. Measured on
 * the 3 m reference sea it puts about four components in each octave from 1.7 m up while
 * leaving nineteen around the peak, and no component holds more than five per cent of the
 * variance - well clear of the beating the equal-energy split was introduced to stop.
 */
export const SLOPE_SHARE_OF_COMPONENTS = 0.5;

/** How finely the placement measure is tabulated before it is inverted. */
const PLACEMENT_STEPS = 4000;

/**
 * The curve the components are placed along: what measure to spread them by, tabulated.
 *
 * `density` is the blend, `cumulative` its integral from the bottom of the band. The
 * frequencies are stepped geometrically for the reason `moment` gives - the band spans two
 * decades and the peak is a few per cent of it wide.
 */
interface Placement {
  frequencies: number[];
  density: number[];
  cumulative: number[];
}

function placementCurve(peak: number): Placement {
  const frequencies = bandFrequencies(peak);
  const heights = frequencies.map((w) => density(w, peak));
  // k = w^2/g in deep water, so a slope density is the height density times w^4/g^2.
  const slopes = frequencies.map(
    (w, i) => ((heights[i] ?? 0) * w ** 4) / GRAVITY_METRES_PER_SECOND_SQUARED ** 2,
  );

  const height = unitTotal(frequencies, heights);
  const slope = unitTotal(frequencies, slopes);
  const blend = height.map(
    (share, i) =>
      (1 - SLOPE_SHARE_OF_COMPONENTS) * share + SLOPE_SHARE_OF_COMPONENTS * (slope[i] ?? 0),
  );
  return { frequencies, density: blend, cumulative: runningIntegral(frequencies, blend) };
}

/** The band, stepped geometrically. The same one the truncated moments are taken over. */
function bandFrequencies(peak: number): number[] {
  const lowest = peak / 6;
  // From peak/6 to peak/cutoff, so the span is 6/cutoff - fifty, on this cutoff.
  const ratio = (6 / TAIL_CUTOFF_FRACTION_OF_PEAK) ** (1 / PLACEMENT_STEPS);
  return Array.from({ length: PLACEMENT_STEPS + 1 }, (_, i) => lowest * ratio ** i);
}

/** The same densities, scaled so that each integrates to one over the band. */
function unitTotal(frequencies: number[], values: number[]): number[] {
  const total = runningIntegral(frequencies, values).at(-1) ?? 0;
  return values.map((value) => value / total);
}

function runningIntegral(frequencies: number[], values: number[]): number[] {
  const out = [0];
  for (let i = 0; i < frequencies.length - 1; i += 1) {
    out.push(
      (out[i] ?? 0) + (values[i] ?? 0) * ((frequencies[i + 1] ?? 0) - (frequencies[i] ?? 0)),
    );
  }
  return out;
}

/**
 * The frequency at a given fraction of the placement measure, and how dense the measure is
 * there.
 *
 * **Both, from one search.** The density at the sampled point is what turns the sample back
 * into an amplitude: a component stands for however much of the SPECTRUM its share of the
 * PLACEMENT covers, which is `S(w) / placement(w)`. Looking it up separately would be a
 * second answer to the same question.
 *
 * The comparison is strictly greater rather than "or equal", which is what keeps the density
 * off zero: the bottom of a JONSWAP band underflows to nothing outright - `exp(-1620)` - so a
 * search that could stop on the first step would divide by it.
 */
function frequencyAt(curve: Placement, fraction: number): { sampled: number; placed: number } {
  const target = (curve.cumulative.at(-1) ?? 0) * fraction;
  let at = 0;
  while (at < curve.cumulative.length - 1 && (curve.cumulative[at] ?? 0) <= target) at += 1;
  return { sampled: curve.frequencies[at] ?? 0, placed: curve.density[at - 1] ?? 0 };
}

interface Drawn {
  sampled: number;
  placed: number;
  directionRadians: number;
  phaseRadians: number;
}

/**
 * Amplitudes from the spectrum, then scaled so the whole sum has the variance the
 * significant height demands.
 *
 * **`S / placement` is the whole of what makes the blend safe.** A component's share of the
 * variance has to be what the spectrum says it is, whatever measure decided where to put it;
 * weighting by the spectrum alone would hand the tail's components the peak's amplitudes and
 * draw a sea several times too steep. Written this way the height variance is exactly right
 * for any blend, and the placement only decides how finely each part of the band is resolved.
 *
 * The scaling to sigma is what keeps a truncated band honest besides: the components left
 * out carried some variance, and without it the drawn sea would be flatter than the sea the
 * panels are reasoning about.
 */
function normalised(drawn: Drawn[], sigma: number, peak: number): WaveComponent[] {
  const energies = drawn.map((c) => density(c.sampled, peak) / c.placed);
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
/**
 * What something floating on this sea does with it, component by component.
 *
 * Given so that a body can answer each wave at its own frequency rather than tracing the
 * surface: a buoy follows a long swell and lags a short chop, and her heave and her tilt do
 * it differently. Absent, the surface answers for itself - which is the water, and what the
 * renderer draws.
 */
export interface Riding {
  heave(angularFrequencyPerSecond: number): { gain: number; lagRadians: number };
  tilt(angularFrequencyPerSecond: number): { gain: number; lagRadians: number };
}

export function surfaceAt(
  components: WaveComponent[],
  at: { eastMetres: number; northMetres: number },
  secondsFromStart: number,
  riding?: Riding,
): SurfacePoint {
  const point = { heightMetres: 0, slopeEast: 0, slopeNorth: 0 };
  for (const wave of components) {
    const east = Math.sin(wave.directionRadians);
    const north = Math.cos(wave.directionRadians);
    const along = wave.wavenumberPerMetre * (at.eastMetres * east + at.northMetres * north);
    const phase = along - wave.angularFrequencyPerSecond * secondsFromStart + wave.phaseRadians;

    // **The lag is the point, not just the gain.** Applied to the phase, it lets the heave
    // and the tilt peak at different moments - which is most of what makes a floating body's
    // motion look irregular rather than metronomic, and cannot come out of scaling alone.
    //
    // **Added, not subtracted.** The phase above runs `kx - wt`, so it DECREASES with time:
    // a body that answers late reaches a given phase later, which is a larger phase, not a
    // smaller one. Subtracting draws a resonant buoy a quarter cycle AHEAD of the water -
    // which looks like a buoy moving in a sea and is the motion running backwards.
    const rise = riding?.heave(wave.angularFrequencyPerSecond) ?? FOLLOWS;
    const lean = riding?.tilt(wave.angularFrequencyPerSecond) ?? FOLLOWS;
    point.heightMetres += wave.amplitudeMetres * rise.gain * Math.sin(phase + rise.lagRadians);

    const slope = wave.amplitudeMetres * wave.wavenumberPerMetre * lean.gain;
    point.slopeEast += slope * Math.cos(phase + lean.lagRadians) * east;
    point.slopeNorth += slope * Math.cos(phase + lean.lagRadians) * north;
  }
  return point;
}

/** The water itself: it is exactly where it is, and it is never late. */
const FOLLOWS = { gain: 1, lagRadians: 0 };

/**
 * How far the water at a point has been carried SIDEWAYS, which is what sharpens a crest.
 *
 * **A sum of sinusoids is symmetric and no gravity wave is.** Real crests are sharp and real
 * troughs are long and flat, because the water moves horizontally as well as vertically and
 * that motion bunches it at the crest. The trochoidal (Gerstner) wave is not an embellishment
 * of the linear one: it is an exact solution of the Euler equations for irrotational flow in
 * deep water, and its horizontal part comes out of the same amplitudes and wavenumbers.
 *
 * **The sign is checkable rather than a matter of taste.** The divergence of this field is
 * `-a k sin(phase)`, which is negative at a crest - water converging on it, which is the
 * sharpening. Flip it and crests flatten while troughs deepen, which is a sea upside down and
 * looks very nearly as plausible.
 *
 * **No choppiness factor.** The surface folds over itself once the summed steepness passes
 * one, and measured over this project's own components it is 0.86 whatever the significant
 * height - the seas are self-similar, since the period is assumed from the height. A factor
 * below one would be hedging against something measured not to happen.
 *
 * Nothing floating is carried by this. A moored buoy answers to its mooring, not to the
 * water's orbital motion; what it needs is the height of the drawn surface where it actually
 * sits, which is `parameterUnder`.
 */
export function displacementAt(
  components: WaveComponent[],
  at: { eastMetres: number; northMetres: number },
  secondsFromStart: number,
): { eastMetres: number; northMetres: number } {
  let east = 0;
  let north = 0;
  for (const wave of components) {
    const towardsEast = Math.sin(wave.directionRadians);
    const towardsNorth = Math.cos(wave.directionRadians);
    const along =
      wave.wavenumberPerMetre * (at.eastMetres * towardsEast + at.northMetres * towardsNorth);
    const phase = along - wave.angularFrequencyPerSecond * secondsFromStart + wave.phaseRadians;
    const carried = wave.amplitudeMetres * Math.cos(phase);
    east += carried * towardsEast;
    north += carried * towardsNorth;
  }
  return { eastMetres: east, northMetres: north };
}

/**
 * How many times the search below folds back on itself.
 *
 * It is a fixed point, `p = at - D(p)`, and it converges as fast as the displacement's own
 * gradient is small. The bound is the summed steepness - 0.86 on every sea this spectrum
 * draws, and reached only where every component crests at one point, which is not a sea. The
 * ordinary case is the rms slope, 0.105, which needs two.
 *
 * **Three, measured rather than argued.** Over the forty components actually drawn, on 1600
 * points of open water at each of five sea states from 1 m to 14 m, three folds leave at
 * worst 5 cm between where the water arrives and where it was asked for, and 7 mm of height
 * under whatever floats there - beside a buoy's metre of freeboard. A bound of 0.86 says
 * three folds could leave 64 per cent of the error, and saying so is a statement about a sea
 * nobody draws; `test/seaway.spec.ts` holds the measurement instead. Found reviewing #73.
 */
const INVERSION_STEPS = 3;

/**
 * Which point of the undisplaced sea ends up under this position.
 *
 * **Anything floating needs this and nothing else does.** The waves are a function of a
 * parameter, and once the surface is carried sideways that parameter is no longer where the
 * water ended up - so a buoy asked for "the height here" would be given the height of water
 * up to a metre away. That is #34 and #36 a third time: a buoy riding a sea the picture does
 * not draw is a buoy hovering.
 *
 * `drawnFraction` is how much of the displacement the picture actually applied, which falls
 * to nothing at range as the mesh gives out. Inverting the full displacement where only a
 * tenth was drawn would be as wrong as not inverting at all.
 */
export function parameterUnder(
  components: WaveComponent[],
  at: { eastMetres: number; northMetres: number },
  secondsFromStart: number,
  drawnFraction: number,
): { eastMetres: number; northMetres: number } {
  let point = at;
  for (let step = 0; step < INVERSION_STEPS; step += 1) {
    const carried = displacementAt(components, point, secondsFromStart);
    point = {
      eastMetres: at.eastMetres - drawnFraction * carried.eastMetres,
      northMetres: at.northMetres - drawnFraction * carried.northMetres,
    };
  }
  return point;
}

/**
 * The surface's normal, once it is a parametric surface rather than a height field.
 *
 * **The height gradient stops being the answer the moment the water moves sideways.** A
 * height field's normal is `(-dh/dx, 1, -dh/dz)`; a parametric one's is the cross product of
 * its two tangents, and the tangents carry the horizontal displacement's own derivatives.
 * Keeping the old expression leaves shading that is subtly wrong everywhere and plainly
 * wrong at a sharp crest - which is the one place the displacement exists to improve.
 *
 * `spread` is that displacement's gradient: how much the eastward carry changes eastward and
 * northward, and the northward carry northward. The mixed term is one number rather than two
 * because it has to be - the field is a gradient, so its Jacobian is symmetric.
 *
 * **With no spread this is exactly the old expression**, which is what `test/seaway.spec.ts`
 * holds it to. `render/waves.ts` writes the same thing in the scene's axes, where north is
 * -z, and the two stay in step by eye since no test can compile GLSL.
 */
export function surfaceNormal(
  slope: { east: number; north: number },
  spread: { eastEast: number; eastNorth: number; northNorth: number },
): { east: number; up: number; north: number } {
  // The tangent along the eastward parameter, and the one along the northward parameter.
  const eastwardE = 1 + spread.eastEast;
  const eastwardUp = slope.east;
  const eastwardN = spread.eastNorth;
  const northwardE = spread.eastNorth;
  const northwardUp = slope.north;
  const northwardN = 1 + spread.northNorth;

  // Northward crossed with eastward, in that order, so the normal comes out upwards.
  const east = northwardUp * eastwardN - northwardN * eastwardUp;
  const up = northwardN * eastwardE - northwardE * eastwardN;
  const north = northwardE * eastwardUp - northwardUp * eastwardE;
  const length = Math.hypot(east, up, north) || 1;
  return { east: east / length, up: up / length, north: north / length };
}

/**
 * Beaufort, in knots. WMO's table, and the ranges are the point of it.
 *
 * A force is a class, not a figure - 5 is 17 to 21 knots - so it is kept as one, for the
 * same reason `SEA_STATE_HEIGHT_METRES` is.
 *
 * **Two of the thirteen have an end that is not a number**, and both have been read as one
 * here at some point. Force 12 is 64 knots and UP, so its top is a floor. Force 0 is
 * "less than 1 knot" and not "nought to one", so its top is a limit the class never
 * reaches - one knot is force 1. `forceClass` is the only place that knows either, because
 * scattering the two special cases is how they get missed a fourth time.
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
  /**
   * Where a file states BOTH a speed and a force, whether they are the same wind. Null
   * where it states only one, which is the usual case.
   *
   * The speed is used either way - it is the narrower statement - but a file that says 18
   * knots and force 9 in the same breath has one of them wrong, and dropping the force in
   * silence takes the disagreement out of the reader's hands. Nothing here decides which is
   * right; it only declines to hide that there is a question.
   */
  statedForceAgrees: boolean | null;
  /**
   * The Beaufort force the file gave, whatever the speed came out of.
   *
   * Carried even where a speed overrides it, because a page that reports a disagreement
   * without naming the other side of it has hidden half the input while claiming to expose
   * it. A reader cannot check "these are not the same wind" against a force they are never
   * shown.
   */
  statedForce: number | null;
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
    statedForce: wind.beaufortForce ?? null,
  };
  if (wind.speedKnots !== undefined) {
    const speed = clamp(wind.speedKnots, 0, SPEED_LIMIT_KNOTS);
    return {
      ...stated,
      slowestKnots: speed,
      fastestKnots: speed,
      fastestIsOpen: false,
      source: "speed",
      statedForceAgrees: forceAgrees(speed, wind.beaufortForce),
    };
  }
  return { ...stated, ...speedOfForce(wind.beaufortForce), statedForceAgrees: null };
}

/**
 * Whether a stated speed falls inside a stated force's class. Null where one is missing.
 *
 * Both odd ends matter here. A knot is force 1 and not force 0, so calm's top is exclusive;
 * force 12 has no top at all. Testing every class as a closed interval called one knot calm
 * and quietly dropped the disagreement note that is the point of this comparison.
 */
function forceAgrees(speedKnots: number, force: number | undefined): boolean | null {
  const band = force === undefined ? null : forceClass(force);
  if (!band) return null;
  if (speedKnots < band.slowestKnots) return false;
  if (band.topIsOpen) return true;
  return band.topIsExclusive ? speedKnots < band.fastestKnots : speedKnots <= band.fastestKnots;
}

/** How one Beaufort class ends, which is not the same question at both ends of the scale. */
interface ForceClass {
  slowestKnots: number;
  fastestKnots: number;
  /** Force 12: the top is a floor and the class runs past it. */
  topIsOpen: boolean;
  /** Force 0: the top is a limit the class stops short of, since calm is "less than 1 knot". */
  topIsExclusive: boolean;
}

/** The one place that knows how a force's ends behave. */
export function forceClass(force: number): ForceClass | null {
  const band = BEAUFORT_KNOTS[force];
  if (!band) return null;
  return {
    slowestKnots: band[0],
    fastestKnots: band[1],
    topIsOpen: force === BEAUFORT_KNOTS.length - 1,
    topIsExclusive: force === 0,
  };
}

/** A force is a class, so it comes back as one. No force at all comes back as no speed. */
function speedOfForce(
  force: number | undefined,
): Omit<WindEstimate, "fromDegreesTrue" | "derivation" | "statedForceAgrees" | "statedForce"> {
  const band = force === undefined ? null : forceClass(force);
  if (!band) {
    return { slowestKnots: 0, fastestKnots: 0, fastestIsOpen: false, source: "direction-only" };
  }
  return {
    slowestKnots: band.slowestKnots,
    fastestKnots: band.fastestKnots,
    fastestIsOpen: band.topIsOpen,
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

/**
 * The peak period of that same fully developed sea, taken forwards from the wind.
 *
 * A calm returns nought, which is the relation's own answer and not a period: a calm raises
 * no waves and so has none. It used to return the spectrum's lower clamp instead, half a
 * second, which is a plausible-looking figure for a question with no answer - the same
 * shape of trap that had a calm drawing a two-metre sea 0.4 m from crest to crest. Nothing
 * in the tool asks, because `periodFor` will not take a period from a wind that could not
 * raise the sea; anything that does ask gets something visibly wrong rather than quietly so.
 */
export function periodFromWindSeconds(speedKnots: number): number {
  const speed = Math.max(speedKnots, 0) * METRES_PER_SECOND_PER_KNOT;
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
 *
 * **Both ends are taken the way that makes the flag hard to raise.** The sea's CALM end
 * against the wind's FASTEST: a sea state spans a class, a Beaufort force spans a class, and
 * reporting a disagreement that only exists at one corner of two ranges would be reporting
 * the ranges rather than the sea. Only a sea whose gentlest reading still exceeds the most
 * the wind could raise is worth a reader's attention.
 */
/**
 * The fraction of the surface under whitecaps at this wind.
 *
 * Monahan and O'Muircheartaigh (1980), `W = 3.84e-6 U^3.41` with `U` the wind at 10 m -
 * the fit ocean-colour work still uses, from photographic counts. The power is the whole
 * character of it: 10 knots covers a thousandth of the sea, 18 knots most of a per cent, 34
 * knots six and a half.
 *
 * **This is the one part of a whitecap that is measured.** Where the foam lands is not: a
 * linear sea is a sum of sinusoids and never breaks, and the drawn surface could not reach
 * the slope at which water actually does - 6 degrees rms against a real sea's 14.2, the rest
 * being in ripples the band cannot hold. So the picture takes the AMOUNT from here and the
 * PLACEMENT from the steepest of what it drew, which is the same division the glitter path
 * already makes. See `render/waves.ts`, and issue #66.
 */
export function whitecapFraction(windSpeedMetresPerSecond: number): number {
  return Math.min(3.84e-6 * Math.max(windSpeedMetresPerSecond, 0) ** 3.41, 1);
}

/**
 * How much foam a scenario's sea carries, and which figure the wind for it came out of.
 *
 * Three sources, in the order everything else in this module uses: a stated speed is one
 * number, a stated force is a class and so is the coverage, and a file with neither falls
 * back to the wind that would have raised the sea it does state - which is derived and has
 * to be said to be, never reported as a wind. A file with none of the three has no answer
 * and gets null rather than a calm.
 */
export interface Whitecaps {
  leastFraction: number;
  mostFraction: number;
  /** Where `mostFraction` is a floor rather than a bound, the wind's class being open. */
  mostIsOpen: boolean;
  from: "speed" | "force" | "sea";
}

export function whitecapsFrom(environment: Environment | undefined): Whitecaps | null {
  const wind = windFrom(environment);
  if (wind && wind.source !== "direction-only") {
    return {
      leastFraction: whitecapFraction(wind.slowestKnots * METRES_PER_SECOND_PER_KNOT),
      mostFraction: whitecapFraction(wind.fastestKnots * METRES_PER_SECOND_PER_KNOT),
      mostIsOpen: wind.fastestIsOpen,
      from: wind.source === "speed" ? "speed" : "force",
    };
  }

  const sea = seawayFrom(environment);
  if (!sea) return null;
  const ends = [sea.calm, sea.rough].map((seaway) =>
    whitecapFraction(windRaisingMetresPerSecond(seaway.significantHeightMetres)),
  );
  return {
    leastFraction: ends[0] ?? 0,
    mostFraction: ends[1] ?? 0,
    mostIsOpen: sea.roughEndIsOpen,
    from: "sea",
  };
}

/**
 * Cox and Munk's mean square slope for a clean sea under this wind: `0.003 + 0.00512 U`.
 *
 * Measured from sun glitter photographed off Maui in 1951-52 (Cox and Munk, *Journal of the
 * Optical Society of America* 44 (1954) 838), with `U` the wind at 12.5 m. It is the whole
 * surface's slope, capillary-gravity ripples included - which is why a JONSWAP gravity
 * spectrum cannot reach it however far its band is widened, and why the difference has to be
 * named rather than integrated for.
 *
 * A variance rather than an angle, because that is how slopes add: the drawn surface's own
 * slope and whatever is missing from it combine in quadrature, and only in this form.
 */
export function coxMunkSlopeVariance(windSpeedMetresPerSecond: number): number {
  return 0.003 + 0.00512 * Math.max(windSpeedMetresPerSecond, 0);
}

/**
 * The wind that would have raised a sea this size, from the fully developed relation.
 *
 * `Hs = 0.21 U^2 / g` inverted - the same inversion `assumedPeakPeriodSeconds` makes to get
 * a period, so the two cannot disagree about which wind a sea belongs to. It is not a stated
 * wind and must not be reported as one: a sea drawn from a height belongs to about this
 * wind, and a slope quoted for some other wind would be about a surface nobody is looking at.
 */
export function windRaisingMetresPerSecond(significantHeightMetres: number): number {
  return Math.sqrt(
    (Math.max(significantHeightMetres, 0) * GRAVITY_METRES_PER_SECOND_SQUARED) / 0.21,
  );
}

export function seaExceedsWind(sea: SeaEstimate | null, wind: WindEstimate | null): boolean | null {
  if (!sea || !wind || wind.source === "direction-only") return null;
  if (wind.fastestIsOpen) return null;
  const supported = fullyDevelopedHeightMetres(wind.fastestKnots) * WIND_DISAGREEMENT_MARGIN;
  return sea.calm.significantHeightMetres > supported;
}
