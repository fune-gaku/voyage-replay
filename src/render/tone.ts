import type { Color } from "three";

/**
 * What a luminance comes out as on a screen.
 *
 * **Because the range is impossible and pretending otherwise is what broke the picture.** A
 * moonless sea is about 2e-4 cd/m², a lamp's lane on it 5e-4, a full moon's glitter path 0.3,
 * and a daylit sky 5000. Fifteen hundred to one within a single night; ten million between a
 * night and a day. A display has about a hundred to one. So something has to compress, and
 * the choice is between a curve that rolls the top off and a clip that throws it away - which
 * is what was there, and why a daylight path came out as a white hole and a lamp's lane came
 * out as nothing at all.
 *
 * The curve is three's own `ACESFilmicToneMapping`, mirrored here so that a test can ask what
 * the screen would show without a screen. The same reason `meshCarries` and `lampLight` are
 * written twice: nothing in Node can compile a shader.
 */

/**
 * The Academy's fit, as three implements it: the exposure is divided by 0.6 first, the colour
 * is taken through the RRT and ODT approximation, and the result is clamped.
 *
 * Written for one channel, because everything that asks it here is asking about a brightness
 * rather than a colour. The matrices three applies either side are near enough to identity on
 * the diagonal for that to hold.
 */
export function displayed(luminance: number, exposure: number): number {
  const v = Math.max((luminance * exposure) / 0.6, 0);
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return Math.min(Math.max(a / b, 0), 1);
}

/**
 * The exposure that puts a given luminance at a given place on the screen.
 *
 * The one figure per condition that is chosen rather than computed, and it is chosen by
 * naming what has to be visible: a night is set by its sea, a day by its sky. Solved rather
 * than tuned, so that moving the anchor moves the exposure and not the other way round.
 */
export function exposureFor(luminance: number, shows: number): number {
  let low = 1e-9;
  let high = 1e9;
  for (let step = 0; step < 200; step += 1) {
    const middle = Math.sqrt(low * high);
    if (displayed(luminance, middle) < shows) low = middle;
    else high = middle;
  }
  return Math.sqrt(low * high);
}

/**
 * A hue at a stated luminance.
 *
 * **The palette's colours are hues and their brightnesses are physics**, so a hex has to be
 * normalised before it is scaled or the luminance it ends up at is whatever the hue happened
 * to weigh - which for a pale blue is a sixth of what was asked for, and the sea then comes
 * out six times too dark against a moon that is not.
 *
 * Rec. 709's luminance weights, which is what the working colour space here is.
 */
export function at(hue: Color, luminance: number): Color {
  const weight = 0.2126 * hue.r + 0.7152 * hue.g + 0.0722 * hue.b;
  return hue.clone().multiplyScalar(luminance / Math.max(weight, 1e-9));
}
