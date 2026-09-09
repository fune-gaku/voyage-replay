import { describe, expect, it } from "vitest";

import schema from "../spec/voyage.schema.json";
import type { Environment } from "../src/core/types.js";
import type { SeaEstimate } from "../src/core/seaway.js";

import {
  assumedPeakPeriodSeconds,
  BEAUFORT_KNOTS,
  forceClass,
  fullyDevelopedHeightMetres,
  periodFromWindSeconds,
  seaExceedsWind,
  windFrom,
  HEIGHT_LIMIT_METRES,
  PERIOD_LIMITS_SECONDS,
  exceedanceProbability,
  highestExpectedMetres,
  meanOfHighest,
  SEA_STATE_HEIGHT_METRES,
  seaStateClass,
  seawayFrom,
  SPEED_LIMIT_KNOTS,
  seawayOf,
  SPREADING_EXPONENT,
  surfaceAt,
  waveComponents,
  whitecapFraction,
  whitecapsFrom,
} from "../src/core/seaway.js";

/**
 * DNV-RP-C205's fit for the ratio of the zero-crossing period to the peak period of a
 * JONSWAP spectrum, as a function of the peak enhancement.
 *
 * Held against the published polynomial rather than against a second integration of the
 * same spectrum: recomputing what the implementation computes agrees with it exactly in the
 * one case worth ruling out. It caught a real fault - integrating the frequency moments
 * only as far as the wavenumber cutoff left the period six per cent long.
 */
function publishedPeriodRatio(peakEnhancement: number): number {
  const g = peakEnhancement;
  return 0.6673 + 0.05037 * g - 0.00623 * g * g + 0.0003341 * g * g * g;
}

describe("significant height and the waves under it", () => {
  /**
   * Very nearly the definition, and the gap is the published one rather than an error:
   * significant height is four times the surface's standard deviation, while the mean of
   * the highest third of a Rayleigh distribution is 4.004 times it. The ratio is 1.0011 for
   * every sea, which is what makes it a check on the arithmetic and not on a number.
   */
  it("is the mean of the highest third, to the 1.0011 the Rayleigh form gives", () => {
    for (const hs of [0.5, 1.25, 2.5, 6]) {
      expect(meanOfHighest(hs, 1 / 3) / hs).toBeCloseTo(1.0011, 4);
    }
  });

  it("runs 1.27 times over for the highest tenth and 1.67 for the highest hundredth", () => {
    expect(meanOfHighest(1, 0.1)).toBeCloseTo(1.271, 2);
    expect(meanOfHighest(1, 0.01)).toBeCloseTo(1.668, 2);
  });

  it("scales the whole distribution with the height", () => {
    expect(meanOfHighest(4, 0.1) / meanOfHighest(2, 0.1)).toBeCloseTo(2, 6);
  });

  it("puts the surface's standard deviation at a quarter of it", () => {
    expect(seawayOf(2).surfaceStdDevMetres).toBeCloseTo(0.5, 9);
    expect(seawayOf(1.25).surfaceStdDevMetres).toBeCloseTo(0.3125, 9);
  });

  /**
   * The largest wave grows with how long you watch: `Hs sqrt(ln N / 2)` over N waves. Over
   * the reference case's eighty-seven minutes that is about 1.9 Hs, three times the average
   * wave, and the reason a fraction quoted off Hs alone loses the case.
   */
  it("expects a wave about 1.9 times over in an eighty-seven minute passage", () => {
    const seaway = seawayOf(2);
    expect(highestExpectedMetres(seaway, 87 * 60) / 2).toBeCloseTo(1.89, 1);
    expect(highestExpectedMetres(seaway, 20 * 60) / 2).toBeLessThan(
      highestExpectedMetres(seaway, 87 * 60) / 2,
    );
  });

  it("puts the surface over the mean half the time and never over an infinite level", () => {
    expect(exceedanceProbability(seawayOf(2), 0)).toBeCloseTo(0.5, 6);
    expect(exceedanceProbability(seawayOf(2), 10)).toBeLessThan(1e-6);
    expect(exceedanceProbability(seawayOf(2), -10)).toBeGreaterThan(1 - 1e-6);
  });

  it("has a flat calm exceed nothing above the mean and everything below it", () => {
    expect(exceedanceProbability(seawayOf(0), 0.1)).toBe(0);
    expect(exceedanceProbability(seawayOf(0), -0.1)).toBe(1);
  });
});

describe("the spectrum behind those numbers", () => {
  it("lands on the published zero-crossing ratio for JONSWAP", () => {
    for (const hs of [1.25, 2, 4]) {
      const seaway = seawayOf(hs);
      const ratio = seaway.zeroCrossingPeriodSeconds / seaway.peakPeriodSeconds;
      expect(ratio).toBeCloseTo(publishedPeriodRatio(3.3), 3);
    }
  });

  it("is scale-free in period: shape ratios do not depend on how long the waves are", () => {
    const short = seawayOf(1, 4);
    const long = seawayOf(1, 8);
    expect(short.zeroCrossingPeriodSeconds / short.peakPeriodSeconds).toBeCloseTo(
      long.zeroCrossingPeriodSeconds / long.peakPeriodSeconds,
      6,
    );
    // Wavenumber goes as the square of frequency, so halving the period quadruples it.
    expect(short.rmsWavenumberPerMetre / long.rmsWavenumberPerMetre).toBeCloseTo(4, 2);
  });

  /**
   * Pierson-Moskowitz for a fully developed sea, run backwards from the height. The check
   * is the shape of the relation - period goes as the square root of height - plus one
   * absolute value, since the constants 0.21 and 0.877 are the published ones.
   */
  it("assumes a fully developed period that goes as the root of the height", () => {
    expect(assumedPeakPeriodSeconds(2.5)).toBeCloseTo(7.89, 1);
    expect(assumedPeakPeriodSeconds(4) / assumedPeakPeriodSeconds(1)).toBeCloseTo(2, 3);
  });

  it("uses a stated period in preference to the assumed one", () => {
    expect(seawayOf(2, 5.5).peakPeriodSeconds).toBe(5.5);
    expect(seawayOf(2).peakPeriodSeconds).not.toBeCloseTo(5.5, 1);
  });
});

