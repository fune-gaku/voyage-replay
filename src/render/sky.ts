/**
 * The sky, as a function of the direction you look in - which is the only form the water can
 * use it in.
 *
 * There is no environment map here and no extra pass: one gradient, evaluated twice from the
 * same uniforms. The water mixes towards it through the reflected ray, by Schlick's
 * approximation (`render/waves.ts`); the frame above the waterline takes it through the view
 * ray, off the inside of a dome. Before #37 it was ONE colour in both places, so the
 * reflection carried no information - it made the waves visible and said nothing about the
 * sky or where the moon was - and before #53 the dome was not there at all, which left the
 * upper half of every daylight frame painted in the palest end of a gradient it was not part
 * of.
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

import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from "three";

import type { Lit } from "../core/illumination.js";

export interface SkyUniforms {
  /** Towards the body, in world axes. Zero length where no body is up. */
  uSkyBody: { value: Vector3 };
  /**
   * The body's lobe: its peak radiance against the sky's own, and its own angular radius.
   * A radius of zero draws no body at all.
   *
   * **The width is not in here, because it is not the same everywhere.** The normals carry
   * some of the sea's slope and how much depends on the range - the shading band-limits each
   * component and then fades the lot to flat past a few kilometres - so what the lobe has to
   * make up is a per-fragment quantity. See `uSeaSlope`.
   */
  uSkyBodyLobe: { value: Vector2 };
  /**
   * The slope variance the sea's reflections have to add up to, or **-1 where no sea is
   * stated** and nothing may be mirrored at all.
   *
   * Its own uniform rather than a third component of the lobe, because it is a fact about
   * the water and not about the body: the lamps reflect in the same sea, and a moonless
   * night - which is when a lamp's streak is the whole picture - has no body to hang it on.
   */
  uSeaSlope: { value: number };
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
 * What each body puts on a horizontal surface, in lux, before the sea does anything with it.
 *
 * The standard figures. The moon's phase multiplies the first - a half moon is a ninth of a
 * full one, which `core/illumination.ts` computes - and the sun does not need a second figure
 * because nothing draws both at once.
 */
const FULL_MOON_LUX = 0.25;
const SUNLIGHT_LUX = 60000;

/**
 * The quarter a specular reflection off a surface of small slopes carries.
 *
 * From the glitter radiance of a point source - the Jacobian between the slope distribution
 * and the reflected direction - and it is a quarter for the same reason a facet tilted by an
 * angle turns its ray by twice that. **The same figure the lamps use**, because the moon and
 * a sidelight are reflected in the same water and by the same arithmetic.
 */
const SPECULAR_GEOMETRY = 0.25;

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
export function skyColourAt(
  towards: Vector3,
  uniforms: SkyUniforms,
  carriedSlopeVariance = 0,
): Color {
  const sky = skyGradientAt(towards, uniforms);
  if (uniforms.uSeaSlope.value < 0) return sky;
  const width = lobeWidth(
    uniforms.uSeaSlope.value,
    carriedSlopeVariance,
    uniforms.uSkyBodyLobe.value.y,
  );
  return sky.add(bodyGlowAt(towards, uniforms, width));
}

/** The gradient alone: what the sky and its reflection have to agree about. */
export function skyGradientAt(towards: Vector3, uniforms: SkyUniforms): Color {
  const up = Math.max(towards.y, 0);
  return uniforms.uSkyHorizon.value
    .clone()
    .lerp(uniforms.uSkyZenith.value, Math.pow(up, 1 / HORIZON_POWER));
}

/**
 * The body at a given width, which the sky and the water are entitled to differently.
 *
 * A Gaussian in the angle between the two, which is what a slope distribution convolved with
 * a small disc comes to. `acos` of the dot product rather than the chord, since the lobe can
 * be tens of degrees wide and the two part company well inside that.
 */
export function bodyGlowAt(towards: Vector3, uniforms: SkyUniforms, width: number): Color {
  const lobe = uniforms.uSkyBodyLobe.value;
  if (lobe.y <= 0 || uniforms.uSkyBody.value.lengthSq() === 0) return new Color(0, 0, 0);
  const away = Math.acos(Math.min(Math.max(towards.dot(uniforms.uSkyBody.value), -1), 1));
  const density = Math.exp(-0.5 * (away / width) ** 2) / (2 * Math.PI * width * width);
  const glow = SPECULAR_GEOMETRY * lobe.x * density;
  return new Color(glow, glow, glow);
}

