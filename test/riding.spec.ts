import { describe, expect, it } from "vitest";

import { PROPORTIONS, ridingOf, type Riding } from "../src/actors/mark/riding.js";
import { surfaceAt, type WaveComponent } from "../src/core/seaway.js";
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

  /**
   * **A stated draught makes the period a computed figure; the fallback makes it a modelled
   * one.** The proportions are a model of what a buoy of each shape looks like, and since the
   * period rests on the draught alone, taking one from them puts the whole period on this
   * tool rather than on the source.
   */
  it("takes a stated draught over the proportion, and says which it had", () => {
    const told = ridingOf("pillar", 3.2, 2.4);
    expect(told.draughtMetres).toBe(2.4);
    expect(told.draughtFrom).toBe("stated");
    expect(told.heavePeriodSeconds).toBeCloseTo(2 * Math.PI * Math.sqrt(2.4 / 9.81), 6);

    const modelled = ridingOf("pillar", 3.2);
    expect(modelled.draughtFrom).not.toBe("stated");
    expect(modelled.draughtMetres).not.toBe(told.draughtMetres);
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

/**
 * **Which way round the lag goes**, checked against the clock rather than against the
 * arithmetic that produced it.
 *
 * The travelling wave in `core/seaway.ts` runs `kx - wt`, so its phase decreases with time
 * and a body answering late arrives at a given phase later. Subtracting the lag instead of
 * adding it draws a resonant buoy a quarter cycle AHEAD of the water: it still looks like a
 * buoy moving in a sea, and it is the motion running backwards.
 */
describe("which way the lag goes", () => {
  /** One wave, so the timing claim is about that wave and not about a sum of them. */
  const wave = (periodSeconds: number): WaveComponent => ({
    amplitudeMetres: 1,
    angularFrequencyPerSecond: (2 * Math.PI) / periodSeconds,
    wavenumberPerMetre: (2 * Math.PI) / 100,
    directionRadians: 0,
    phaseRadians: 0,
  });

  /** When the water, and when the body, next reach their highest - to a hundredth of a second. */
  function peakSeconds(riding: Riding | undefined, periodSeconds: number): number {
    const at = { eastMetres: 0, northMetres: 0 };
    let best = { seconds: 0, height: -Infinity };
    for (let seconds = 0; seconds < periodSeconds; seconds += periodSeconds / 2000) {
      const height = surfaceAt([wave(periodSeconds)], at, seconds, riding).heightMetres;
      if (height > best.height) best = { seconds, height };
    }
    return best.seconds;
  }

  /**
   * How long after the water's crest the body reaches its own, counted round the cycle -
   * the motion repeats, so "before" and "a whole period late" are the same picture.
   */
  function behindBy(riding: Riding | undefined, periodSeconds: number): number {
    const water = peakSeconds(undefined, periodSeconds);
    const body = peakSeconds(riding, periodSeconds);
    return (((body - water) % periodSeconds) + periodSeconds) % periodSeconds;
  }

  it("makes a resonant buoy peak a quarter cycle after the water", () => {
    // A pillar of 3.2 m floats 1.6 m deep and answers in about 2.54 s, so a wave of that
    // period sits her at resonance - where the lag is exactly a quarter of a cycle.
    const period = ridingOf("pillar", 3.2).heavePeriodSeconds;
    expect(behindBy(ridingOf("pillar", 3.2), period)).toBeCloseTo(period / 4, 1);
  });

  /** And a long swell she simply follows arrives at the same moment for both. */
  it("leaves a slow wave and the buoy on it peaking together", () => {
    const behind = behindBy(ridingOf("pillar", 3.2), 30);
    expect(Math.min(behind, 30 - behind)).toBeLessThan(30 / 40);
  });

  /**
   * The check that would have caught the sign: a body cannot answer a wave BEFORE the wave
   * arrives. Round the cycle, "just before" is "almost a whole period late", so the test is
   * that the lag sits in the first half - late by up to half a cycle, never early.
   */
  it("never reaches its crest before the water does, at any period", () => {
    for (const periodSeconds of [1.5, 2.5, 4, 6, 10, 20]) {
      const behind = behindBy(ridingOf("pillar", 3.2), periodSeconds);
      expect(behind, `${periodSeconds} s`).toBeLessThanOrEqual(periodSeconds / 2 + 0.01);
    }
  });
});
