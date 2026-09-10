import { ShaderChunk } from "three";
import { describe, expect, it } from "vitest";

import { neutralToneMap, onScreen, toDisplay } from "../src/render/tone.js";

/**
 * **A copy of a curve that lives on the GPU**, which is only worth having if it cannot drift
 * from the original. The haze needs it because three mixes fog after the tone mapping and the
 * colour-space encoding, so what a fog fades towards is a screen value - and the sky it has
 * to match is a radiance until the curve has been applied to it. See `render/haze.ts`.
 */
describe("the tone curve on this side of the GPU", () => {
  /**
   * The figures are three's, and this is what says so. If a future three retunes Khronos PBR
   * Neutral, this fails here rather than leaving the horizon quietly mismatched.
   */
  it("carries the same constants as three's own chunk", () => {
    const chunk = ShaderChunk.tonemapping_pars_fragment;

    expect(chunk).toContain("const float StartCompression = 0.8 - 0.04;");
    expect(chunk).toContain("const float Desaturation = 0.15;");
    expect(chunk, "and the shape of the toe").toContain("x < 0.08 ? x - 6.25 * x * x : 0.04");
    expect(chunk, "and of the shoulder").toContain(
      "float newPeak = 1. - d * d / ( peak + d - StartCompression );",
    );
  });

  it("leaves what is under the shoulder alone, but for the toe's own offset", () => {
    const [r, g, b] = neutralToneMap([0.2, 0.2, 0.2], 1);

    expect(r).toBeCloseTo(0.2 - 0.04, 12);
    expect(g).toBe(r);
    expect(b).toBe(r);
  });

  /** The whole point of a shoulder: nothing that goes in comes out over one. */
  it("keeps a sky ten thousand times over white under one", () => {
    for (const radiance of [1, 10, 1e3, 1e7]) {
      const mapped = neutralToneMap([radiance, radiance, radiance], 1);
      expect(Math.max(...mapped), `${radiance}`).toBeLessThan(1);
    }
  });

  /**
   * The exposure is the whole of what makes a night and a day fit on one screen, so it goes
   * in here rather than being applied by the caller: 8000 cd/m2 at the day's own exposure
   * lands mid-scale, and the same radiance at the night's is white.
   */
  it("takes the exposure with it", () => {
    const day = onScreen([8000, 8000, 8000], 4.6e-5);
    const night = onScreen([8000, 8000, 8000], 76);

    expect(day[0]).toBeGreaterThan(0.3);
    expect(day[0]).toBeLessThan(0.8);
    expect(night[0]).toBeGreaterThan(0.95);
  });

  it("encodes to sRGB the way the colour-space chunk does", () => {
    expect(toDisplay(0)).toBe(0);
    expect(toDisplay(1)).toBeCloseTo(1, 12);
    // The linear half-way point is well up the display scale, which is the whole reason a
    // radiance handed to a fog as though it were a screen value comes out too bright.
    expect(toDisplay(0.5)).toBeCloseTo(0.7354, 3);
    expect(toDisplay(0.002), "and the straight part near black").toBeCloseTo(0.002 * 12.92, 12);
  });
});
