/**
 * The streaks a lamp lays on the water, which are the one reflection in this picture that is
 * evidence rather than decoration.
 *
 * A hull reflected in daylight is a broken column of light nobody reads anything off. A red
 * sidelight at two miles laying a red path towards an observer is a signature: it extends the
 * light's reach, and it arrives on a bearing.
 *
 * ## The same machinery as the moon, with the distance put back
 *
 * `render/sky.ts` compares the reflected ray against the DIRECTION of a body, because a body
 * is at infinity. A lamp is not, so it is compared against the direction from this fragment
 * to the lamp - which is the specular condition itself. That the streak then lies between the
 * observer's feet and the lamp's, and stretches towards whoever is looking, falls out of where
 * that condition is satisfied. No geometry of its own.
 *
 * The spread is the sea's and comes from `lobeWidth` in `render/sky.ts`, shared rather than
 * copied: the moon and a sidelight are reflected in the same water, and two widths would be
 * two seas.
 *
 * ## A lamp does two things to water, and only one of them is a reflection
 *
 * The streak is the lamp's image in a rough mirror: directional by construction, visible only
 * where the reflected ray points at the source, and therefore running from the lamp towards
 * whoever is looking. **The pool is the water LIT by the lamp** - irradiance landing on the
 * surface and being scattered back - and that is there from every bearing at once. Drawing
 * only the first makes a lamp look like it shines at the observer and nowhere else.
 *
 * The arc shapes the pool, which is where Rule 21 becomes visible on the water: an all-round
 * light throws a full circle, a sidelight a 112.5 degree wedge on its own side, a masthead
 * 225 degrees ahead. Both halves answer the arc at the water rather than at the eye.
 *
 * ## The three ways this could lie
 *
 * - **The arc is tested at the WATER, not at the eye.** A lamp lights only its own sector, so
 *   what decides whether a patch of sea carries its colour is where that patch is, measured
 *   from the bow of the ship carrying the lamp. Testing the eye instead lays a red streak
 *   ahead of a ship seen from astern - the same 180-degree error `visibleLights` warns about,
 *   and just as plausible in a still frame.
 * - **The streak must die before the lamp does.** A reflection is dimmer than its source, so
 *   one that outlived the light would invent a detection. The cut-off is applied to the whole
 *   path - lamp to water to eye - which by the triangle inequality is never shorter than the
 *   lamp's own range to that eye, so the rule holds at every geometry rather than at the ones
 *   somebody thought of. `core/illumination.ts` sets it at half the Rule 22 range.
 * - **A mark's streak carries the rhythm.** A steady lane under a `Q(9)` is a worse claim
 *   than no lane at all, because the rhythm is what identifies the mark. The lamp's own
 *   on/off decides whether it is uploaded at all.
 */

import { Color, Vector4 } from "three";

import {
  ANNEX_I_FULL_DEGREES,
  BEAM_FALL_PER_DEGREE,
  STREAK_REACH_OF_NOMINAL,
} from "../core/illumination.js";

/** The rule's own full-intensity half-angle, in radians, for the shader. */
const FULL_BEAM_RADIANS = (ANNEX_I_FULL_DEGREES * Math.PI) / 180;
/** And how fast it falls below that, per radian. */
const BEAM_FALL_PER_RADIAN = (BEAM_FALL_PER_DEGREE * 180) / Math.PI;

/**
 * How many lamps the water can reflect at once.
 *
 * A shader's array length is a constant, so this is one. Sixteen holds the reference case
 * several times over - two ships of five lights and the marks between them - and what does
 * not fit is dropped, which `ui/panels.ts` reports rather than swallowing: a page saying the
 * lights were drawn over a picture missing some of them is the fault this project keeps
 * meeting.
 */
export const SHADER_LAMPS = 16;

export interface LitLamp {
  /** Where the lamp is, in the scene's axes. */
  at: { x: number; y: number; z: number };
  colour: Color;
  /**
   * How strong the lamp is, in candela, **computed from the range Rule 22 gives it** by
   * Annex I's own relation - see `candelaFromNominalRange`. A 6 mile masthead is 94 cd, a
   * 3 mile sidelight 12.
   *
   * The lamp's own figure, with no exposure in it: what a candela becomes on screen belongs
   * to the drawn condition, and `render/scene.ts` holds that.
   */
  candela: number;
  /** Which way the ship carrying it heads, in degrees true. Irrelevant to an all-round light. */
  headingDegreesTrue: number;
  /** The arc it shows over, as relative bearings clockwise from that bow. */
  arcStartDegrees: number;
  arcEndDegrees: number;
  /** Rule 22's range for this light, in metres. Both the streak and the pool die inside it. */
  nominalRangeMetres: number;
}