describe("what the file allows the sea to have been", () => {
  it("uses WMO 3700's classes, so state 4 is 1.25 to 2.5 metres", () => {
    expect(SEA_STATE_HEIGHT_METRES[3]).toEqual([0.5, 1.25]);
    expect(SEA_STATE_HEIGHT_METRES[4]).toEqual([1.25, 2.5]);
    expect(SEA_STATE_HEIGHT_METRES[6]).toEqual([4, 6]);
  });

  it("spreads a sea state over its whole class rather than taking a midpoint", () => {
    const estimate = seawayFrom({ seaState: 4 });
    expect(estimate?.calm.significantHeightMetres).toBe(1.25);
    expect(estimate?.rough.significantHeightMetres).toBe(2.5);
    expect(estimate?.source).toBe("sea-state");
    expect(estimate?.derivation).toBe("inferred");
    expect(estimate?.periodFrom).toBe("height");
  });

  it("collapses both ends onto a stated height and keeps its derivation", () => {
    const estimate = seawayFrom({
      waves: { significantHeightMetres: 1.8, peakPeriodSeconds: 5, derivation: "measured" },
    });
    expect(estimate?.calm.significantHeightMetres).toBe(1.8);
    expect(estimate?.rough.significantHeightMetres).toBe(1.8);
    expect(estimate?.source).toBe("stated");
    expect(estimate?.derivation).toBe("measured");
    expect(estimate?.periodFrom).toBe("stated");
  });

  it("prefers a stated height over the sea state when the file carries both", () => {
    const estimate = seawayFrom({
      seaState: 6,
      waves: { significantHeightMetres: 1.8, derivation: "digitised" },
    });
    expect(estimate?.rough.significantHeightMetres).toBe(1.8);
  });

  /**
   * The distinction the whole change exists for: silence is not calm water. A null forces
   * every consumer to decide what to do about not knowing, where a zero would pass for a
   * measurement of a flat sea.
   */
  it("returns null for a file that says nothing, rather than a flat sea", () => {
    expect(seawayFrom(undefined)).toBeNull();
    expect(seawayFrom({})).toBeNull();
    expect(seawayFrom({ seaState: null })).toBeNull();
    expect(seawayFrom({ lightCondition: "night", visibilityMetres: null })).toBeNull();
  });

  it("marks state 9 as open above, since WMO gives it no upper bound", () => {
    expect(seawayFrom({ seaState: 9 })?.roughEndIsOpen).toBe(true);
    expect(seawayFrom({ seaState: 8 })?.roughEndIsOpen).toBe(false);
  });

  it("has no sea at all in state 0", () => {
    const estimate = seawayFrom({ seaState: 0 });
    expect(estimate?.rough.significantHeightMetres).toBe(0);
    expect(estimate?.rough.surfaceStdDevMetres).toBe(0);
  });
});

describe("how far away the sea stops being the same wave", () => {
  /**
   * Deep-water wavelength, `g T^2 / 2 pi`, which `visibility.ts` uses to decide how much of
   * a sight line moves with a floating target rather than independently of her. Held
   * against the published coefficient of 1.56 rather than against a second copy of the
   * formula.
   */
  it("puts the peak wavelength at 1.56 times the square of the period", () => {
    for (const period of [4, 6, 10]) {
      expect(seawayOf(1, period).peakWavelengthMetres / (period * period)).toBeCloseTo(1.56, 2);
    }
    expect(seawayOf(1, 6).peakWavelengthMetres).toBeCloseTo(56.2, 1);
    expect(seawayOf(1, 10).peakWavelengthMetres).toBeCloseTo(156.1, 1);
  });

  it("goes as the square of the period, so twice the period is four times the length", () => {
    expect(seawayOf(1, 12).peakWavelengthMetres / seawayOf(1, 6).peakWavelengthMetres).toBeCloseTo(
      4,
      6,
    );
  });
});

describe("how far the surface stays the same wave", () => {
  /**
   * Much shorter than the wavelength, and that is the physics rather than a tuning choice:
   * `k = w^2/g` squares the spread of the spectrum, so the wavenumber content is far broader
   * than the frequency content and the surface decorrelates within a fraction of a wave. The
   * ratio is what matters, since `visibility.ts` excludes this stretch and using a wavelength
   * instead would throw away nine times as much sight line.
   */
  it("decorrelates within about an eighth of a wavelength, not within one", () => {
    const seaway = seawayOf(2, 5.5);
    expect(seaway.correlationLengthMetres / seaway.peakWavelengthMetres).toBeCloseTo(0.116, 2);
    expect(seaway.correlationLengthMetres).toBeLessThan(seaway.peakWavelengthMetres / 5);
  });

  /**
   * The spectrum's shape does not depend on how long its waves are, so neither does this
   * ratio. A correlation length that drifted with period would mean the shape integrals were
   * picking up the scale from somewhere they should not.
   */
  it("keeps that ratio whatever the period, because the shape is scale-free", () => {
    const ratios = [3.5, 5.5, 10].map((period) => {
      const seaway = seawayOf(1, period);
      return seaway.correlationLengthMetres / seaway.peakWavelengthMetres;
    });
    for (const ratio of ratios) {
      expect(ratio).toBeCloseTo(ratios[0] ?? 0, 4);
    }
  });

  it("grows with the waves in absolute terms, as the square of the period", () => {
    expect(
      seawayOf(1, 12).correlationLengthMetres / seawayOf(1, 6).correlationLengthMetres,
    ).toBeCloseTo(4, 2);
  });
});

