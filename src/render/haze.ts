/**
 * How far you can see through the air, and what that does to what is behind it.
 *
 * **The distance a scenario spans is not a property of the atmosphere.** The fog used to be
 * built from the span of the tracks - clear to `extent * 1.4`, opaque past `extent * 3` -
 * which made a clear day go white nine kilometres out on a short reconstruction (`marks-day`,
 * tracks 2.55 km) and never fog at all on a long one (the reference case, 40.8 km, against
 * terrain drawn to 46). The air does not know how big the case is. Issue #81.
 *
 * **Meteorological visibility is the driver, and it has a definition.** Koschmieder's
 * relation: a black object is at the limit of visibility when its contrast against the
 * horizon has fallen to 2 per cent, so with contrast going as `exp(-beta d)` the extinction
 * is `beta = ln(1/0.02) / V = 3.912 / V`. That is what `visibilityMetres` means when a report
 * states it, so it is what the fog is built from.
 *
 * **And the fall has to be exponential, or the ridges collapse into one.** three's linear fog
 * clamps to fully fogged at its far plane, so everything beyond it is a single flat colour -
 * which is what a far shore of several ranges at 15, 20 and 30 km looked like: one silhouette
 * with no depth in it. Its `FogExp2` is `exp(-(beta d)^2)`, which is not Koschmieder either.
 * The chunk below is replaced once, globally, so every material fades the way the definition
 * says.
 */

import { FogExp2, LinearSRGBColorSpace, ShaderChunk, type Color } from "three";

import { onScreen } from "./tone.js";

/**
 * What visibility a file that states none is drawn at.
 *
 * **A declared figure, and the least-claiming end of a real range.** The WMO calls anything
 * over 10 km "good" and does not put a top on it; clean maritime air runs from 20 to 50 km.
 *
 * The choice goes to the clear end on purpose. Haze the source did not state is haze this
 * tool invented, and inventing it HIDES things - at 30 km a hill 25 km off keeps 4 per cent
 * of its contrast and is gone, and a reader cannot tell that from a coastline the report
 * never mentioned. At 50 km the same hill keeps 14 per cent: plainly hazed, still there. It
 * is the same argument the flat sea makes in `ui/panels.ts` - the picture that claims least
 * is the one that draws what nobody denied. `visibilityText` prints it as chosen.
 */
export const CLEAR_AIR_METRES = 50_000;

/** Koschmieder: contrast falls to 2 per cent at the stated visibility. */
export function extinctionPerMetre(visibilityMetres: number): number {
  return Math.log(1 / 0.02) / Math.max(visibilityMetres, 1);
}

/** What is left of an object's contrast at this distance, which is the fog's own curve. */
export function contrastAt(distanceMetres: number, visibilityMetres: number): number {
  return Math.exp(-extinctionPerMetre(visibilityMetres) * Math.max(distanceMetres, 0));
}

/**
 * The air a scenario is drawn through: the stated visibility, or the declared clear air.
 *
 * The colour is set by `hazeColour` rather than here, because it depends on the exposure and
 * the reader can move that (#71).
 */
export function buildHaze(visibilityMetres: number | null): FogExp2 {
  useKoschmiederFog();
  return new FogExp2(0x000000, extinctionPerMetre(visibilityMetres ?? CLEAR_AIR_METRES));
}

/**
 * What the haze fades towards: the sky at the horizon, AS THE SCREEN SHOWS IT.
 *
 * Haze is air scattering the sky towards the eye, so the colour is the sky's - but three
 * mixes fog after the tone curve and the colour-space encoding, so what it wants is a display
 * value and not a radiance. Handing it the radiance whitens the sea a few hundred metres out;
 * handing it the palette's hex, which is what happened before #81, fades towards a linear
 * 0.33 in an sRGB buffer - darker than the sky, which is what made the horizon a dark band
 * with the sky's brightest part sitting on top of it.
 *
 * Set through `LinearSRGBColorSpace` so three stores the numbers as given: they are already
 * where they need to be, and a second conversion would undo the first.
 */
export function hazeColour(fog: FogExp2, horizonRadiance: Color, exposure: number): void {
  const [r, g, b] = onScreen([horizonRadiance.r, horizonRadiance.g, horizonRadiance.b], exposure);
  fog.color.setRGB(r, g, b, LinearSRGBColorSpace);
}

/**
 * Replace three's fog with the exponential the definition of visibility is written in.
 *
 * Global and once: `ShaderChunk` is three's own table and every material compiled after this
 * takes the new text. That is a heavy hammer for one line, and the alternative - patching
 * each material's shader - would have to reach the hulls, the marks, the terrain and the
 * water separately and would leave whichever one was forgotten fading on a different curve.
 */
let replaced = false;

export function useKoschmiederFog(): void {
  if (replaced) return;
  replaced = true;
  // `fogDensity` is FogExp2's uniform; here it carries Koschmieder's beta rather than three's
  // own density, so the exponent is linear in depth.
  ShaderChunk.fog_fragment = ShaderChunk.fog_fragment.replace(
    "float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );",
    "float fogFactor = 1.0 - exp( - fogDensity * vFogDepth );",
  );
}