export interface LampUniforms {
  /**
   * (x, y, z, relative brightness) per lamp. **The lamp's own figure, with no exposure in
   * it**: zero is an empty slot, one is a lamp that is simply lit.
   *
   * The exposures are the two scalars below, and they are separate because the two things a
   * lamp does to water are. Folding one of them in here - which is what this held at first -
   * made the pool come out at `streak * pool` rather than at `pool`, and turning the streak
   * off took the light the lamp casts with it.
   */
  uLamp: { value: Vector4[] };
  uLampColour: { value: Color[] };
  /** (heading, arc start, arc end) in radians, and the lamp's own range in metres. */
  uLampArc: { value: Vector4[] };
  /**
   * How much of the light landing on the water comes back out of it - the sea's own diffuse
   * reflectance, which is a few per cent for clean water and depends on what is in it. A
   * declared figure, but a reflectance rather than a brightness: the lux are computed.
   */
  uLampPool: { value: number };
  /**
   * The same for the specular side. Near one, because Schlick's term is applied outside this
   * and the streak is the lamp seen in the water rather than light coming out of it.
   */
  uLampStreak: { value: number };
  /**
   * **What a lux draws as.** The one figure per condition that maps the computed illuminance
   * onto the screen - and it is shared with the body's own exposure, so that a lamp and the
   * moon are drawn on one scale. See `Palette.luxToScreen`.
   */
  uLampLux: { value: number };
}

export function makeLampUniforms(): LampUniforms {
  return {
    uLamp: { value: Array.from({ length: SHADER_LAMPS }, () => new Vector4()) },
    uLampColour: { value: Array.from({ length: SHADER_LAMPS }, () => new Color()) },
    uLampArc: { value: Array.from({ length: SHADER_LAMPS }, () => new Vector4()) },
    uLampPool: { value: 0 },
    uLampStreak: { value: 0 },
    uLampLux: { value: 0 },
  };
}

/**
 * Load the lit lamps into the uniforms. Anything past `SHADER_LAMPS` lays no streak.
 *
 * `exposure` is how bright the brightest streak and the brightest pool may draw in this
 * condition - declared figures per drawn condition, for the reason `Palette.streak` gives.
 *
 * **What does not fit is the page's business, not a log line.** `ui/panels.ts` counts the
 * lamps a scenario can light against this same constant and says so, because a picture
 * missing streaks under a page that lists every light is the two disagreeing - and the count
 * has to be knowable without watching a particular frame go by.
 */
export function setLamps(
  uniforms: LampUniforms,
  lamps: LitLamp[],
  exposure: { streak: number; pool: number; luxToScreen: number },
): void {
  uniforms.uLampPool.value = exposure.pool;
  uniforms.uLampStreak.value = exposure.streak;
  uniforms.uLampLux.value = exposure.luxToScreen;
  for (let i = 0; i < SHADER_LAMPS; i += 1) {
    const lamp = lamps[i];
    const slot = uniforms.uLamp.value[i];
    const arc = uniforms.uLampArc.value[i];
    if (!slot || !arc) continue;
    if (!lamp) {
      slot.set(0, 0, 0, 0);
      continue;
    }
    // The lamp's own figure, in candela. The exposures are uniforms of their own, so that
    // turning one of them down cannot move the other - they are two different things a lamp
    // does - and so that neither is folded into a number that means something else.
    slot.set(lamp.at.x, lamp.at.y, lamp.at.z, lamp.candela);
    uniforms.uLampColour.value[i]?.copy(lamp.colour);
    arc.set(
      (lamp.headingDegreesTrue * Math.PI) / 180,
      (lamp.arcStartDegrees * Math.PI) / 180,
      (lamp.arcEndDegrees * Math.PI) / 180,
      lamp.nominalRangeMetres,
    );
  }
}

/**
 * Whether a point on the water is inside a lamp's arc.
 *
 * **The bearing of the WATER from the lamp**, measured from the bow of the ship carrying it -
 * the same convention `isWithinArc` takes, and the same one that is 180 degrees wrong if the
 * two ends are swapped. The scene's axes are local ENU with y up and z running south, so a
 * true bearing is `atan2(east, north)` with north as `-z`.
 *
 * Half-open, `[start, end)`, so the four Rule 21 arcs partition the horizon exactly as they
 * do in `actors/vessel/lights.ts`. An all-round light is `[0, 360)` and every bearing is in.
 */
export function litFromLamp(
  at: { x: number; z: number },
  lamp: { at: { x: number; z: number }; headingDegreesTrue: number },
  arc: { startDegrees: number; endDegrees: number },
): boolean {
  const trueBearing = (Math.atan2(at.x - lamp.at.x, -(at.z - lamp.at.z)) * 180) / Math.PI;
  const relative = wrap(trueBearing - lamp.headingDegreesTrue);
  const start = wrap(arc.startDegrees);
  const end = wrap(arc.endDegrees) || 360;
  return start < end ? relative >= start && relative < end : relative >= start || relative < end;
}