describe("seas the schema allows but the arithmetic cannot carry", () => {
  /**
   * `significantHeightMetres` had no upper bound and `peakPeriodSeconds` only had to be
   * positive, so a finite, schema-valid 1e308 m or 1e-300 s overflowed the fully developed
   * period relation and the spectrum's own fifth power, and every moment came back NaN. That
   * reached the panel as "NaN%". The test asks only that the answers are finite and ordered -
   * comparing against a second implementation would agree with the first when both are wrong.
   */
  it("returns finite figures for heights and periods far past anything real", () => {
    const absurd = [
      seawayOf(1e308),
      seawayOf(1e6),
      seawayOf(2, 1e-300),
      seawayOf(2, 1e12),
      seawayOf(Number.MAX_VALUE, Number.MIN_VALUE),
    ];
    for (const seaway of absurd) {
      for (const value of Object.values(seaway)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(seaway.peakPeriodSeconds).toBeGreaterThan(0);
      expect(seaway.correlationLengthMetres).toBeGreaterThan(0);
      expect(seaway.correlationLengthMetres).toBeLessThan(seaway.peakWavelengthMetres);
    }
  });

  it("clamps rather than rejecting, so an absurd sea gets an absurd but usable answer", () => {
    expect(seawayOf(1e308).significantHeightMetres).toBe(30);
    expect(seawayOf(-5).significantHeightMetres).toBe(0);
    expect(seawayOf(2, 1e-300).peakPeriodSeconds).toBe(0.5);
    expect(seawayOf(2, 1e12).peakPeriodSeconds).toBe(30);
  });

  it("treats a NaN height or period as no sea rather than passing it on", () => {
    expect(seawayOf(NaN).significantHeightMetres).toBe(0);
    expect(Number.isFinite(seawayOf(2, NaN).peakPeriodSeconds)).toBe(true);
  });
});

describe("a sea broken into sinusoids, for something that has to draw it", () => {
  /**
   * The invariant the whole design rests on: the drawn sea and the analysed sea are the
   * same water. Amplitudes come from the spectrum and only the PHASES are random, so the
   * sum's variance is the significant height's, the wave heights come out Rayleigh, and
   * nothing has to be tuned to make the picture agree with the panels.
   */
  it("has the variance the significant height demands, and not one put in twice", () => {
    for (const hs of [1, 3, 6]) {
      const seaway = seawayOf(hs);
      const variance = waveComponents(seaway).reduce(
        (total, c) => total + c.amplitudeMetres ** 2 / 2,
        0,
      );
      expect(Math.sqrt(variance)).toBeCloseTo(seaway.surfaceStdDevMetres, 6);
      expect(Math.sqrt(variance)).toBeCloseTo(hs / 4, 6);
    }
  });

  /**
   * **The band has to be populated, not merely declared.** Placing components by energy
   * alone put ONE below a wavelength of 23 m on a 3 m sea - the tail holds half the slope
   * and almost none of the height, so equal shares of the energy never go there - and one
   * sinusoid of one wavelength travelling in one direction is not chop, it is corrugated
   * iron. That is what the picture showed from a low viewpoint. Issue #50.
   */
  it("puts components in every octave of the band, not only where the energy is", () => {
    const lengths = waveComponents(seawayOf(3)).map((c) => (2 * Math.PI) / c.wavenumberPerMetre);
    const octaves = [
      [1.7, 4],
      [4, 8],
      [8, 16],
      [16, 32],
      [32, 64],
    ];
    for (const [from, to] of octaves) {
      const inside = lengths.filter((l) => l >= (from ?? 0) && l < (to ?? 0));
      expect(inside.length, `${from}-${to} m`).toBeGreaterThanOrEqual(2);
    }
    expect(Math.min(...lengths), "and it reaches the bottom of the band").toBeLessThan(3);
  });

  /**
   * **The strongest check there is on where the components sit**, because the two sides are
   * computed by different routes: the drawn slope is summed over the components, and the
   * band's is a ratio of spectral moments integrated over the same range. Equal-energy
   * placement fell ten per cent short of it at Hs 3 and overshot at Hs 2 - one frequency
   * standing for a bin over which `k^2` varies by a large factor is a poor estimator, in
   * whichever direction the sample happens to land.
   */
  it("draws a sea whose slope is the band's, not one flattened by where the samples fell", () => {
    for (const hs of [1, 2, 3, 6]) {
      const seaway = seawayOf(hs);
      const drawn = Math.sqrt(
        waveComponents(seaway).reduce(
          (total, c) => total + (c.amplitudeMetres * c.wavenumberPerMetre) ** 2 / 2,
          0,
        ),
      );
      const band = seaway.rmsWavenumberPerMetre * seaway.surfaceStdDevMetres;
      expect(drawn / band, `${hs} m`).toBeGreaterThan(0.95);
      expect(drawn / band, `${hs} m`).toBeLessThan(1.05);
    }
  });

  /**
   * **Both ends of the same rule.** No component may be so small that it costs a sine per
   * vertex and draws nothing - the lowest bin used to produce one on every sea, sampled
   * uniformly inside a range starting where a JONSWAP spectrum holds nothing at all - and
   * none may be so large that it beats audibly against its neighbour, which is what spacing
   * components geometrically across the band does.
   */
  it("wastes no component at one end and lets none dominate at the other", () => {
    for (const hs of [1, 3, 6]) {
      const seaway = seawayOf(hs);
      const components = waveComponents(seaway);
      const shares = components.map(
        (c) => c.amplitudeMetres ** 2 / 2 / seaway.surfaceStdDevMetres ** 2,
      );
      expect(Math.min(...shares), `${hs} m`).toBeGreaterThan(0);
      expect(Math.max(...shares), `${hs} m`).toBeLessThan(0.1);
    }
  });

  it("obeys the deep-water relation, so each component's speed follows its length", () => {
    for (const component of waveComponents(seawayOf(3))) {
      const gravity = component.angularFrequencyPerSecond ** 2 / component.wavenumberPerMetre;
      expect(gravity).toBeCloseTo(9.80665, 4);
    }
  });

  /**
   * Evenly spaced components repeat exactly, with a period of `2 pi / dw`: a typical band
   * in 32 pieces comes back round every couple of minutes, and this project's reference
   * case would loop forty times. Sampling inside each bin breaks the commensurability.
   */
  it("does not put its frequencies on a regular grid, which would make the sea loop", () => {
    const frequencies = waveComponents(seawayOf(3))
      .map((c) => c.angularFrequencyPerSecond)
      .sort((a, b) => a - b);
    const gaps = frequencies.slice(1).map((w, i) => w - (frequencies[i] ?? 0));
    const ratios = gaps.map((gap) => gap / (gaps[0] ?? 1));
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeGreaterThan(1.5);
  });

  /**
   * A single direction draws corduroy - long unbroken crests no wind sea has - and makes
   * occlusion far too correlated across bearing.
   */
  it("spreads across directions about the one the sea comes from", () => {
    const from = 90;
    const components = waveComponents(seawayOf(3), from);
    const travelling = components.map((c) => (c.directionRadians * 180) / Math.PI);
    const mean = travelling.reduce((t, d) => t + d, 0) / travelling.length;

    // The waves travel towards the reciprocal of where they come from.
    expect(mean).toBeCloseTo(from + 180, 0);
    expect(Math.max(...travelling) - Math.min(...travelling)).toBeGreaterThan(60);
  });

  /**
   * How wide that fan is, against the published identity rather than against a second copy
   * of the formula: for the Longuet-Higgins form `cos^2s(theta/2)`, the mean resultant
   * length of the directions is exactly `s / (s + 1)`.
   *
   * It is worth pinning because the same exponent on the wrong form - `cos^2s(theta)`,
   * which is also a published spreading function - leaves a quarter of the weight ninety
   * degrees off the sea's stated direction, and the picture then argues with the figure it
   * was handed. Every component stays individually correct while it does.
   */
  it("has the directional spread the Longuet-Higgins form gives for its exponent", () => {
    const from = 290;
    const mean = ((from + 180) * Math.PI) / 180;
    const components = waveComponents(seawayOf(3), from);

    let east = 0;
    let north = 0;
    for (const component of components) {
      east += Math.cos(component.directionRadians - mean);
      north += Math.sin(component.directionRadians - mean);
    }
    const resultant = Math.hypot(east, north) / components.length;
    expect(resultant).toBeCloseTo(SPREADING_EXPONENT / (SPREADING_EXPONENT + 1), 2);

    // Narrow enough to still be a sea from one direction, wide enough not to be corduroy.
    expect(resultant).toBeGreaterThan(0.5);
    expect(resultant).toBeLessThan(0.95);
  });

  /**
   * A reconstruction whose sea is different on every viewing is not one: a screenshot taken
   * today has to be comparable with one taken next year.
   */
  it("draws the same sea every time the same scenario is opened", () => {
    const first = waveComponents(seawayOf(3), 290);
    const second = waveComponents(seawayOf(3), 290);
    expect(second).toEqual(first);
  });

  it("gives different seas different phases rather than one sea moved about", () => {
    const calm = waveComponents(seawayOf(1)).map((c) => c.phaseRadians);
    const rough = waveComponents(seawayOf(4)).map((c) => c.phaseRadians);
    expect(rough).not.toEqual(calm);
  });

  it("has nothing to draw in a flat calm", () => {
    expect(waveComponents(seawayOf(0))).toEqual([]);
  });
});

describe("the surface at a place and an instant", () => {
  const sea = () => waveComponents(seawayOf(3, 8), 290);
  const at = (east: number, north: number) => ({ eastMetres: east, northMetres: north });

  /**
   * The check that catches a sign error anywhere in the projection: the whole pattern is
   * carried along the direction of travel at the phase speed, which in deep water is
   * `g / omega`. Comparing against the same formula written twice would agree with itself;
   * this compares the sea at one instant with the sea at another.
   */
  it("carries a single wave along at the deep-water phase speed", () => {
    const [wave] = waveComponents(seawayOf(3, 8), 0);
    if (!wave) throw new Error("a 3 m sea should have components");
    const one = [wave];
    const speed = 9.80665 / wave.angularFrequencyPerSecond;
    const seconds = 3;
    const travelled = speed * seconds;
    const east = travelled * Math.sin(wave.directionRadians);
    const north = travelled * Math.cos(wave.directionRadians);

    for (const [e, n] of [
      [0, 0],
      [37, -11],
      [-64, 25],
    ]) {
      const before = surfaceAt(one, at(e ?? 0, n ?? 0), 0);
      const after = surfaceAt(one, at((e ?? 0) + east, (n ?? 0) + north), seconds);
      expect(after.heightMetres).toBeCloseTo(before.heightMetres, 6);
    }
  });

  /**
   * The slope has to be the surface's own derivative or a buoy leans the wrong way while
   * every individual number stays plausible.
   */
  it("has a slope that is the height's gradient, in both directions", () => {
    const components = sea();
    // **A centred difference over a millimetre**, and both parts of that matter now the band
    // reaches down to metre waves: a one-sided difference is first-order and a step of five
    // centimetres is a twentieth of the shortest wave in the sea, which is exactly where a
    // finite difference stops being the derivative it is standing in for.
    const step = 0.001;
    const height = (east: number, north: number): number =>
      surfaceAt(components, at(east, north), 12).heightMetres;

    const places: [number, number][] = [
      [0, 0],
      [120, -80],
      [-45, 210],
    ];
    for (const [east, north] of places) {
      const here = surfaceAt(components, at(east, north), 12);
      const eastward = (height(east + step, north) - height(east - step, north)) / (2 * step);
      const northward = (height(east, north + step) - height(east, north - step)) / (2 * step);
      expect(here.slopeEast).toBeCloseTo(eastward, 4);
      expect(here.slopeNorth).toBeCloseTo(northward, 4);
    }
  });

  /**
   * The sea the panels reason about is Gaussian with a standard deviation of Hs/4. So is
   * the sea that gets drawn, or the picture and the judgement are different water.
   */
  it("has the standard deviation the significant height demands, over the whole field", () => {
    const components = sea();
    let total = 0;
    let squares = 0;
    let count = 0;
    for (let i = 0; i < 60; i += 1) {
      for (let j = 0; j < 60; j += 1) {
        const h = surfaceAt(components, at(i * 13.7, j * 11.3), i * 0.7).heightMetres;
        total += h;
        squares += h * h;
        count += 1;
      }
    }
    const mean = total / count;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(squares / count - mean * mean)).toBeCloseTo(3 / 4, 1);
  });

  it("is flat where there is no sea", () => {
    expect(surfaceAt([], at(10, 20), 5)).toEqual({
      heightMetres: 0,
      slopeEast: 0,
      slopeNorth: 0,
    });
  });
});

