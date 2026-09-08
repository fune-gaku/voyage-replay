/**
 * The sky, as a function of the direction you look in - which is the only form the water can
 * use it in.
 *
 * There is no sky in this scene. The background is a flat colour and there is no dome, no
 * environment map and no extra pass; the only place a sky appears is in the water, where
 * `render/waves.ts` mixes towards it by Schlick's approximation. Until now it mixed towards
 * ONE colour, so the reflection carried no information: it made the waves visible and said
 * nothing about the sky or where the moon was.
 *
 * ## Two things in it, and only one is evidence
 *
 * - **The body's position and the width of the path it lays are computed.** The first from
 *   the clock and the place (`core/celestial.ts`), the second from Cox and Munk's measured
 *   slope (`core/illumination.ts`). A path is directional, and a target on its bearing is
 *   seen against it or lost in it, which is the kind of thing a report argues about.
 * - **The gradient and the brightness are chosen.** Cloud decides how much light reaches the
 *   sea and no report states it, and a two-colour gradient is not a sky model - Preetham and
 *   Hosek both need a turbidity nobody writes down. `ui/panels.ts` separates the two.
 *
 * ## Written twice, deliberately
 *
 * The GLSL below and `skyColourAt` are the same function. Nothing in Node can compile a
 * shader to ask it what it draws, so the rule is written next to its copy and tested here -
 * the shape `displacedFraction` and `meshCarries` already use in `waves.ts`.
 */

import { Color, Vector3 } from "three";

import type { Lit } from "../core/illumination.js";

export interface SkyUniforms {
  /** Towards the body, in world axes. Zero length where no body is up. */
  uSkyBody: { value: Vector3 };
  /**
   * Peak radiance of the body's lobe against the sky's own, and the angular width of that
   * lobe in radians. Width zero draws no path at all.
   */
  uSkyBodyLobe: { value: Vector3 };
  /** What the sky is at the horizon, and what it is overhead. */
  uSkyHorizon: { value: Color };
  uSkyZenith: { value: Color };
}

/**
 * How the two ends of the gradient are reached.
 *
 * A real clear sky is darkest overhead and pales towards the horizon, because a grazing line
 * of sight runs through far more air. The curve is nearer to the horizon than half way for
 * the same reason, so the paling is confined to the lowest part of the sky rather than being
 * spread evenly up it - which is what a reflection off water mostly sees.
 */
const HORIZON_POWER = 2.5;

/**
 * The brightest a body's lobe is drawn against the sky behind it.
 *
 * **A ceiling rather than a measurement, and the one number here with no source.** The
 * renderer is not photometrically calibrated - the night palette is a chosen dark blue - so
 * an absolute radiance would be a figure with nothing behind it. What is honest is the
 * RATIO: the sun against the moon, and one moon's phase against another's, both of which
 * come out of `core/illumination.ts`. This decides only how bright the brightest possible
 * body is allowed to draw, and `ui/panels.ts` says it is a bound and not a reading.
 *
 * Two and a half rather than nine, which was the first figure here: a Gaussian this wide
 * still carries a thousandth of its peak ninety degrees away, and a peak of nine therefore
 * lifted the WHOLE sky by about a third of the night palette's own brightness. A path that
 * brightens the sky behind it is not a path. The core clips to white on a full moon, which
 * is what a full moon's glitter does to an eye and to a camera.
 */
const BRIGHTEST_LOBE = 2.5;

/** Relative brightness at which a body is drawn at `BRIGHTEST_LOBE`. Anything above clamps. */
const FULL_MOON_LOBE = 1;

/**
 * The sun and the moon are both about half a degree across, which is why eclipses work.
 *
 * It is the floor under the lobe's width: on a sea stated flat there is no slope to spread
 * the reflection, and what is left is the disc itself, mirrored. Convolved in quadrature with
 * the sea's own spread, where there is one, it changes nothing at all - a quarter of a degree
 * against twenty-six.
 */
const BODY_ANGULAR_RADIUS_RADIANS = (0.265 * Math.PI) / 180;

/**
 * The sky in one direction: the gradient, plus the body's lobe where one is up.
 *
 * `towards` must be a unit vector in world axes, where y is up. Directions below the horizon
 * return the horizon colour rather than nothing - a reflection off the back of a wave can
 * point downwards, and there is no ground under this sea to return instead.
 */
