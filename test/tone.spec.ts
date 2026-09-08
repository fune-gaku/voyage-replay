import { Color } from "three";
import { describe, expect, it } from "vitest";

import { at, displayed, exposureFor } from "../src/render/tone.js";

/**
 * **A display has about a hundred to one and this scene has fifteen hundred.**
 *
 * A moonless sea is 2e-4 cd/m², a lamp's lane on it 5e-4, a full moon's glitter path 0.3, and
 * a daylit sky 5000. Something has to compress, and the choice is between a curve that rolls
 * the top off and a clip that throws it away - which is what was here, and why a daylight path
 * came out as a white hole and a lamp's lane came out as nothing at all.
 */
describe("what a luminance comes out as", () => {
  it("keeps everything inside the screen, however bright it gets", () => {
    for (const luminance of [0, 1e-6, 1e-3, 1, 1e3, 1e6]) {
      const shown = displayed(luminance, 332);
      expect(shown, `${luminance}`).toBeGreaterThanOrEqual(0);
      expect(shown, `${luminance}`).toBeLessThanOrEqual(1);
    }
  });

  it("never turns a brighter thing into a dimmer one", () => {
    let last = -1;
    for (const luminance of [0, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1, 10, 100]) {
      const shown = displayed(luminance, 332);
      expect(shown, `${luminance}`).toBeGreaterThanOrEqual(last);
      last = shown;
    }
  });

  /**
   * **The top rolls off rather than clipping**, which is the whole point: past the exposure a
   * linear mapping makes everything the same white, and a picture that cannot tell a moon
   * from a lamp is the picture this replaced.
   */
  it("still separates two bright things where a clip would not", () => {
    // Both of these are past white on a linear mapping at this exposure: 0.01 x 332 is over
    // three, and 0.03 is ten. The curve still tells them apart.
    const brighter = displayed(0.01, 332);
    const brightest = displayed(0.03, 332);
    expect(brightest).toBeGreaterThan(brighter);
    expect(brighter).toBeGreaterThan(0.9);
    expect(brightest).toBeLessThanOrEqual(1);
  });

  /**
   * The exposure is solved from what has to be visible rather than tuned until it looks
   * right, so moving the anchor moves the exposure and not the other way round.
   */
  it("solves an exposure that puts the anchor where it was asked for", () => {
    for (const [luminance, shows] of [
      [2e-4, 0.05],
      [5000, 0.62],
      [12000, 0.72],
    ] as const) {
      expect(displayed(luminance, exposureFor(luminance, shows))).toBeCloseTo(shows, 4);
    }
  });

  /**
   * **A hue has to be normalised before it is scaled**, or the luminance it lands at is
   * whatever the hue happened to weigh - a sixth of what was asked for, in the case of the
   * pale blue this project draws a night sky with.
   */
  it("puts a hue at the luminance it was given, whatever the hue", () => {
    const weigh = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    for (const hex of [0xffffff, 0x6d8ec9, 0x1d4360, 0x0a121d]) {
      expect(weigh(at(new Color(hex), 2e-4)), hex.toString(16)).toBeCloseTo(2e-4, 12);
    }
  });

  it("keeps the hue while it does it", () => {
    const scaled = at(new Color(0x6d8ec9), 5);
    expect(scaled.b / scaled.r).toBeCloseTo(new Color(0x6d8ec9).b / new Color(0x6d8ec9).r, 9);
  });
});
