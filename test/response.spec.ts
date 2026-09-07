import { describe, expect, it } from "vitest";

import { answerTo, heavePeriodSeconds } from "../src/core/response.js";

/**
 * A damped oscillator has three places where the answer is known without computing it, and
 * they are what this file holds - for the reason `test/celestial.spec.ts` gives about the
 * sun. A test that recomputes what the code computes is wrong by exactly the same amount
 * whenever the code is.
 */
describe("what a damped body does with a forcing", () => {
  /** Far below resonance a body simply goes where the water goes, and goes there with it. */
  it("follows the forcing exactly when the forcing is slow", () => {
    const slow = answerTo(0.01, 0.3);
    expect(slow.gain).toBeCloseTo(1, 3);
    // A thousandth of a cycle behind: with it, for anything a picture can show.
    expect(slow.lagRadians).toBeLessThan(0.01);
  });

  /**
   * At resonance the stiffness term vanishes and only the damping is left, so the gain is
   * one over twice the damping and the lag is a quarter cycle. Both are exact.
   */
  it("gives one over twice the damping at resonance, a quarter cycle late", () => {
    for (const damping of [0.1, 0.2, 0.3, 0.5]) {
      const answer = answerTo(1, damping);
      expect(answer.gain, `${damping}`).toBeCloseTo(1 / (2 * damping), 9);
      expect(answer.lagRadians, `${damping}`).toBeCloseTo(Math.PI / 2, 9);
    }
  });

  /** Far above it the body cannot keep up at all, and ends up half a cycle out. */
  it("falls away to nothing above resonance, half a cycle late", () => {
    const quick = answerTo(20, 0.3);
    expect(quick.gain).toBeLessThan(0.01);
    expect(quick.lagRadians).toBeCloseTo(Math.PI, 1);
  });

  /**
   * The lag passes a quarter cycle at resonance and keeps going. Computed with `atan` alone
   * it folds back down instead, and a body above its own period would be drawn early rather
   * than late - which reads as plausible and is upside down.
   */
  it("keeps the lag growing past a quarter cycle rather than folding it back", () => {
    const lags = [0.5, 0.9, 1, 1.5, 3, 10].map((ratio) => answerTo(ratio, 0.3).lagRadians);
    for (let i = 1; i < lags.length; i += 1) {
      expect(lags[i] ?? 0).toBeGreaterThan(lags[i - 1] ?? 0);
    }
    expect(Math.max(...lags)).toBeLessThanOrEqual(Math.PI);
  });

  /** Less damping, sharper peak. It is the only thing that sets the height of the resonance. */
  it("makes the peak taller as the damping falls", () => {
    expect(answerTo(1, 0.1).gain).toBeGreaterThan(answerTo(1, 0.3).gain);
    expect(answerTo(1, 0.3).gain).toBeGreaterThan(answerTo(1, 0.7).gain);
  });
});

/**
 * `T = 2 pi sqrt(d / g)`, from the restoring force being the weight of the water in the extra
 * draught and the mass being the water displaced already. **The waterplane area cancels**,
 * which is what makes this computable for a buoy where a ship's roll is not: no metacentric
 * height is needed, only how deep she floats.
 */
describe("the natural period of a floating body in heave", () => {
  it("comes out of the draught alone", () => {
    // A pendulum of the same length has the same period, and for the same arithmetic.
    expect(heavePeriodSeconds(1.6)).toBeCloseTo(2 * Math.PI * Math.sqrt(1.6 / 9.81), 9);
    expect(heavePeriodSeconds(1.6)).toBeCloseTo(2.54, 2);
    expect(heavePeriodSeconds(3.5)).toBeCloseTo(3.75, 2);
    expect(heavePeriodSeconds(4.8)).toBeCloseTo(4.4, 1);
  });

  it("grows as the square root of the draught, not with it", () => {
    expect(heavePeriodSeconds(4)).toBeCloseTo(heavePeriodSeconds(1) * 2, 9);
  });
});