export function skyColourAt(towards: Vector3, uniforms: SkyUniforms): Color {
  const up = Math.max(towards.y, 0);
  const sky = uniforms.uSkyHorizon.value
    .clone()
    .lerp(uniforms.uSkyZenith.value, Math.pow(up, 1 / HORIZON_POWER));

  const lobe = uniforms.uSkyBodyLobe.value;
  const body = uniforms.uSkyBody.value;
  if (lobe.y <= 0 || body.lengthSq() === 0) return sky;

  // A Gaussian in the angle between the two, which is what a slope distribution convolved
  // with a small disc comes to. `acos` of the dot product rather than the chord, since the
  // lobe is tens of degrees wide and the two part company well inside that.
  const away = Math.acos(Math.min(Math.max(towards.dot(body), -1), 1));
  const glow = lobe.x * Math.exp(-0.5 * (away / lobe.y) ** 2);
  return sky.add(new Color(glow, glow, glow));
}

/**
 * The same, for the fragment shader. `skyTowards` takes a unit world direction.
 *
 * Kept as a string beside the function above so the two are edited together. `render/waves.ts`
 * pastes it in ahead of its own chunks.
 */
export const SKY_GLSL = `
uniform vec3 uSkyBody;
uniform vec3 uSkyBodyLobe;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;

vec3 skyTowards( vec3 towards ) {
  float up = max( towards.y, 0.0 );
  vec3 sky = mix( uSkyHorizon, uSkyZenith, pow( up, ${(1 / HORIZON_POWER).toFixed(4)} ) );
  if ( uSkyBodyLobe.y <= 0.0 || dot( uSkyBody, uSkyBody ) == 0.0 ) return sky;
  float away = acos( clamp( dot( towards, uSkyBody ), -1.0, 1.0 ) );
  float glow = uSkyBodyLobe.x * exp( -0.5 * pow( away / uSkyBodyLobe.y, 2.0 ) );
  return sky + vec3( glow );
}
`;

export function makeSkyUniforms(): SkyUniforms {
  return {
    uSkyBody: { value: new Vector3() },
    uSkyBodyLobe: { value: new Vector3() },
    uSkyHorizon: { value: new Color(0x000000) },
    uSkyZenith: { value: new Color(0x000000) },
  };
}

/**
 * Point the sky at a body, or at none.
 *
 * `spreadRadians` is null where the file states no sea: there is then no slope to widen the
 * body with, and a mirror-sharp moon on water this tool decided to draw flat would assert a
 * calm nobody recorded. The gradient stays; the path does not appear.
 *
 * Zero is a different answer - a sea stated calm, on somebody's authority - and it leaves the
 * body its own half degree, which is the mirror image calm water gives.
 */
export function setSkyBody(
  uniforms: SkyUniforms,
  lit: Lit | null,
  spreadRadians: number | null,
): void {
  if (!lit || spreadRadians === null) {
    uniforms.uSkyBody.value.set(0, 0, 0);
    uniforms.uSkyBodyLobe.value.set(0, 0, 0);
    return;
  }
  uniforms.uSkyBody.value.copy(towardsBody(lit));
  uniforms.uSkyBodyLobe.value.set(
    BRIGHTEST_LOBE * Math.min(lit.relativeBrightness / FULL_MOON_LOBE, 1),
    Math.hypot(spreadRadians, BODY_ANGULAR_RADIUS_RADIANS),
    0,
  );
}

/**
 * A unit vector towards a body, in the scene's axes.
 *
 * The scene is local ENU with y up: x runs east, z runs SOUTH, so a true bearing turns into
 * `(sin, -cos)` in the horizontal plane. Getting this backwards puts the moon on the opposite
 * side of the sky and lays the path away from where it belongs, which reads as plausible -
 * the same failure as the sidelight arcs, and as hard to see in a still frame.
 */
export function towardsBody(lit: Lit): Vector3 {
  const altitude = (lit.altitudeDegrees * Math.PI) / 180;
  const azimuth = (lit.azimuthDegrees * Math.PI) / 180;
  const flat = Math.cos(altitude);
  return new Vector3(flat * Math.sin(azimuth), Math.sin(altitude), -flat * Math.cos(azimuth));
}