/**
 * What the SKY shows in a direction: the gradient and the body at its own size.
 *
 * The mirror of `SKY_DOME_GLSL`, and the reason the guard above is not repeated here - the
 * body is up whether or not anybody wrote down a sea.
 */
export function skyDomeColourAt(towards: Vector3, uniforms: SkyUniforms): Color {
  return skyGradientAt(towards, uniforms).add(
    bodyGlowAt(towards, uniforms, uniforms.uSkyBodyLobe.value.y),
  );
}

/**
 * How wide anything reflected in this sea is spread, HERE: whatever the normals under this
 * fragment are not carrying.
 *
 * **The mirror of `glitterSpreadRadians`, and the reason it is not simply called.** The
 * shading drops each wave component where the range or the frame runs out of pixels for it,
 * and fades the lot to flat past a few kilometres - so a lane computed against the whole
 * drawn spectrum would narrow with distance and with the size of somebody's window, and end
 * as a mirror spot where the sea is drawn flat. The sea's total slope is held instead, and
 * what the normals no longer supply is given back to whatever is being reflected.
 *
 * The source's own angular radius is under it, so a sea stated calm still mirrors a disc -
 * and a lamp, whose disc is nothing, still gets a floor rather than a division by zero.
 *
 * **Shared with `render/lamps.ts`**, because the spread belongs to the water and not to what
 * is being reflected in it. Two copies would draw a moon and a sidelight in different seas.
 */
export function lobeWidth(
  seaSlopeVariance: number,
  carriedSlopeVariance: number,
  sourceRadiusRadians: number,
): number {
  const missing = Math.max(seaSlopeVariance - carriedSlopeVariance, 0);
  return Math.hypot(Math.sqrt(2 * missing), Math.max(sourceRadiusRadians, NARROWEST_LOBE));
}

/**
 * The narrowest a reflection is drawn, whatever it is a reflection of.
 *
 * A hundredth of a radian is half a degree - about a pixel at the widths this renders at -
 * and it is a floor against dividing by zero rather than a claim about anything. A lamp's
 * filament at two miles subtends a millionth of that.
 */
const NARROWEST_LOBE = 0.001;

/**
 * The same, for the fragment shader. `skyTowards` takes a unit world direction.
 *
 * Kept as a string beside the function above so the two are edited together. `render/waves.ts`
 * pastes it in ahead of its own chunks.
 */
export const SKY_GLSL = `
uniform vec3 uSkyBody;
uniform vec2 uSkyBodyLobe;
uniform float uSeaSlope;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;

// The gradient alone, which is the same looking at the sky and looking at its reflection.
// **The two have to agree at the waterline**: water at a grazing angle hands back the sky
// just above the horizon, so a second definition would show as a seam along it.
vec3 skyGradient( vec3 towards ) {
  float up = max( towards.y, 0.0 );
  return mix( uSkyHorizon, uSkyZenith, pow( up, ${(1 / HORIZON_POWER).toFixed(4)} ) );
}

// The spread of anything reflected in this water, given what these normals still carry.
// Shared with the lamps below: the width belongs to the sea, not to what is in it.
float lobeWidth( float carried, float radius ) {
  float missing = max( uSeaSlope - carried, 0.0 );
  float floored = max( radius, ${NARROWEST_LOBE.toFixed(4)} );
  return sqrt( 2.0 * missing + floored * floored );
}

// The body, at whatever width the caller is entitled to. **Separate from the gradient**
// because the sky and the water are entitled to different ones: the sea spreads a
// reflection by its own slope, and the sky shows the disc at its own half degree.
vec3 bodyGlow( vec3 towards, float width ) {
  if ( uSkyBodyLobe.y <= 0.0 || dot( uSkyBody, uSkyBody ) == 0.0 ) return vec3( 0.0 );
  float away = acos( clamp( dot( towards, uSkyBody ), -1.0, 1.0 ) );
  return vec3( uSkyBodyLobe.x * exp( -0.5 * pow( away / width, 2.0 ) ) );
}

// What the WATER hands back. The body is dropped where no sea is stated - a mirror-sharp
// one on water this tool decided to draw flat would assert a calm nobody recorded - and
// that guard is the water's, which is why the sky below does not share it.
vec3 skyTowards( vec3 towards, float carried ) {
  vec3 sky = skyGradient( towards );
  if ( uSeaSlope < 0.0 ) return sky;
  return sky + bodyGlow( towards, lobeWidth( carried, uSkyBodyLobe.y ) );
}
`;