describe("which way the sea runs", () => {
  /**
   * A sea state is a description of the water's appearance and carries no bearing at all.
   * Null rather than a default, so whatever draws it has to decide what to do about not
   * knowing - and say what it decided. The renderer draws a narrow-spread sea a reader can
   * take a bearing off, so an undeclared direction is the picture asserting a figure the
   * file does not contain.
   */
  it("has no direction at all from a sea state", () => {
    expect(seawayFrom({ seaState: 4 })?.fromDegreesTrue).toBeNull();
    expect(seawayFrom({ seaState: 0 })?.fromDegreesTrue).toBeNull();
  });

  it("carries a stated direction through, including due north", () => {
    const stated = (fromDegreesTrue: number): number | null | undefined =>
      seawayFrom({
        waves: { significantHeightMetres: 2, fromDegreesTrue, derivation: "measured" },
      })?.fromDegreesTrue;
    expect(stated(290)).toBe(290);
    expect(stated(0)).toBe(0);
  });

  it("is null where a height is stated without one, rather than quietly north", () => {
    const estimate = seawayFrom({
      waves: { significantHeightMetres: 2, derivation: "inferred" },
    });
    expect(estimate?.fromDegreesTrue).toBeNull();
  });
});

describe("the bounds the schema states and the ones the arithmetic enforces", () => {
  /**
   * Two copies of the same numbers, in JSON and in TypeScript, and neither can import the
   * other. Left to drift they disagree in the direction that matters: raise the schema's
   * ceiling alone and a stated 35 m sea validates and is then drawn at 30, the picture
   * quietly understating a figure the file gives - which is this project's whole subject,
   * arriving through a bound nobody thought of as a claim.
   */
  it("bounds the wave height the same in both", () => {
    const waves = schema.properties.environment.properties.waves.properties;
    expect(waves.significantHeightMetres.maximum).toBe(HEIGHT_LIMIT_METRES);
    expect(waves.significantHeightMetres.minimum).toBe(0);
  });

  it("bounds the period the same in both", () => {
    const waves = schema.properties.environment.properties.waves.properties;
    expect(waves.peakPeriodSeconds.minimum).toBe(PERIOD_LIMITS_SECONDS.least);
    expect(waves.peakPeriodSeconds.maximum).toBe(PERIOD_LIMITS_SECONDS.most);
  });

  it("clamps to exactly the bound the schema names, not to something near it", () => {
    expect(seawayOf(HEIGHT_LIMIT_METRES * 10).significantHeightMetres).toBe(HEIGHT_LIMIT_METRES);
    expect(seawayOf(2, PERIOD_LIMITS_SECONDS.most * 10).peakPeriodSeconds).toBe(
      PERIOD_LIMITS_SECONDS.most,
    );
    expect(seawayOf(2, PERIOD_LIMITS_SECONDS.least / 10).peakPeriodSeconds).toBe(
      PERIOD_LIMITS_SECONDS.least,
    );
  });
});