function wrap(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The GLSL, beside the rule it mirrors. `render/waves.ts` pastes it after `SKY_GLSL`, whose
 * `lobeWidth` it calls.
 *
 * The loop is over a constant length with a peak of zero standing for an unlit slot, the same
 * shape `setWaves` uses for components - simpler than a count uniform, and the loop has to be
 * constant anyway.
 */
export const LAMPS_GLSL = `
uniform vec4 uLamp[${SHADER_LAMPS}];
uniform vec3 uLampColour[${SHADER_LAMPS}];
uniform vec4 uLampArc[${SHADER_LAMPS}];
uniform float uLampPool;
uniform float uLampStreak;
uniform float uLampLux;

// What the lamps do to this patch of water: its own image of each of them, and the light
// each of them lands on it. The second comes back through the out parameter, because it is
// not a reflection and so must not take the Fresnel factor.
vec3 lampsTowards( vec3 reflected, vec3 at, vec3 up, float carried, out vec3 lit ) {
  vec3 sum = vec3( 0.0 );
  lit = vec3( 0.0 );
  if ( uSeaSlope < 0.0 ) return sum;
  float width = lobeWidth( carried, 0.0 );
  for ( int i = 0; i < ${SHADER_LAMPS}; i ++ ) {
    vec4 lamp = uLamp[ i ];
    if ( lamp.w <= 0.0 ) continue;
    vec3 towards = lamp.xyz - at;
    // **The whole way round: lamp to water to eye.** A reflected ray takes two sides of a
    // triangle where the direct one takes the third, so this is never shorter than the
    // lamp's own range to the observer - and the cut-off below therefore puts the streak out
    // before the lamp goes out, whatever the geometry. Measured on the first leg alone,
    // water close under a lamp carries a streak to an eye standing beyond the light's own
    // range, which is the picture inventing a detection.
    float path = length( towards ) + distance( at, cameraPosition );
    float reach = uLampArc[ i ].w * ${STREAK_REACH_OF_NOMINAL.toFixed(2)};
    if ( path >= reach ) continue;

    // The bearing of THIS WATER from the lamp, off the bow of the ship carrying it.
    float bearing = atan( at.x - lamp.x, -( at.z - lamp.z ) ) - uLampArc[ i ].x;
    float relative = mod( bearing, 6.2831853 );
    float start = uLampArc[ i ].y;
    float end = uLampArc[ i ].z;
    bool inside = start < end
      ? ( relative >= start && relative < end )
      : ( relative >= start || relative < end );
    if ( !inside ) continue;

    vec3 toLamp = normalize( towards );
    float slant = max( length( towards ), 1.0 );
    float landing = max( dot( toLamp, up ), 0.0 );

    // **A navigation light is a horizontal-beam fitting.** Annex I section 10 fixes the
    // intensity from five degrees above the horizontal to five below and sixty per cent of
    // it at seven and a half; below that a real one falls away fast. Left out - which is how
    // this went in - a ship's own masthead light floods the sea at her feet, where the beam
    // is not pointed at all.
    float depression = asin( clamp( landing, 0.0, 1.0 ) );
    float spread = depression <= ${FULL_BEAM_RADIANS.toFixed(5)}
      ? 1.0
      : exp( -${BEAM_FALL_PER_RADIAN.toFixed(4)} * ( depression - ${FULL_BEAM_RADIANS.toFixed(5)} ) );

    // Smoothed to nothing at the reach, or the light would end at a visible edge.
    float t = clamp( path / reach, 0.0, 1.0 );
    float fall = 1.0 - t * t * ( 3.0 - 2.0 * t );

    // **Both scale with the light reaching THIS patch of water**, which is the lamp's
    // intensity in this direction over the distance to it. That is Cox and Munk's glitter
    // radiance for a point source - intensity times the slope density over the square of the
    // distance - and it is not the lamp's brightness
    // at the eye: a lane is made of water lit by the lamp, patch by patch, and the eye only
    // decides which patches are pointing at it. Scaled by the distance to the eye instead,
    // every lamp lays one lane of one brightness and the three on a ship become one.
    float reaching = lamp.w * spread / ( slant * slant );

    // The reflection takes no incidence cosine - a mirror does not care how obliquely the
    // light arrives, only where it goes.
    float away = acos( clamp( dot( reflected, toLamp ), -1.0, 1.0 ) );
    sum += uLampColour[ i ] * uLampStreak * uLampLux * reaching * fall
      * exp( -0.5 * pow( away / width, 2.0 ) );

    // The pool does, because that is what Lambert's law is: light spread over the area it
    // falls on. There from every bearing, where the streak is only where the geometry lines up.
    lit += uLampColour[ i ] * uLampPool * uLampLux * reaching * landing * fall;
  }
  return sum;
}
`;