/**
 * The sky itself, for the frame above the waterline.
 *
 * **The body is drawn whether or not a sea is stated.** The guard in `skyTowards` is about
 * not asserting a calm nobody recorded, which is an argument about water; the moon is up
 * regardless. And it is drawn at its own half degree rather than spread by the sea, because
 * nothing is spreading it - that is what a disc in the sky looks like.
 */
export const SKY_DOME_GLSL = `
varying vec3 vSkyDirection;
void main() {
  vec3 towards = normalize( vSkyDirection );
  gl_FragColor = vec4( skyGradient( towards ) + bodyGlow( towards, uSkyBodyLobe.y ), 1.0 );
}
`;

/**
 * How far out the sky is put.
 *
 * **Inside the bridge camera's far plane**, which is 80 km, or the dome is clipped away and
 * the background shows through it. Fifty is far enough that an eye moving a few kilometres
 * across a scenario sees no parallax in it - the dome follows the eye anyway, which is what
 * actually settles that, and this only has to be large against the water disc in front of it.
 */
const SKY_DOME_METRES = 50_000;

/**
 * The sky, as something to draw: a sphere seen from the inside, centred on the eye.
 *
 * **It shares the water's uniform objects rather than copies of them**, so the two cannot
 * come to describe different skies - which would show first at the waterline, where water at
 * a grazing angle hands back very nearly the sky just above it.
 *
 * Unfogged, and that is a simplification worth naming: `buildFog` puts its far plane at three
 * times the view when nothing states a visibility, so a fogged dome would be one flat fog
 * colour in every scenario and nothing here would be fixed. A fog you can see a clear sky
 * above is not a fog, and `ui/panels.ts` says so.
 */
export function buildSkyDome(uniforms: SkyUniforms): Mesh {
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, { value: unknown }>,
    vertexShader: `
varying vec3 vSkyDirection;
void main() {
  vSkyDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`,
    fragmentShader: `${SKY_GLSL}${SKY_DOME_GLSL}`,
    side: BackSide,
    // Behind everything and writing no depth of its own: a sky that occluded the water would
    // be a sky in front of the sea.
    depthWrite: false,
    fog: false,
  });

  const dome = new Mesh(new SphereGeometry(SKY_DOME_METRES, 32, 16), material);
  dome.name = "sky";
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

export function makeSkyUniforms(): SkyUniforms {
  return {
    uSkyBody: { value: new Vector3() },
    uSkyBodyLobe: { value: new Vector2() },
    uSeaSlope: { value: -1 },
    uSkyHorizon: { value: new Color(0x000000) },
    uSkyZenith: { value: new Color(0x000000) },
  };
}

/**
 * Point the sky at a body, or at none.
 *
 * The variance is null where the file states no sea: there is then no slope to widen the
 * body with, and a mirror-sharp moon on water this tool decided to draw flat would assert a
 * calm nobody recorded. The gradient stays and the path does not appear - **but the body is
 * still stored**, because the sky above the waterline shows it either way. The water's own
 * guard is in `skyTowards`.
 *
 * Zero is a different answer - a sea stated calm, on somebody's authority - and it leaves the
 * body its own half degree, which is the mirror image calm water gives.
 */
export function setSkyBody(
  uniforms: SkyUniforms,
  lit: Lit | null,
  measuredSlopeVariance: number | null,
): void {
  // **Each is set whether or not the other is there.** A moonless night is when a lamp's
  // streak is the whole picture and the lamps reflect in the same water; and a body is up
  // whether or not anybody wrote down a sea, which the sky above the waterline draws even
  // where the water is told to reflect nothing.
  uniforms.uSeaSlope.value = measuredSlopeVariance ?? -1;
  if (!lit) {
    uniforms.uSkyBody.value.set(0, 0, 0);
    uniforms.uSkyBodyLobe.value.set(0, 0);
    return;
  }
  uniforms.uSkyBody.value.copy(towardsBody(lit));
  // **The body's own illuminance, in lux**: a full moon puts a quarter of one on a
  // horizontal surface and the sun about sixty thousand, and the phase between them comes
  // out of `core/illumination.ts`. The shader turns it into the luminance of the path by the
  // same slope density the lamps use, so the moon and a sidelight are on one scale.
  uniforms.uSkyBodyLobe.value.set(
    lit.body === "sun" ? SUNLIGHT_LUX : FULL_MOON_LUX * lit.relativeBrightness,
    BODY_ANGULAR_RADIUS_RADIANS,
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
