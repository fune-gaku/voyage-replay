import { describe, expect, it } from "vitest";

import { PROPORTIONS, ridingOf } from "../src/actors/mark/riding.js";
import { MARK_SHAPES, type MarkShape } from "../src/core/types.js";

/**
 * What a buoy does with a sea, as against what the water does.
 *
 * The claims here are about the physics rather than about the arithmetic: a float follows a
 * long swell, moves further than a wave near her own period, and cannot keep up with a short
 * one. Those three are true of any damped body and are what the picture has to show.
 */

/** The forcing frequency, in radians a second, of a wave of this period. */
function omega(periodSeconds: number): number {
  return (2 * Math.PI) / periodSeconds;
}

describe("how a buoy answers a sea", () => {
  const pillar = ridingOf("pillar", 3.2);

  /**
   * The reference case's own swell against a pillar buoy: a natural period of about 2.5 s
   * against 8.6 s waves, so a period ratio near 0.3 - and at that ratio a damped body is
   * within a tenth of following the water exactly. **Drawing her tracing the surface was
   * right for this sea**, which is why it went unnoticed.
   */
  it("follows a long swell, which is what made tracing the surface look right", () => {
    const answer = pillar.heave(omega(8.6));
    expect(answer.gain).toBeGreaterThan(0.95);
    expect(answer.gain).toBeLessThan(1.15);
  });

  /**
   * And the same buoy in a three-second chop is near her own period, where she moves half
   * again as far as the water. That is the error the old model carried with nothing on the
   * page to say so.
   */
  it("moves further than the water in a chop near her own period", () => {
    expect(pillar.heave(omega(3)).gain).toBeGreaterThan(1.5);
  });

  it("cannot keep up with a wave much quicker than she is", () => {
    expect(pillar.heave(omega(0.8)).gain).toBeLessThan(0.5);
  });

  /**
   * **The lag is what makes the motion look irregular.** Heave and tilt are given different
   * natural periods, so they answer the same wave at different moments - and a buoy whose
   * rise and lean peaked together would look like a toy on a stick.
   */
  it("leans at a different moment from when it rises", () => {
    const wave = omega(4);
    expect(pillar.tilt(wave).lagRadians).not.toBeCloseTo(pillar.heave(wave).lagRadians, 2);
  });

  /**
   * **A spar buoy exists to stay upright.** Ballast low and little waterplane: she stands
   * through a sea that rolls a can over with it, and drawing her leaning to every slope draws
   * away the one thing the shape was chosen for.
   */
  it("leans a spar far less than a can, which is what the shape is for", () => {
    const wave = omega(6);
    const spar = ridingOf("spar", 3).tilt(wave).gain;
    const can = ridingOf("can", 3).tilt(wave).gain;
    expect(spar).toBeLessThan(can / 3);
  });

  /** Deeper draught, longer period - and a spar is the deepest of them for her height. */
  it("gives a spar the longest natural period of the shapes", () => {
    const periods = MARK_SHAPES.map((shape: MarkShape) => ({
      shape,
      period: ridingOf(shape, 3).heavePeriodSeconds,
    }));
    const longest = periods.reduce((a, b) => (a.period > b.period ? a : b));
    expect(longest.shape).toBe("spar");
  });

  it("takes her draught from her height and her shape", () => {
    for (const shape of MARK_SHAPES) {
      expect(ridingOf(shape, 4).draughtMetres, shape).toBeCloseTo(
        4 * PROPORTIONS[shape].draught,
        9,
      );
    }
  });

  /**
   * A taller buoy of the same shape floats deeper and answers more slowly. Nothing else in
   * the model can change the period, because the waterplane area cancels out of it.
   */
  it("slows a bigger buoy of the same shape", () => {
    expect(ridingOf("pillar", 6).heavePeriodSeconds).toBeGreaterThan(
      ridingOf("pillar", 3).heavePeriodSeconds,
    );
  });
});
