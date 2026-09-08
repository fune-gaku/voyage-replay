/**
 * Which body lights this instant, how bright it is against another instant, and how wide a
 * path it lays on the water.
 *
 * **The third layer `CLAUDE.md` has been holding a boundary open for.** The sequence there
 * runs: `celestial.ts` says where the bodies are (arithmetic), `conditions.ts` says what
 * obtained and how each part is known (evidence), this says what that means for light
 * (physics), and `render/` approximates it (picture). It stayed empty until something needed
 * stage three, which is issue #37 - the water reflecting a sky rather than a colour.
 *
 * ## What is computed and what is chosen
 *
 * **The geometry is computed and the brightness is not.** Where a body is, and how wide its
 * reflection spreads, follow from the clock, the position and a measured relation. How much
 * of that light reached the sea depends on cloud, which no report this project has met
 * states - so the figures here are RATIOS, honest between two moons and two instants, and
 * silent about lux. `ui/panels.ts` says so beside the picture.
 *
 * Nothing in here knows about three.js, a shader or a scenario. It takes numbers about the
 * sky and the sea and returns numbers about light.
 */

import type { Conditions } from "./conditions.js";
import { coxMunkSlopeVariance, windRaisingMetresPerSecond } from "./seaway.js";

/** Which body is laying the light, where one is up at all. */
export type Body = "sun" | "moon";

export interface Lit {
  body: Body;
  /** Degrees above the horizon. Only bodies above it are here at all. */
  altitudeDegrees: number;
  /** True bearing, degrees clockwise from north. */
  azimuthDegrees: number;
  /**
   * How bright this body is against a full moon at the same altitude - so the moon's own
   * phase carries, and the sun sits five orders of magnitude above both.
   *
   * A ratio, never a lux: see the note above about cloud.
   */
  relativeBrightness: number;
}

/**
 * The sun's illuminance against a full moon's, near enough for a picture that has to put
 * them on one scale: about 100 000 lx against 0.25.
 *
 * It is only ever used to say "the sun is not the moon", which no reader needs a second
 * figure for. Nothing draws both at once - see `lightingAt`.
 */
const SUN_AGAINST_FULL_MOON = 400_000;

/**
 * How much dimmer the moon is than a full one, from its illuminated fraction.
 *
 * **A half moon is about a ninth of a full one, not half.** The lit fraction is a geometric
 * quantity and the brightness is not: at full the surface is seen at zero phase angle, where
 * shadows in the regolith hide behind the grains casting them and the disc surges - the
 * opposition effect. Scaling light by the lit fraction is the mistake `docs/domain-notes.md`
 * warns about, and it is worth an order of magnitude at the crescent.
 *
 * The relation is Allen's, as fitted by Krisciunas and Schaefer, *Publications of the
 * Astronomical Society of the Pacific* 103 (1991) 1033: the magnitude added at phase angle
 * `a` degrees is `0.026 a + 4e-9 a^4`. It runs to about 150 times down at a thin crescent,
 * where the light on the sea is starlight with a shape in it.
 */
export function moonBrightness(illuminatedFraction: number): number {
  const lit = Math.min(Math.max(illuminatedFraction, 0), 1);
  // The lit fraction is `(1 + cos a) / 2`, so the phase angle comes straight back out of it.
  const phaseAngleDegrees = (Math.acos(2 * lit - 1) * 180) / Math.PI;
  const magnitudes = 0.026 * phaseAngleDegrees + 4e-9 * phaseAngleDegrees ** 4;
  return 10 ** (-0.4 * magnitudes);
}