describe("the wind, which is the figure a deck log always has", () => {
  const windy = (wind: Record<string, unknown>): Environment => ({
    wind: { derivation: "measured", ...wind },
  });

  it("uses WMO's Beaufort ranges, and keeps them as ranges", () => {
    expect(BEAUFORT_KNOTS).toHaveLength(13);
    expect(BEAUFORT_KNOTS[4]).toEqual([11, 16]);
    expect(BEAUFORT_KNOTS[5]).toEqual([17, 21]);
    expect(BEAUFORT_KNOTS[8]).toEqual([34, 40]);

    // Contiguous and rising from force 1 up: each class starts one knot above the last
    // one's top. The 0-to-1 boundary is not a gap but an exclusive end - calm is "under one
    // knot" and force 1 is "one to three" - and `forceClass` is what carries that, so the
    // table is left as WMO writes it.
    for (let force = 2; force < BEAUFORT_KNOTS.length - 1; force += 1) {
      const previous = BEAUFORT_KNOTS[force - 1];
      const here = BEAUFORT_KNOTS[force];
      if (!previous || !here) throw new Error("the scale runs 0 to 12");
      expect(here[0]).toBe(previous[1] + 1);
      expect(here[1]).toBeGreaterThan(here[0]);
    }
  });

  /**
   * The two routes to a period are the same relation run in opposite directions - forwards
   * from a wind, or backwards out of the height that wind would raise - so they have to
   * land on the same answer. If they ever stop agreeing, one of the constants has drifted
   * and the sea drawn from a stated wind is a different sea from the one drawn without.
   */
  it("gets the same period whichever way Pierson-Moskowitz is run", () => {
    for (const knots of [8, 15, 22, 35]) {
      const forwards = periodFromWindSeconds(knots);
      const backwards = assumedPeakPeriodSeconds(fullyDevelopedHeightMetres(knots));
      expect(forwards).toBeCloseTo(backwards, 9);
    }
  });

  it("raises a fully developed sea as the square of the wind", () => {
    expect(fullyDevelopedHeightMetres(20) / fullyDevelopedHeightMetres(10)).toBeCloseTo(4, 6);
    // 0.21 U^2 / g, at 20 kn: a shade over two and a half metres.
    expect(fullyDevelopedHeightMetres(20)).toBeCloseTo(2.27, 1);
    expect(fullyDevelopedHeightMetres(0)).toBe(0);
  });

  it("takes a stated speed as stated, and a force as its whole class", () => {
    expect(windFrom(windy({ speedKnots: 18 }))).toMatchObject({
      slowestKnots: 18,
      fastestKnots: 18,
      source: "speed",
    });
    expect(windFrom(windy({ beaufortForce: 5 }))).toMatchObject({
      slowestKnots: 17,
      fastestKnots: 21,
      source: "force",
    });
  });

  /**
   * The speed is used - it is the narrower statement - but eighteen knots and force 9 in one
   * file means one of them is wrong, and dropping the force in silence takes that out of the
   * reader's hands. This test used to fix the silence in place.
   */
  it("prefers the speed where a file gives both, and says when the two disagree", () => {
    const disagreeing = windFrom(windy({ speedKnots: 18, beaufortForce: 9 }));
    expect(disagreeing?.source).toBe("speed");
    expect(disagreeing?.fastestKnots).toBe(18);
    expect(disagreeing?.statedForceAgrees).toBe(false);

    // Eighteen knots is inside force 5, which runs 17 to 21.
    expect(windFrom(windy({ speedKnots: 18, beaufortForce: 5 }))?.statedForceAgrees).toBe(true);
  });

  it("has nothing to say about agreement where only one of the two is stated", () => {
    expect(windFrom(windy({ speedKnots: 18 }))?.statedForceAgrees).toBeNull();
    expect(windFrom(windy({ beaufortForce: 5 }))?.statedForceAgrees).toBeNull();
    expect(windFrom(windy({ fromDegreesTrue: 90 }))?.statedForceAgrees).toBeNull();
  });

  it("counts force 12 as agreeing with any speed above its floor, having no ceiling", () => {
    expect(windFrom(windy({ speedKnots: 90, beaufortForce: 12 }))?.statedForceAgrees).toBe(true);
    expect(windFrom(windy({ speedKnots: 30, beaufortForce: 12 }))?.statedForceAgrees).toBe(false);
  });

  it("carries a direction with no speed rather than inventing one", () => {
    const wind = windFrom(windy({ fromDegreesTrue: 250 }));
    expect(wind?.source).toBe("direction-only");
    expect(wind?.fromDegreesTrue).toBe(250);
  });

  it("marks force 12 as open above, since the scale ends there", () => {
    expect(windFrom(windy({ beaufortForce: 12 }))?.fastestIsOpen).toBe(true);
    expect(windFrom(windy({ beaufortForce: 11 }))?.fastestIsOpen).toBe(false);
  });

  it("is null where the file states no wind", () => {
    expect(windFrom(undefined)).toBeNull();
    expect(windFrom({ seaState: 4 })).toBeNull();
  });
});

