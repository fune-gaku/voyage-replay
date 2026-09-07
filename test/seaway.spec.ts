import { describe, expect, it } from "vitest";

import {
  assumedPeakPeriodSeconds,
  exceedanceProbability,
  highestExpectedMetres,
  meanOfHighest,
  SEA_STATE_HEIGHT_METRES,
  seawayFrom,
  seawayOf,
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
    expect(estimate?.periodAssumed).toBe(true);
  });

  it("collapses both ends onto a stated height and keeps its derivation", () => {
    const estimate = seawayFrom({
      waves: { significantHeightMetres: 1.8, peakPeriodSeconds: 5, derivation: "measured" },
    });
    expect(estimate?.calm.significantHeightMetres).toBe(1.8);
    expect(estimate?.rough.significantHeightMetres).toBe(1.8);
    expect(estimate?.source).toBe("stated");
    expect(estimate?.derivation).toBe("measured");
    expect(estimate?.periodAssumed).toBe(false);
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
