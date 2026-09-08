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
 * So the missing roughness is put into the BODY instead, and this returns how much, **as the
 * standard deviation of the reflected ray's direction along one axis** - which is what a
 * Gaussian lobe wants and is not the same number as the width of the path.
 *
 * Two conversions, and getting either wrong is a lane half again too wide:
 *
 * - **`mss` is the TOTAL of two slope components**, which is how Cox and Munk report it and
 *   how an rms slope is conventionally quoted. One axis carries half of it.
 * - **A facet tilted by an angle turns its ray by twice that**, so the ray's spread is twice
 *   the surface's.
 *
 * Together, `sigma = 2 * sqrt(mss / 2) = sqrt(2 * mss)`: 20.4 degrees for the whole of a 3 m
 * sea, against the 28.3 that "twice the rms slope" gives - larger by exactly the root of two,
 * because that phrase measures a radius in two dimensions and this measures one axis. Slopes
 * add in quadrature, so what is left for the body is `measured - drawn` as variances.
 *
 * Small angles throughout: `tan` and its angle differ by under three per cent at the
 * steepest sea this is used on.
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
/**
 * The slope variance the sea's reflection has to add up to, or null where none is stated.
 *
 * Separate from `glitterSpreadRadians` because the two are asked in different places: this is
 * the target, and the shader subtracts from it whatever the normals under a given fragment
 * happen to be carrying. A stated calm is zero rather than Cox and Munk's intercept - their
 * fit had no data at no wind, and a source saying flat means flat.
 */
export function measuredSlopeVariance(significantHeightMetres: number | null): number | null {
  if (significantHeightMetres === null) return null;
  if (significantHeightMetres <= 0) return 0;
  return coxMunkSlopeVariance(windRaisingMetresPerSecond(significantHeightMetres));
}

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
  return Math.sqrt(2 * missing);
}

/**
 * A navigation light's MINIMUM intensity in candela, from the range Rule 22 gives it.
 *
 * **It is computable, and this project spent a while saying it was not.** Rule 22 states a
 * minimum RANGE and no candela, which is true - but Annex I, section 8 gives the relation
 * between them, and it is the relation the rule's own ranges were set by:
 *
 * `I = 3.43e6 * T * D^2 * K^(-D)`
 *
 * with `T` the threshold illuminance of a lamp at the limit of visibility, 2e-7 lux, `K` the
 * atmospheric transmissivity of 0.8 per mile, and `D` the range in nautical miles. A 6 mile
 * masthead light is 94 cd; a 3 mile sidelight is 12; a 2 mile sidelight is 4.3.
 *
 * So the ratios between lamps, and between a lamp and the moon, are arithmetic rather than
 * taste. What stays declared is one exposure per condition - how many lux draw as how bright -
 * and `render/scene.ts` holds it.
 *
 * **But read the word MINIMUM in the title of section 8, because it is doing work.** What the
 * formula gives is `I ... under service conditions` for a light that only just complies. A
 * real fitting is somewhere between that and the CEILING section 9 puts on it to stop lights
 * dazzling, and where in that band a particular lamp sat is not in any report this project has
 * met. So this is a lower envelope drawn as though it were the lamp: the 94-to-12 between a
 * masthead and a sidelight is the ratio of two floors rather than of two lamps, and nothing
 * here should be quoted as what a lamp measured.
 *
 * **This much is a floor. What `verticalSpread` does with it below is not** - see there.
 *
 * The transmissivity is a clear-weather figure and is the rule's own; a real night's air is
 * not stated in any report this project has met.
 */
export function minimumCandelaForRange(nauticalMiles: number): number {
  const threshold = 2e-7;
  const transmissivity = 0.8;
  return 3.43e6 * threshold * nauticalMiles ** 2 * transmissivity ** -nauticalMiles;
}

/**
 * How much of a navigation light's intensity goes this far below the horizontal.
 *
 * **A navigation light is a horizontal-beam fitting, and modelling it as a bare point source
 * lights the sea under the ship carrying it.** Annex I, section 10 specifies the vertical
 * spread: the required intensity from 5 degrees above the horizontal to 5 below, and at
 * least 60 per cent of it out to 7.5 degrees either way. Below that the rule requires
 * nothing, and a real fitting falls away fast - which is why a watchkeeper does not see her
 * own masthead light flooding the water ahead of her, and why the first version of this did.
 *
 * The shape between the rule's two points is this project's, and it is written as a
 * declaration rather than a fit to anything: 1 within five degrees, 0.6 at seven and a half,
 * and away to almost nothing by thirty.
 *
 * **The rule's two points are floors, and this curve is only one of them.** Section 10 says AT
 * LEAST the required intensity within five degrees, and AT LEAST sixty per cent of it within
 * seven and a half - two BANDS with a floor each, not two points on a curve. So:
 *
 * | depression | drawn | the floor section 10 guarantees | |
 * |---:|---:|---:|---|
 * | 0-5 deg | 1.000 | 1.00 | the floor exactly |
 * | 6 deg | 0.815 | 0.60 | **above it** - a complying lamp may be dimmer here |
 * | 7.5 deg | 0.600 | 0.60 | the floor again |
 * | below 7.5 | 0.54 down | none | **the rule requires nothing at all** |
 *
 * Which means the picture is a floor only for water within five degrees of a lamp's
 * horizontal, and that is not where the water is. A masthead twenty metres up lights the sea
 * hardest at 78 m, which is 14.4 degrees down, and the hundred-metre figure quoted everywhere
 * is 11.3 degrees down. **Every lit patch of sea in this renderer comes out of the region
 * Annex I leaves open**, so the light on the water is this project's curve rather than a bound
 * on anybody's lamp, and it may be brighter or dimmer than the fitting that was really there.
 * What survives as a floor is the intensity itself, out of section 8, and the shape within
 * five degrees - neither of which is what lights the sea.
 *
 * | depression | of the nominal |
 * |---:|---:|
 * | 0-5 deg | 1.000 |
 * | 7.5 deg | 0.600 |
 * | 10 deg | 0.360 |
 * | 15 deg | 0.130 |
 * | 30 deg | 0.0060 |
 * | 60 deg | 0.000013 |
 */
