import { describe, expect, it } from "vitest";

import { conditionsAt } from "../src/core/conditions.js";
import { glitterSpreadRadians, lightingAt, moonBrightness } from "../src/core/illumination.js";
import { coxMunkSlopeVariance, windRaisingMetresPerSecond } from "../src/core/seaway.js";

/**
 * Fixed against published relations rather than against this file's own arithmetic, for the
 * reason `test/celestial.spec.ts` gives about the sun: a test that recomputes what the code
 * computes is wrong by exactly the same amount whenever the code is.
 */
describe("how bright a moon is for its phase", () => {
  /**
   * **A half moon is about a ninth of a full one, not half.** At full the moon is seen at
   * zero phase angle, where the shadows in its regolith hide behind the grains casting them
   * and the disc surges - the opposition effect. Allen's relation, as fitted by Krisciunas
   * and Schaefer (1991), puts 2.6 magnitudes between the two.
   */
  it("puts an order of magnitude between a full moon and a half one", () => {
    expect(moonBrightness(1)).toBeCloseTo(1, 9);
    expect(moonBrightness(0.5)).toBeGreaterThan(1 / 12);
    expect(moonBrightness(0.5)).toBeLessThan(1 / 9);
  });

  /** And a thin crescent is two orders down: light on the sea, with a shape in it. */
  it("takes a crescent far below what its lit fraction suggests", () => {
    expect(moonBrightness(0.1)).toBeLessThan(0.1 / 10);
  });

  it("rises with the phase all the way, and never leaves the unit interval", () => {
    let last = 0;
    for (const lit of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const brightness = moonBrightness(lit);
      expect(brightness, `${lit}`).toBeGreaterThanOrEqual(last);
      expect(brightness, `${lit}`).toBeLessThanOrEqual(1);
      last = brightness;
    }
  });

  /** A fraction outside the disc is not a moon; it must not come back as a NaN in a uniform. */
  it("survives a fraction outside what a disc can be lit by", () => {
    expect(moonBrightness(-0.2)).toBeGreaterThanOrEqual(0);
    expect(moonBrightness(1.4)).toBeCloseTo(1, 9);
  });
});

describe("which body lights an instant", () => {
  const suoNada = { lat: 33.905, lon: 131.7116667 };
  /** The reference case: 2025-11-27 18:13:30 +09:00, the moon 41 degrees up on 191. */
  const collision = Date.parse("2025-11-27T18:13:30+09:00") / 1000;

  it("hands back the moon on the night of the reference case", () => {
    const lit = lightingAt(conditionsAt(suoNada, { lightCondition: "night" }, collision), true);
    expect(lit?.body).toBe("moon");
    expect(lit?.altitudeDegrees).toBeCloseTo(41, 0);
    expect(lit?.azimuthDegrees).toBeCloseTo(191, 0);
    // 41 per cent lit is a hundred degrees of phase angle: a sixteenth of a full moon.
    expect(lit?.relativeBrightness).toBeLessThan(0.1);
  });

  /**
   * **The picture's own answer decides which body may light it.** A file saying night with
   * the sun computed above the horizon is a transcription error - a date or a time zone -
   * and handing back a sun over a night palette would report that in a picture, where the
   * panel reports it in a sentence a reader can check.
   */
  it("lets a night scene be lit only by the moon, whatever the sun is doing", () => {
    const noon = Date.parse("2025-11-27T12:00:00+09:00") / 1000;
    const conditions = conditionsAt(suoNada, { lightCondition: "night" }, noon);
    expect(conditions.sun.altitudeDegrees).toBeGreaterThan(0);
    expect(lightingAt(conditions, true)?.body ?? null).not.toBe("sun");
    expect(lightingAt(conditions, false)?.body).toBe("sun");
  });

  /** And a day scene by the sun alone: a moon in daylight is one part in four hundred thousand. */
  it("never lights a day scene with the moon", () => {
    const dawn = Date.parse("2025-11-27T05:00:00+09:00") / 1000;
    const conditions = conditionsAt(suoNada, { lightCondition: "day" }, dawn);
    expect(lightingAt(conditions, false)?.body ?? null).not.toBe("moon");
  });

  /**
   * **The sun wins whenever it is up, and there is nothing to weigh.** A daytime moon is one
   * part in four hundred thousand, and a sea lays one path rather than two.
   */
  it("takes the sun over a moon that is up as well", () => {
    const noon = Date.parse("2025-11-27T12:00:00+09:00") / 1000;
    const lit = lightingAt(conditionsAt(suoNada, undefined, noon), false);
    expect(lit?.body).toBe("sun");
    expect(lit?.relativeBrightness).toBeGreaterThan(1000);
  });

  /**
   * A body under the horizon lights nothing. Drawing a path from one that has set would put
   * a light on the water where nobody standing there could have seen one.
   */
  it("gives nothing back when both bodies are down", () => {
    // Two in the morning at the reference case's position, with the moon long set.
    const small = Date.parse("2025-11-28T02:30:00+09:00") / 1000;
    const conditions = conditionsAt(suoNada, undefined, small);
    expect(conditions.sun.altitudeDegrees).toBeLessThan(0);
    expect(conditions.moon.altitudeDegrees).toBeLessThan(0);
    expect(lightingAt(conditions, true)).toBeNull();
  });
});

