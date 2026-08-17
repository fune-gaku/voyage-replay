/**
 * Daylight from the clock, not from a switch.
 *
 * The first version of this prototype had three named palettes and a key to cycle them,
 * which answers "can it do daytime" with a yes that means nothing: a scene lit from a fixed
 * direction is a scene where the hills are shaded by whatever looked good. On a bridge that
 * is not decoration - which side of a headland is in sun, and whether the other ship is
 * up-sun of you, are things a report argues about.
 *
 * So it reads `core/conditions.ts`, which is the layer `CLAUDE.md` says the renderer is
 * supposed to read, and takes the sun's real altitude and bearing for the instant and the
 * place. This module is the shape the unwritten `core/illumination.ts` and
 * `render/lighting.ts` pair would have: conditions in, radiance-ish numbers out.
 *
 * What is honest here and what is not:
 *
 * - **Directions are computed.** The sun's bearing and altitude come from the ephemeris, and
 *   at night the moon's do.
 * - **Amounts are not.** The intensities and colours below are a hand-made ramp that looks
 *   like dusk; nothing derives them from irradiance. Moonlight in particular is set flat,
 *   because `illuminatedFraction` is not brightness - a full moon is about ten times a half
 *   moon, not twice - and scaling by it would be wrong by most of an order of magnitude.
 * - **Cloud is not in it at all.** Every value here is the clear-sky ceiling.
 */

import { Color, Vector3 } from "three";

import type { Conditions } from "../../src/core/conditions.js";
import { SUNSET_ALTITUDE_DEGREES } from "../../src/core/conditions.js";

export interface Lighting {
  sky: Color;
  land: Color;
  water: Color;
  ambient: number;
  keyIntensity: number;
  /** Unit vector pointing from the scene TOWARDS the light. */
  keyDirection: Vector3;
  hazeDensity: number;
}

/** One rung of the ramp, at a sun altitude. Interpolated between; clamped outside. */
interface Stop {
  altitude: number;
  sky: number;
  land: number;
  water: number;
  ambient: number;
  key: number;
  haze: number;
}

const RAMP: Stop[] = [
  {
    altitude: 30,
    sky: 0x9fb8cf,
    land: 0x6b7a5e,
    water: 0x2b4a63,
    ambient: 0.95,
    key: 1.2,
    haze: 1.2e-5,
  },
  {
    altitude: 5,
    sky: 0xa8b3bd,
    land: 0x5c6650,
    water: 0x2a4258,
    ambient: 0.8,
    key: 0.9,
    haze: 1.8e-5,
  },
  {
    altitude: SUNSET_ALTITUDE_DEGREES,
    sky: 0xb2a29c,
    land: 0x44453f,
    water: 0x33455a,
    ambient: 0.58,
    key: 0.45,
    haze: 2.4e-5,
  },
  {
    altitude: -6,
    sky: 0x53617a,
    land: 0x272c31,
    water: 0x1b2a3d,
    ambient: 0.42,
    key: 0.12,
    haze: 2.4e-5,
  },
  {
    altitude: -12,
    sky: 0x1b2739,
    land: 0x0c1015,
    water: 0x101b2a,
    ambient: 0.3,
    key: 0.06,
    haze: 1.6e-5,
  },
  {
    altitude: -18,
    sky: 0x05080e,
    land: 0x03050a,
    water: 0x0a121d,
    ambient: 0.26,
    key: 0.04,
    haze: 1.0e-5,
  },
];

/**
 * Turn one instant's conditions into what the scene needs.
 *
 * `visibilityMetres`, where the report gives one, overrides the ramp's haze: the exponential
 * fog reaches about 95 percent at a distance where `(distance * density)^2` is 3, so the
 * density that puts the far edge of visibility there is sqrt(3) over it.
 */
export function lightingFor(conditions: Conditions): Lighting {
  const blended = blend(conditions.sun.altitudeDegrees);
  const visibility = conditions.visibilityMetres;

  return {
    sky: new Color(blended.sky),
    land: new Color(blended.land),
    water: new Color(blended.water),
    ambient: blended.ambient,
    keyIntensity: blended.key,
    keyDirection: keyDirection(conditions),
    hazeDensity: visibility ? Math.sqrt(3) / visibility : blended.haze,
  };
}

/**
 * Where the light comes from. The sun while it is up, the moon after that if it is up, and
 * failing both, straight overhead - which is not a claim about anything, it is what keeps a
 * hull from rendering as a silhouette with no top.
 */
function keyDirection(conditions: Conditions): Vector3 {
  if (conditions.sun.altitudeDegrees > SUNSET_ALTITUDE_DEGREES) {
    return towards(conditions.sun.azimuthDegrees, conditions.sun.altitudeDegrees);
  }
  if (conditions.moon.altitudeDegrees > 0) {
    return towards(conditions.moon.azimuthDegrees, conditions.moon.altitudeDegrees);
  }
  return new Vector3(0, 1, 0);
}

/** A bearing and an altitude as a direction in the world's axes: x east, y up, z south. */
function towards(azimuthDegrees: number, altitudeDegrees: number): Vector3 {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  const altitude = (altitudeDegrees * Math.PI) / 180;
  const horizontal = Math.cos(altitude);
  return new Vector3(
    horizontal * Math.sin(azimuth),
    Math.sin(altitude),
    -horizontal * Math.cos(azimuth),
  );
}

/** The two rungs the altitude falls between, mixed. */
function blend(altitudeDegrees: number): Stop {
  const first = RAMP[0];
  const last = RAMP[RAMP.length - 1];
  if (!first || !last) throw new Error("empty ramp");
  if (altitudeDegrees >= first.altitude) return first;
  if (altitudeDegrees <= last.altitude) return last;

  for (let i = 1; i < RAMP.length; i += 1) {
    const above = RAMP[i - 1];
    const below = RAMP[i];
    if (!above || !below || altitudeDegrees < below.altitude) continue;
    const t = (above.altitude - altitudeDegrees) / (above.altitude - below.altitude);
    return mix(above, below, t);
  }
  return last;
}

function mix(from: Stop, to: Stop, t: number): Stop {
  const colour = (a: number, b: number): number => new Color(a).lerp(new Color(b), t).getHex();
  return {
    altitude: from.altitude + (to.altitude - from.altitude) * t,
    sky: colour(from.sky, to.sky),
    land: colour(from.land, to.land),
    water: colour(from.water, to.water),
    ambient: from.ambient + (to.ambient - from.ambient) * t,
    key: from.key + (to.key - from.key) * t,
    haze: from.haze + (to.haze - from.haze) * t,
  };
}