export function verticalSpread(depressionDegrees: number): number {
  const below = Math.abs(depressionDegrees);
  if (below <= ANNEX_I_FULL_DEGREES) return 1;
  return Math.exp(-BEAM_FALL_PER_DEGREE * (below - ANNEX_I_FULL_DEGREES));
}

/** Annex I section 10: the required intensity holds to five degrees either side. */
export const ANNEX_I_FULL_DEGREES = 5;
/** And at least sixty per cent of it to seven and a half. */
const ANNEX_I_AT_SEVEN_AND_A_HALF = 0.6;
/**
 * The rate that follows, per degree below the rule's full-intensity band.
 *
 * Exported because `render/lamps.ts` writes the same curve in GLSL and nothing in Node can
 * compile a shader to check it - so at least the two constants are one.
 */
export const BEAM_FALL_PER_DEGREE =
  Math.log(1 / ANNEX_I_AT_SEVEN_AND_A_HALF) / (7.5 - ANNEX_I_FULL_DEGREES);

/**
 * How brightly a lamp lights a patch of water, in lux.
 *
 * `E = I cos(incidence) / d^2`, and the cosine off a level surface is the lamp's height over
 * the slant range - so `E = I h / d^3`. **The cube is the part that was missing**: written as
 * an inverse square on the horizontal range, with no height in it, a ship's own masthead light
 * lit the sea for hundreds of metres ahead of her. It does not:
 *
 * | lamp | 50 m | 100 m | 300 m |
 * |---|---|---|---|
 * | 6 mile masthead, 20 m up | 0.012 lx | 0.0018 lx | 0.00007 lx |
 * | 3 mile sidelight, 8 m up | 0.0015 lx | 0.0002 lx | 0.00001 lx |
 *
 * **Those are with the beam pointed at the water, which it is not.** `verticalSpread` takes
 * the depression into account and cuts the near field away: the same masthead lights the sea
 * thirty metres ahead of its own ship at 0.00011 lx rather than 0.04, because that water lies
 * 33.7 degrees below its beam, where under three thousandths of it is left.
 *
 * Starlight is about 0.002 lx and a full moon 0.25. **The drawn figure is the one with the
 * beam profile in, and it is a quarter of starlight**: 0.00049 lx at a hundred metres,
 * peaking at 0.00053 about seventy-eight metres out where the beam grazes the surface, and a
 * fortieth of what the 41 per cent moon gave on the night of the reference case. That is the
 * scale it has to be drawn at. The table above is four times it at a hundred metres because
 * the table is the beam pointed at the water, and quoting the table as though it were the
 * picture is a mistake this file's readers have now made three times over.
 */
export function lampLuxOnWater(
  minimumCandela: number,
  lampHeightMetres: number,
  slantRangeMetres: number,
): number {
  if (slantRangeMetres <= 0) return 0;
  const height = Math.max(lampHeightMetres, 0);
  // How far below the horizontal this patch of water lies from the lamp, which is what
  // decides how much of the fitting's beam reaches it at all.
  const depression = (Math.asin(Math.min(height / slantRangeMetres, 1)) * 180) / Math.PI;
  return (minimumCandela * verticalSpread(depression) * height) / slantRangeMetres ** 3;
}

/**
 * How far a lamp's streak is allowed to reach, against the range the lamp itself must carry.
 *
 * **A reflection is dimmer than the lamp**, so a streak visible where the light is not would
 * be the picture inventing a detection - which is the one thing #39 named as making it a lie.
 *
 * **The candela is not what is missing here.** Rule 22's range gives it, through Annex I
 * section 8, and `minimumCandelaForRange` above computes it. What no rule settles is what
 * happens to the light after it leaves the lamp: how much of it the sea throws back rather
 * than absorbing, how much the air takes on two legs instead of one, and how much has to
 * arrive before an eye at night calls it something. Three unknowns multiplied together, none
 * of them in any source this format reads. So the inequality is declared and enforced rather
 * than derived, at half the lamp's own range.
 *
 * Half is a choice. What is not a choice is that it must be less than one.
 */
export const STREAK_REACH_OF_NOMINAL = 0.5;