/**
 * **The declared part of the picture**, and the reason #37 waited for #36. A glitter path is
 * about twice the sea's rms slope across, so it measures the slope directly - and the drawn
 * sea's slope is a third of a real one because the rest lives in ripples a gravity spectrum
 * does not describe.
 */
describe("how much wider the reflected body has to be drawn", () => {
  /** The reflected ray's own spread, along one axis, from a surface of this slope variance. */
  const rayFrom = (slopeVariance: number): number => Math.sqrt(2 * slopeVariance);

  /**
   * **Slopes add in quadrature, so what the normals give plus what the body is given comes
   * to the measured sea.** That is the whole construction, and it is checked against Cox and
   * Munk rather than against the arithmetic that produced it.
   */
  it("makes up exactly what the drawn surface is missing", () => {
    const drawn = Math.tan((5.4 * Math.PI) / 180) ** 2;
    const spread = glitterSpreadRadians(3, drawn) ?? 0;
    const measured = coxMunkSlopeVariance(windRaisingMetresPerSecond(3));
    expect(Math.hypot(rayFrom(drawn), spread)).toBeCloseTo(rayFrom(measured), 12);
  });

  /**
   * **Two conversions, and either one dropped is a lane half again too wide.** `mss` is the
   * TOTAL of two slope components, so one axis carries half of it; and a facet turns its ray
   * by twice its own tilt. Together the lobe's standard deviation is `sqrt(2 mss)` - 20.4
   * degrees for the whole of a 3 m sea, against the 28.3 that "twice the rms slope" gives,
   * which is a characteristic radius in two dimensions rather than a width along one.
   */
  it("takes one axis of the ray's spread, not the two-dimensional radius", () => {
    const measured = coxMunkSlopeVariance(windRaisingMetresPerSecond(3));
    const whole = glitterSpreadRadians(3, 0) ?? 0;

    expect((whole * 180) / Math.PI).toBeCloseTo(20.4, 1);
    const shorthand = 2 * Math.atan(Math.sqrt(measured));
    expect((shorthand * 180) / Math.PI).toBeCloseTo(28.3, 1);
    // The root of two, less the two per cent that `atan` takes out of a 14 degree slope.
    expect(shorthand / whole).toBeCloseTo(Math.SQRT2, 1);
  });

  /** And what is left for the body once the drawn normals have had their share. */
  it("leaves the body the part the drawn sea cannot supply", () => {
    const drawn = Math.tan((5.4 * Math.PI) / 180) ** 2;
    expect(((glitterSpreadRadians(3, drawn) ?? 0) * 180) / Math.PI).toBeCloseTo(18.9, 1);
  });

  it("widens the path as the sea grows, because the wind that raised it did", () => {
    const flat = glitterSpreadRadians(1, 0) ?? 0;
    const rough = glitterSpreadRadians(5, 0) ?? 0;
    expect(rough).toBeGreaterThan(flat);
  });

  /**
   * **No sea stated, no width.** A mirror-sharp moon on water this tool decided to draw flat
   * would assert a calm nobody recorded, which is the strongest claim this renderer can make
   * about a sea it was told nothing about.
   */
  it("refuses to give a width for a sea nobody stated", () => {
    expect(glitterSpreadRadians(null, 0)).toBeNull();
  });

  /**
   * **A sea stated flat is a different fact, and the source gives it.** Calm water mirrors,
   * so the body is drawn at its own size and no wider - a point of light rather than a lane.
   * Collapsing the two would report a figure the source states as one it withholds.
   */
  it("gives a stated calm no spread at all, which is not the same as none", () => {
    expect(glitterSpreadRadians(0, 0)).toBe(0);
  });

  /** A drawn surface steeper than the measured one needs nothing added, and must not go NaN. */
  it("adds nothing rather than a NaN where the drawn sea is already steeper", () => {
    const spread = glitterSpreadRadians(1, 10);
    expect(spread).toBe(0);
  });
});
