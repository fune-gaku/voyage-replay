import { Color } from "three";
import { describe, expect, it } from "vitest";

import {
  STREAK_FULL_METRES,
  STREAK_REACH_OF_NOMINAL,
  streakBrightness,
} from "../src/core/illumination.js";
import { METRES_PER_NAUTICAL_MILE } from "../src/core/geodesy.js";
import {
  BRIGHTEST_STREAK,
  LAMPS_GLSL,
  litFromLamp,
  makeLampUniforms,
  setLamps,
  SHADER_LAMPS,
  type LitLamp,
} from "../src/render/lamps.js";

/** A lamp somewhere, with an arc and a range, for the claims below to be about. */
function lamp(over: Partial<LitLamp> = {}): LitLamp {
  return {
    at: { x: 0, y: 12, z: 0 },
    colour: new Color(0xff4d4d),
    peak: BRIGHTEST_STREAK,
    headingDegreesTrue: 0,
    arcStartDegrees: 0,
    arcEndDegrees: 360,
    nominalRangeMetres: 3 * METRES_PER_NAUTICAL_MILE,
    ...over,
  };
}

/**
 * **The arc is a question about the water, not about the eye.**
 *
 * A lamp lights only its own sector, so what decides whether a patch of sea carries its
 * colour is where that patch is, measured off the bow of the ship carrying the lamp. Asking
 * where the observer is lays a red streak ahead of a ship seen from astern - the same
 * 180-degree error `visibleLights` warns about, and just as plausible in a still frame.
 */
describe("which water a lamp lights", () => {
  /** The scene's axes: x runs east, z runs SOUTH, so north is negative z. */
  const starboard = { startDegrees: 0, endDegrees: 112.5 };
  const port = { startDegrees: 247.5, endDegrees: 360 };

  it("puts a starboard sidelight's water to starboard of her head", () => {
    const heading = 0; // pointing north
    const at = { x: 200, z: 0 }; // due east of her: on her starboard bow
    expect(litFromLamp(at, { at: { x: 0, z: 0 }, headingDegreesTrue: heading }, starboard)).toBe(
      true,
    );
    expect(litFromLamp(at, { at: { x: 0, z: 0 }, headingDegreesTrue: heading }, port)).toBe(false);
  });

  it("follows her round as she turns", () => {
    const at = { x: 200, z: 0 };
    // Heading east now, so what was on her starboard bow is dead ahead of her.
    expect(litFromLamp(at, { at: { x: 0, z: 0 }, headingDegreesTrue: 90 }, starboard)).toBe(true);
    // And heading west, the same water is astern of her: neither sidelight reaches it.
    expect(litFromLamp(at, { at: { x: 0, z: 0 }, headingDegreesTrue: 270 }, starboard)).toBe(false);
    expect(litFromLamp(at, { at: { x: 0, z: 0 }, headingDegreesTrue: 270 }, port)).toBe(false);
  });

  /**
   * **No water is left in the dark, and no water carries both sidelights.** The second is the
   * one that matters: red and green on the same patch of sea would say the lamp is in two
   * places, which is the fault `showFor` exists to avoid for the lamps themselves.
   */
  it("leaves no bearing dark, and never lays both sidelights on one", () => {
    const masthead = { startDegrees: 247.5, endDegrees: 112.5 };
    const stern = { startDegrees: 112.5, endDegrees: 247.5 };
    const her = { at: { x: 0, z: 0 }, headingDegreesTrue: 0 };

    for (let bearing = 0; bearing < 360; bearing += 0.5) {
      const radians = (bearing * Math.PI) / 180;
      const at = { x: Math.sin(radians) * 500, z: -Math.cos(radians) * 500 };
      const lit = [masthead, starboard, port, stern].filter((arc) => litFromLamp(at, her, arc));
      expect(lit.length, `${bearing}`).toBeGreaterThan(0);

      const sides = [starboard, port].filter((arc) => litFromLamp(at, her, arc));
      expect(sides.length, `${bearing}`).toBeLessThan(2);
    }
  });

  /** An all-round light, which is what every mark in this format shows. */
  it("lights every bearing from an all-round lamp", () => {
    const all = { startDegrees: 0, endDegrees: 360 };
    for (let bearing = 0; bearing < 360; bearing += 7) {
      const radians = (bearing * Math.PI) / 180;
      const at = { x: Math.sin(radians) * 80, z: -Math.cos(radians) * 80 };
      expect(
        litFromLamp(at, { at: { x: 0, z: 0 }, headingDegreesTrue: 41 }, all),
        `${bearing}`,
      ).toBe(true);
    }
  });
});

/**
 * **A reflection is dimmer than its source**, so a streak that outlived the lamp would be the
 * picture inventing a detection. There is no photometry to settle it with - Rule 22 gives a
 * range and no candela - so the inequality is declared and enforced.
 */