describe("what the wind settles about the sea, and what it does not", () => {
  const stated = (extra: Record<string, unknown>): Environment => ({
    seaState: 4,
    wind: { derivation: "measured", ...extra },
  });

  /**
   * A wind sea runs with the wind, and both are stated as where they come from - so the
   * bearing carries across unchanged. But a swell runs from wherever its own storm was, so
   * an observation of the waves themselves still wins.
   */
  it("takes the direction from the wind, unless the waves state their own", () => {
    expect(seawayFrom(stated({ fromDegreesTrue: 250 }))).toMatchObject({
      fromDegreesTrue: 250,
      directionFrom: "wind",
    });

    const both = seawayFrom({
      wind: { fromDegreesTrue: 250, derivation: "measured" },
      waves: { significantHeightMetres: 2, fromDegreesTrue: 120, derivation: "measured" },
    });
    expect(both).toMatchObject({ fromDegreesTrue: 120, directionFrom: "stated" });
  });

  it("still has no direction at all where neither states one", () => {
    expect(seawayFrom({ seaState: 4 })).toMatchObject({
      fromDegreesTrue: null,
      directionFrom: "assumed",
    });
  });

  /**
   * A force is a class. Choosing a period from one would mean choosing a speed out of the
   * middle of it, which is the invention the sea state table refuses to make about heights.
   */
  it("takes the period from a stated speed, but never from a force alone", () => {
    expect(seawayFrom(stated({ speedKnots: 22 }))?.periodFrom).toBe("wind");
    expect(seawayFrom(stated({ beaufortForce: 6 }))?.periodFrom).toBe("height");
    expect(seawayFrom({ seaState: 4 })?.periodFrom).toBe("height");
  });

  it("uses the period the file states over anything derived", () => {
    const estimate = seawayFrom({
      wind: { speedKnots: 22, derivation: "measured" },
      waves: { significantHeightMetres: 2, peakPeriodSeconds: 5, derivation: "measured" },
    });
    expect(estimate?.periodFrom).toBe("stated");
    expect(estimate?.rough.peakPeriodSeconds).toBe(5);
  });

  /**
   * One-sided on purpose. A sea bigger than the wind can raise is a swell from elsewhere or
   * a transcription error; a sea smaller is the ordinary case, because a sea needs fetch and
   * time to reach what the wind can eventually give it. Flagging the ordinary case teaches a
   * reader to ignore the column.
   */
  it("reports a sea too big for its wind, and says nothing about one too small", () => {
    const tooBig = {
      wind: { speedKnots: 5, derivation: "measured" as const },
      waves: { significantHeightMetres: 4, derivation: "measured" as const },
    };
    expect(seaExceedsWind(seawayFrom(tooBig), windFrom(tooBig))).toBe(true);

    const tooSmall = {
      wind: { speedKnots: 40, derivation: "measured" as const },
      waves: { significantHeightMetres: 0.5, derivation: "measured" as const },
    };
    expect(seaExceedsWind(seawayFrom(tooSmall), windFrom(tooSmall))).toBe(false);
  });

  it("declines to compare where either side is missing or open-ended", () => {
    const noSpeed = { wind: { fromDegreesTrue: 90, derivation: "measured" as const }, seaState: 4 };
    expect(seaExceedsWind(seawayFrom(noSpeed), windFrom(noSpeed))).toBeNull();

    const open = { wind: { beaufortForce: 12, derivation: "measured" as const }, seaState: 4 };
    expect(seaExceedsWind(seawayFrom(open), windFrom(open))).toBeNull();

    const noSea = { wind: { speedKnots: 20, derivation: "measured" as const } };
    expect(seaExceedsWind(seawayFrom(noSea), windFrom(noSea))).toBeNull();
  });
});

describe("a wind that could not have raised the sea it is stated beside", () => {
  /**
   * A calm and a two-metre swell is a valid file and a common situation: the swell belongs
   * to another weather system. Taking the period from that wind ran the clamp and produced
   * 0.5 seconds - a two-metre sea 0.4 m from crest to crest - under a panel reading "from
   * the stated wind". Absurd geometry behind a plausible label, which is the failure this
   * project exists to catch.
   */
  it("does not take a period from a calm", () => {
    const calm = seawayFrom({
      wind: { speedKnots: 0, derivation: "measured" },
      waves: { significantHeightMetres: 2, derivation: "measured" },
    });
    expect(calm?.periodFrom).toBe("height");
    expect(calm?.rough.peakPeriodSeconds).toBeGreaterThan(4);
    expect(calm?.rough.peakWavelengthMetres).toBeGreaterThan(20);
  });

  it("does not take one from a breeze too light for the stated sea either", () => {
    const light = seawayFrom({
      wind: { speedKnots: 6, derivation: "measured" },
      waves: { significantHeightMetres: 3, derivation: "measured" },
    });
    expect(light?.periodFrom).toBe("height");
  });

  it("still takes one where the wind can account for the sea", () => {
    const consistent = seawayFrom({
      wind: { speedKnots: 25, derivation: "measured" },
      waves: { significantHeightMetres: 2, derivation: "measured" },
    });
    expect(consistent?.periodFrom).toBe("wind");
  });

  /**
   * The invariant, and it is not the one that was here before.
   *
   * A wind-derived period is applied to BOTH ends of a class, so it has to hold at the
   * rough end - not merely at the calm one. Pinning it to `seaExceedsWind` instead pinned
   * the wrong thing: that warning asks about the calm end on purpose, because a warning
   * should be hard to raise, and a sea state of 1.25 to 2.5 m at fourteen knots therefore
   * passed and labelled a 2.5 m sea's period "from the stated wind".
   */
  it("only takes a period from a wind that could raise the roughest sea allowed", () => {
    // Every state, including 9 - which is open above, so no finite wind can answer for it.
    for (let state = 0; state < SEA_STATE_HEIGHT_METRES.length; state += 1) {
      for (const knots of [0, 5, 14, 40, 90, 150]) {
        const environment = {
          seaState: state,
          wind: { speedKnots: knots, derivation: "measured" as const },
        };
        const estimate = seawayFrom(environment);
        if (estimate?.periodFrom !== "wind") continue;
        const raised = fullyDevelopedHeightMetres(knots) * 1.3;
        expect(
          estimate.rough.significantHeightMetres,
          `state ${state}, ${knots} kn`,
        ).toBeLessThanOrEqual(raised + 1e-9);
      }
    }
    // Slow on purpose, and given room rather than thinned: each point builds two spectra,
    // and each spectrum is twenty-odd four-thousand-step integrals. Cutting the sweep to
    // fit five seconds would drop states, and it is the whole scale this property is about.
  }, 30_000);

  /**
   * The case that found it. Fourteen knots raises 1.44 m with the margin, which clears the
   * calm end of state 4 and comes nowhere near its rough end.
   */
  it("does not label a 2.5 m sea's period as coming from a fourteen-knot wind", () => {
    const estimate = seawayFrom({
      seaState: 4,
      wind: { speedKnots: 14, derivation: "measured" },
    });
    expect(estimate?.periodFrom).toBe("height");
  });

  /**
   * The class with no ceiling. The table's 14 is a sentinel, so a finite wind that clears it
   * still cannot answer for the sea the class allows - the third time an open end has been
   * read as a bound in this repository, after sea state 9 in the panels and Beaufort 12 in
   * the wind's own display.
   */
  it("never takes a period from a wind for a sea state that has no ceiling", () => {
    for (const knots of [30, 90, 150]) {
      const estimate = seawayFrom({
        seaState: 9,
        wind: { speedKnots: knots, derivation: "measured" },
      });
      expect(estimate?.periodFrom, `${knots} kn`).toBe("height");
    }
  });

  it("does not put a half-second period on the rough end of a nearly calm state", () => {
    const estimate = seawayFrom({
      seaState: 1,
      wind: { speedKnots: 0, derivation: "measured" },
    });
    expect(estimate?.periodFrom).toBe("height");
    expect(estimate?.rough.peakPeriodSeconds).toBeGreaterThan(PERIOD_LIMITS_SECONDS.least);
  });
});