/**
 * Which body is lighting this instant, or null when there is none to draw.
 *
 * **The sun wins whenever it is up**, and there is nothing to weigh: a daytime moon is one
 * part in four hundred thousand, and a sea lays one path, not two. Below the horizon a body
 * lights nothing at all - the twilight glow is the sky's, not a reflection, and drawing a
 * path from a body that has set would put a light on the water where nobody could see one.
 *
 * The geometric altitude is used rather than a refracted one, and the threshold is zero
 * rather than the -0.833 degrees `SUNSET_ALTITUDE_DEGREES` uses. That threshold answers a
 * different question - when lights must be shown, COLREG Rule 20 - and a body within a
 * degree of the horizon lays a path along the whole sight line whichever way it is rounded.
 *
 * ## Why the drawn scene gets a say
 *
 * `drawnAsNight` is the picture's own answer, not the sky's: the renderer takes it from the
 * light condition the FILE states, because that is a witness's word about the dark and the
 * dark is the evidence. Where the two disagree - a file saying night with the sun computed
 * above the horizon, which happens when a date or a time zone was transcribed wrongly - the
 * water must not hand back a sun over a night palette. That would report the disagreement
 * wordlessly, in a picture, where `ui/panels.ts` reports it in a sentence a reader can check.
 *
 * So a scene drawn as night can only be lit by the moon, and one drawn as day only by the
 * sun. Both consumers ask this one function rather than each applying the rule.
 */
export function lightingAt(conditions: Conditions, drawnAsNight: boolean): Lit | null {
  const { sun, moon } = conditions;
  if (!drawnAsNight && sun.altitudeDegrees > 0) {
    return {
      body: "sun",
      altitudeDegrees: sun.altitudeDegrees,
      azimuthDegrees: sun.azimuthDegrees,
      relativeBrightness: SUN_AGAINST_FULL_MOON,
    };
  }
  if (drawnAsNight && moon.altitudeDegrees > 0) {
    return {
      body: "moon",
      altitudeDegrees: moon.altitudeDegrees,
      azimuthDegrees: moon.azimuthDegrees,
      relativeBrightness: moonBrightness(moon.illuminatedFraction),
    };
  }
  return null;
}

/**
 * How much wider the reflected body has to be drawn than the drawn surface would make it.
 *
 * **This is the declared part of the picture, and the whole reason #37 waited for #36.** A
 * sea's glitter path is about twice its rms slope across - tilt a facet by an angle and the
 * ray it reflects turns by twice that - so the path measures the slope directly. The drawn
 * surface's slope is 5.4 degrees for a 3 m sea and a real one's is 14.2, because the rest
 * lives in ripples a gravity spectrum does not describe. Reflecting a point body off the
 * drawn normals alone therefore draws a path 11 degrees wide where the sea lays one of 28:
 * water sharper than any that exists, asserted by a picture.
 *
 * So the missing roughness is put into the BODY instead, and this returns how much. Slopes
 * add in quadrature, so what is missing is `measured - drawn` as variances; the extra spread
 * of the reflected ray is twice its root. Convolved with what the normals already do, the
 * path comes out at the measured width.
 *
 * **Shading in roughness a mesh cannot carry is ordinary practice. Declaring it is not.**
 * The alternative is a number tuned until the picture looks right, which is the thing this
 * project spends its time undoing.
 *
 * **Null where NO sea is stated; zero where a flat one is.** They are different facts and
 * collapsing them loses the one the source actually gives. Nothing stated means no slope to
 * take, and a mirror-sharp body on water this tool decided to draw flat would assert a calm
 * nobody recorded. A stated calm is that calm, on somebody's authority, and a mirror is what
 * calm water does - so the body is drawn at its own angular size and no wider.
 */
export function glitterSpreadRadians(
  significantHeightMetres: number | null,
  drawnSlopeVariance: number,
): number | null {
  if (significantHeightMetres === null) return null;
  if (significantHeightMetres <= 0) return 0;
  const measured = coxMunkSlopeVariance(windRaisingMetresPerSecond(significantHeightMetres));
  // Never negative: a drawn surface steeper than the measured one needs nothing added, and
  // the square root of a negative would come back as a silent NaN in a uniform.
  const missing = Math.max(measured - drawnSlopeVariance, 0);
  return 2 * Math.atan(Math.sqrt(missing));
}