describe("how far a streak reaches", () => {
  const nominal = 3 * METRES_PER_NAUTICAL_MILE;

  it("is gone well inside the range the lamp itself must carry", () => {
    expect(streakBrightness(nominal, nominal)).toBe(0);
    expect(streakBrightness(nominal * STREAK_REACH_OF_NOMINAL, nominal)).toBe(0);
    expect(STREAK_REACH_OF_NOMINAL).toBeLessThan(1);
  });

  it("falls away with range, as a point source's light on the water does", () => {
    let last = Infinity;
    for (const range of [50, 200, 400, 800, 1600, 2400]) {
      const brightness = streakBrightness(range, nominal);
      expect(brightness, `${range} m`).toBeLessThan(last);
      last = brightness;
    }
  });

  /** Close aboard it is at its brightest rather than dividing by a range near nothing. */
  it("holds at full brightness inside the reference range", () => {
    expect(streakBrightness(1, nominal)).toBeCloseTo(
      streakBrightness(STREAK_FULL_METRES / 2, nominal),
      1,
    );
    expect(streakBrightness(STREAK_FULL_METRES / 2, nominal)).toBeGreaterThan(0.9);
  });

  /** A lamp with a shorter range lays a shorter streak, which is the whole of the rule. */
  it("shortens with the lamp's own range", () => {
    const far = 6 * METRES_PER_NAUTICAL_MILE;
    expect(streakBrightness(2500, far)).toBeGreaterThan(streakBrightness(2500, nominal));
  });
});

describe("what reaches the shader", () => {
  it("packs each lamp's place, colour, arc and range", () => {
    const uniforms = makeLampUniforms();
    setLamps(uniforms, [lamp({ at: { x: 40, y: 12, z: -70 }, arcEndDegrees: 112.5 })]);

    expect(uniforms.uLamp.value[0]?.x).toBe(40);
    expect(uniforms.uLamp.value[0]?.w).toBe(BRIGHTEST_STREAK);
    expect(uniforms.uLampColour.value[0]?.getHex()).toBe(0xff4d4d);
    expect(uniforms.uLampArc.value[0]?.z).toBeCloseTo((112.5 * Math.PI) / 180, 9);
    expect(uniforms.uLampArc.value[0]?.w).toBeCloseTo(3 * METRES_PER_NAUTICAL_MILE, 6);
  });

  /**
   * **An empty slot has to be an unlit slot.** A shader loop is a constant length, so a lamp
   * that has gone out leaves its numbers behind - and a peak of zero is what says "nothing
   * here" rather than a stale streak burning on where a light was a moment ago.
   */
  it("puts out the slots nothing is using", () => {
    const uniforms = makeLampUniforms();
    setLamps(uniforms, [lamp(), lamp()]);
    expect(uniforms.uLamp.value[1]?.w).toBe(BRIGHTEST_STREAK);

    setLamps(uniforms, [lamp()]);
    expect(uniforms.uLamp.value[1]?.w).toBe(0);
  });

  it("takes what fits and leaves the rest, rather than overrunning", () => {
    const uniforms = makeLampUniforms();
    const many = Array.from({ length: SHADER_LAMPS + 4 }, () => lamp());
    expect(() => {
      setLamps(uniforms, many);
    }).not.toThrow();
    expect(uniforms.uLamp.value).toHaveLength(SHADER_LAMPS);
  });
});

/**
 * The GLSL and the rules above are the same thing written twice, because nothing in Node can
 * compile a shader to ask it. What can be checked is that the shapes match.
 */
describe("the copy that runs on the card", () => {
  it("declares every uniform it is given", () => {
    for (const name of Object.keys(makeLampUniforms())) {
      expect(LAMPS_GLSL, name).toMatch(new RegExp(`uniform (vec3|vec4) ${name}\\[`));
    }
  });

  it("shares the sea's own spread rather than working out a second one", () => {
    expect(LAMPS_GLSL).toContain("lobeWidth( carried, 0.0 )");
    // And draws nothing at all where no sea is stated, as the sky does.
    expect(LAMPS_GLSL).toContain("if ( uSeaSlope < 0.0 ) return sum;");
  });

  it("carries the same two figures the range rule uses", () => {
    expect(LAMPS_GLSL).toContain(STREAK_REACH_OF_NOMINAL.toFixed(2));
    expect(LAMPS_GLSL).toContain(STREAK_FULL_METRES.toFixed(1));
  });

  /** The bearing of the water from the lamp, off that bow - the direction that is 180 out. */
  it("measures the arc from the lamp to the water, not the other way", () => {
    expect(LAMPS_GLSL).toContain("atan( at.x - lamp.x, -( at.z - lamp.z ) ) - uLampArc[ i ].x");
  });
});