describe("keeping the figure a speed overrode", () => {
  /**
   * A page that reports a disagreement without naming the other side of it has hidden half
   * the input while claiming to expose it: a reader cannot check "these are not the same
   * wind" against a force they are never shown.
   */
  it("carries the stated force even where the speed is what gets used", () => {
    const both = windFrom({ wind: { speedKnots: 18, beaufortForce: 9, derivation: "measured" } });
    expect(both?.source).toBe("speed");
    expect(both?.fastestKnots).toBe(18);
    expect(both?.statedForce).toBe(9);
  });

  it("has no force to carry where the file gave none", () => {
    expect(windFrom({ wind: { speedKnots: 18, derivation: "measured" } })?.statedForce).toBeNull();
  });

  it("carries it where the force is what the speed came from", () => {
    expect(windFrom({ wind: { beaufortForce: 5, derivation: "measured" } })?.statedForce).toBe(5);
  });
});

describe("the two Beaufort classes whose ends are not numbers", () => {
  const wind = (speedKnots: number, beaufortForce: number): Environment => ({
    wind: { speedKnots, beaufortForce, derivation: "measured" },
  });

  /**
   * Calm is "less than 1 knot", not "nought to one": a knot is already force 1. Testing
   * every class as a closed interval called one knot calm and dropped the disagreement note
   * that is the whole point of comparing the two figures. The fourth time an end of a class
   * has been read as a number in this repository, and the first at a bottom end.
   */
  it("does not call a one-knot wind calm", () => {
    expect(windFrom(wind(0.9, 0))?.statedForceAgrees).toBe(true);
    expect(windFrom(wind(0, 0))?.statedForceAgrees).toBe(true);
    expect(windFrom(wind(1, 0))?.statedForceAgrees).toBe(false);
    expect(windFrom(wind(1, 1))?.statedForceAgrees).toBe(true);
  });

  it("counts anything above force 12's floor as force 12, having no top", () => {
    expect(windFrom(wind(64, 12))?.statedForceAgrees).toBe(true);
    expect(windFrom(wind(200, 12))?.statedForceAgrees).toBe(true);
    expect(windFrom(wind(63, 12))?.statedForceAgrees).toBe(false);
  });

  it("treats every class between them as closed at both ends", () => {
    for (let force = 1; force < BEAUFORT_KNOTS.length - 1; force += 1) {
      const band = BEAUFORT_KNOTS[force];
      if (!band) throw new Error("the scale runs 0 to 12");
      expect(windFrom(wind(band[0], force))?.statedForceAgrees, `force ${force} bottom`).toBe(true);
      expect(windFrom(wind(band[1], force))?.statedForceAgrees, `force ${force} top`).toBe(true);
      expect(windFrom(wind(band[1] + 0.5, force))?.statedForceAgrees, `force ${force} over`).toBe(
        false,
      );
    }
  });

  it("has one place that knows how a class ends", () => {
    expect(forceClass(0)).toMatchObject({ topIsExclusive: true, topIsOpen: false });
    expect(forceClass(5)).toMatchObject({ topIsExclusive: false, topIsOpen: false });
    expect(forceClass(12)).toMatchObject({ topIsExclusive: false, topIsOpen: true });
    expect(forceClass(13)).toBeNull();
  });
});

describe("the sea state's open end, known in one place like the wind's", () => {
  /**
   * The Beaufort scale taught this at its own two odd ends: scattering a special case is how
   * the second one gets missed. Two functions knew separately that state 9 has no ceiling.
   */
  it("says which class has a ceiling and which has a floor", () => {
    expect(seaStateClass(4)).toEqual({
      calmestMetres: 1.25,
      roughestMetres: 2.5,
      topIsOpen: false,
    });
    expect(seaStateClass(9)).toMatchObject({ calmestMetres: 14, topIsOpen: true });
    expect(seaStateClass(0)).toMatchObject({ topIsOpen: false });
    expect(seaStateClass(10)).toBeNull();
  });

  it("agrees with what the estimate reports about its own ends", () => {
    for (let state = 0; state < SEA_STATE_HEIGHT_METRES.length; state += 1) {
      const estimate = seawayFrom({ seaState: state });
      const band = seaStateClass(state);
      expect(estimate?.roughEndIsOpen, `state ${state}`).toBe(band?.topIsOpen);
      expect(estimate?.calm.significantHeightMetres).toBe(band?.calmestMetres);
      expect(estimate?.rough.significantHeightMetres).toBe(band?.roughestMetres);
    }
  });
});

describe("what a calm is worth as a period", () => {
  /**
   * Nought, which is the relation's own answer and not a period. It used to hand back the
   * spectrum's lower clamp - half a second - which is a plausible-looking figure for a
   * question that has none, and is the shape of trap that had a calm drawing a two-metre sea
   * 0.4 m from crest to crest.
   */
  it("gives a calm no period rather than the clamp", () => {
    expect(periodFromWindSeconds(0)).toBe(0);
    expect(periodFromWindSeconds(-5)).toBe(0);
    expect(periodFromWindSeconds(0)).not.toBe(PERIOD_LIMITS_SECONDS.least);
  });

  it("still runs the relation for any wind that raises something", () => {
    expect(periodFromWindSeconds(20)).toBeGreaterThan(PERIOD_LIMITS_SECONDS.least);
    expect(periodFromWindSeconds(40) / periodFromWindSeconds(20)).toBeCloseTo(2, 9);
  });
});

describe("a sea with no height in it", () => {
  /**
   * The reachable corner that survived two fixes. Sea state 0 has a roughest height of
   * nought, a calm wind clears "could this raise it" on nought against nought, the relation
   * hands back its own zero - and `seawayOf` clamps that straight to the spectrum's floor,
   * so the page read "0.5 s (from the stated wind)" over water with no waves in it. Fixing
   * the relation moved the lie one step down rather than removing it.
   */
  it("has no period from any source the tool could derive one from", () => {
    for (const environment of [
      { seaState: 0, wind: { speedKnots: 0, derivation: "measured" as const } },
      { seaState: 0, wind: { speedKnots: 30, derivation: "measured" as const } },
      { seaState: 0 },
      { waves: { significantHeightMetres: 0, derivation: "measured" as const } },
    ]) {
      expect(seawayFrom(environment)?.periodFrom, JSON.stringify(environment)).toBe("none");
    }
  });

  /**
   * Unless the file states one. A flat sea with a period and a bearing is not a contradiction
   * to be swallowed - a decayed swell has both, and a significant height that rounds to
   * nothing. The page denied two figures the file contained until this was separated out.
   */
  it("keeps a period and a direction the file states on a sea of no height", () => {
    const swell = seawayFrom({
      waves: {
        significantHeightMetres: 0,
        peakPeriodSeconds: 8,
        fromDegreesTrue: 270,
        derivation: "measured",
      },
    });
    expect(swell?.periodFrom).toBe("stated");
    expect(swell?.rough.peakPeriodSeconds).toBe(8);
    expect(swell?.directionFrom).toBe("stated");
    expect(swell?.fromDegreesTrue).toBe(270);
  });

  it("still has a period on its Seaway, which is why nothing may print it unasked", () => {
    const flat = seawayFrom({ seaState: 0 });
    // The field is a number and the spectrum clamps whatever it is given, so a figure exists.
    expect(flat?.rough.peakPeriodSeconds).toBeGreaterThan(0);
    // It means nothing, which is what `periodFrom` is for.
    expect(flat?.periodFrom).toBe("none");
  });

  it("keeps a period for the faintest sea that has any height at all", () => {
    expect(seawayFrom({ seaState: 1 })?.periodFrom).toBe("height");
    expect(
      seawayFrom({ waves: { significantHeightMetres: 0.05, derivation: "measured" } })?.periodFrom,
    ).toBe("height");
  });
});

describe("which refusal the core recorded", () => {
  /**
   * One value rather than a pair of flags: a pair collapsed "the wind is too light" and
   * "the class has no ceiling" into one, and the collapsed message was false for the second.
   */
  it("distinguishes all four, and reports none where the wind was used", () => {
    const cases: [Environment, SeaEstimate["periodDeclined"]][] = [
      [{ seaState: 5, wind: { speedKnots: 35, derivation: "measured" } }, "none"],
      [{ seaState: 5, wind: { speedKnots: 6, derivation: "measured" } }, "wind-too-light"],
      [{ seaState: 5, wind: { beaufortForce: 6, derivation: "measured" } }, "force-is-a-class"],
      [{ seaState: 5 }, "nothing-stated"],
      [{ seaState: 9, wind: { speedKnots: 150, derivation: "measured" } }, "sea-has-no-ceiling"],
      [{ seaState: 5, wind: { fromDegreesTrue: 90, derivation: "measured" } }, "nothing-stated"],
    ];
    for (const [environment, expected] of cases) {
      expect(seawayFrom(environment)?.periodDeclined, JSON.stringify(environment)).toBe(expected);
    }
  });

  it("prefers the open class over any other true reason", () => {
    for (const wind of [
      { speedKnots: 150, derivation: "measured" as const },
      { speedKnots: 1, derivation: "measured" as const },
      { beaufortForce: 11, derivation: "measured" as const },
    ]) {
      expect(seawayFrom({ seaState: 9, wind })?.periodDeclined).toBe("sea-has-no-ceiling");
    }
  });
});

describe("the wind's bounds, held to the schema's like the sea's", () => {
  /**
   * The rule arrived two reviews earlier for the height and the period, and was not applied
   * to the wind when the field was added: the schema bounds it, `windFrom` is exported, and
   * a caller that has not been through `validateScenario` can reach it. Two copies in two
   * languages, neither able to import the other.
   */
  it("bounds the speed the same in both", () => {
    const wind = schema.properties.environment.properties.wind.properties;
    expect(wind.speedKnots.maximum).toBe(SPEED_LIMIT_KNOTS);
    expect(wind.speedKnots.minimum).toBe(0);
    expect(wind.beaufortForce.maximum).toBe(BEAUFORT_KNOTS.length - 1);
    expect(wind.beaufortForce.minimum).toBe(0);
  });

  it("clamps a speed past the end of the scale rather than carrying it", () => {
    const absurd = windFrom({ wind: { speedKnots: 1e308, derivation: "measured" } });
    expect(absurd?.fastestKnots).toBe(SPEED_LIMIT_KNOTS);
    expect(windFrom({ wind: { speedKnots: -5, derivation: "measured" } })?.fastestKnots).toBe(0);
  });

  it("keeps every figure finite for a wind past the end of the scale", () => {
    const estimate = seawayFrom({
      wind: { speedKnots: 1e308, derivation: "measured" },
      waves: { significantHeightMetres: 2, derivation: "measured" },
    });
    for (const value of Object.values(estimate?.rough ?? {})) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

/**
 * Monahan and O'Muircheartaigh (1980), the fit ocean-colour work still uses. Held against
 * published counts at the winds this project meets rather than against a second writing of
 * the same power law, which would agree with the implementation however wrong it was.
 */
describe("how much of the sea is under whitecaps", () => {
  it("follows the measured relation, which is a steep power of the wind", () => {
    const at = (knots: number): number => whitecapFraction(knots * 0.514444);

    expect(at(10) * 100).toBeCloseTo(0.1, 1);
    expect(at(18) * 100).toBeCloseTo(0.76, 1);
    expect(at(25) * 100).toBeCloseTo(2.33, 1);
    expect(at(34) * 100).toBeCloseTo(6.64, 1);
  });

  it("gives a calm none, and never more sea than there is", () => {
    expect(whitecapFraction(0)).toBe(0);
    expect(whitecapFraction(-5)).toBe(0);
    expect(whitecapFraction(500)).toBe(1);
  });

  it("takes a stated speed as one figure", () => {
    const foam = whitecapsFrom({ wind: { speedKnots: 18, derivation: "measured" } });
    expect(foam?.from).toBe("speed");
    expect(foam?.leastFraction).toBe(foam?.mostFraction);
    expect((foam?.mostFraction ?? 0) * 100).toBeCloseTo(0.76, 1);
  });

  /** A force is a class, so the coverage is a range - and force 12 has no top. */
  it("takes a stated force as the class it is", () => {
    const foam = whitecapsFrom({ wind: { beaufortForce: 7, derivation: "measured" } });
    expect(foam?.from).toBe("force");
    expect(foam?.leastFraction).toBeLessThan(foam?.mostFraction ?? 0);
    expect(foam?.mostIsOpen).toBe(false);

    expect(whitecapsFrom({ wind: { beaufortForce: 12, derivation: "measured" } })?.mostIsOpen).toBe(
      true,
    );
  });

  /**
   * A report states a sea far more often than it states a wind, and the wind that would have
   * raised it is already what the glitter path's width is taken from. It is derived, and the
   * page has to say so rather than reporting a wind nobody wrote down.
   */
  it("falls back to the wind that would have raised the sea, and says that is what it did", () => {
    const foam = whitecapsFrom({
      waves: { significantHeightMetres: 3, derivation: "inferred" },
    });
    expect(foam?.from).toBe("sea");
    expect((foam?.mostFraction ?? 0) * 100).toBeGreaterThan(1);
  });

  it("has no answer where the file states neither a wind nor a sea", () => {
    expect(whitecapsFrom(undefined)).toBeNull();
    expect(whitecapsFrom({ lightCondition: "day" })).toBeNull();
  });
});
