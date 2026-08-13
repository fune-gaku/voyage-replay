/**
 * What the conditions were at one instant, and how each of them is known.
 *
 * This is the layer the renderer is meant to read - never the scenario's `environment`
 * block directly. The distinction is the whole point of the module:
 *
 * - **`environment` is what somebody wrote down.** A flat set of optional fields, filled in
 *   by whoever transcribed the report, constant for the whole scenario.
 * - **`Conditions` is what obtained at a moment.** Some of it is computed from the time and
 *   the place and needs nobody's word for it; some of it can only come from the record; and
 *   where the two overlap they can be compared, which is how a transcription error surfaces.
 *
 * Written as a function of time from the start, although almost everything in it is
 * constant today. The sun already is not: this project's reference case runs for
 * eighty-seven minutes, and nautical twilight ends eleven minutes before the collision.
 * Retrofitting time onto a constant is a change to every consumer.
 *
 * ## The existing enum mixes two axes
 *
 * `environment.lightCondition` offers "day", "night", "twilight" and
 * "restricted-visibility". The first three are statements about the sun; the fourth is a
 * statement about visibility, and a foggy noon is both. They are separated here - a sun
 * level that is computed, and visibility that is stated - and only the comparable half is
 * ever compared.
 */

import { moonPosition, sunPosition, type Horizontal, type MoonState } from "./celestial.js";
import type { Environment, LatLon } from "./types.js";

/**
 * The named steps of twilight, by the sun's altitude.
 *
 * Not a scale of brightness but the standard definitions, and two of them are load-bearing
 * here. Sunset is the sun's CENTRE at -0.833 degrees rather than at zero, which is
 * refraction plus its semidiameter - and it is what COLREG Rule 20 means by "sunset to
 * sunrise", the rule that says the lights this project draws had to be shown at all.
 * Nautical twilight ends where the horizon stops being discernible, which is the moment a
 * lookout stops being able to see a ship against it.
 */
export const SUNSET_ALTITUDE_DEGREES = -0.833;
const CIVIL_ALTITUDE_DEGREES = -6;
const NAUTICAL_ALTITUDE_DEGREES = -12;
const ASTRONOMICAL_ALTITUDE_DEGREES = -18;

export const SUN_LEVELS = [
  "day",
  "civil-twilight",
  "nautical-twilight",
  "astronomical-twilight",
  "night",
] as const;
export type SunLevel = (typeof SUN_LEVELS)[number];

export interface Conditions {
  epochSeconds: number;
  sun: Horizontal;
  moon: MoonState;
  /** Which step of twilight the sun's altitude puts this instant in. Always computed. */
  sunLevel: SunLevel;
  /** COLREG Rule 20: lights are shown from sunset to sunrise. Always computed. */
  navigationLightsRequired: boolean;
  /** What the file says about the light, where it says anything. */
  statedLight: Environment["lightCondition"];
  /**
   * Whether what the file says agrees with where the sun is - or null when the two are not
   * comparable, which is every case where the file speaks about visibility instead.
   */
  statedLightAgrees: boolean | null;
  /** Straight from the file: nothing computes the weather. */
  visibilityMetres: number | null;
  seaState: number | null;
}

/**
 * Resolve the conditions at an instant.
 *
 * Takes the origin and the environment block rather than the whole scenario, so that
 * nothing in here can reach for a track, an actor or a title.
 */
export function conditionsAt(
  at: LatLon,
  environment: Environment | undefined,
  epochSeconds: number,
): Conditions {
  const sun = sunPosition(epochSeconds, at);
  const sunLevel = levelOf(sun.altitudeDegrees);
  const statedLight = environment?.lightCondition;

  return {
    epochSeconds,
    sun,
    moon: moonPosition(epochSeconds, at),
    sunLevel,
    navigationLightsRequired: sun.altitudeDegrees <= SUNSET_ALTITUDE_DEGREES,
    statedLight,
    statedLightAgrees: agreement(statedLight, sunLevel),
    visibilityMetres: environment?.visibilityMetres ?? null,
    seaState: environment?.seaState ?? null,
  };
}

function levelOf(altitudeDegrees: number): SunLevel {
  if (altitudeDegrees > SUNSET_ALTITUDE_DEGREES) return "day";
  if (altitudeDegrees > CIVIL_ALTITUDE_DEGREES) return "civil-twilight";
  if (altitudeDegrees > NAUTICAL_ALTITUDE_DEGREES) return "nautical-twilight";
  if (altitudeDegrees > ASTRONOMICAL_ALTITUDE_DEGREES) return "astronomical-twilight";
  return "night";
}

/**
 * Whether the file and the sun are saying the same thing.
 *
 * Only on the axis where both of them speak. "restricted-visibility" is an answer to a
 * different question - it can be true at noon - so it is not disagreement, it is silence,
 * and reporting it as disagreement would train a reader to ignore the column.
 *
 * "night" is treated as agreeing with any twilight. A watchkeeper writing a report is
 * describing the darkness they were in and does not mean the sun was more than eighteen
 * degrees down; holding them to the astronomer's definition would flag every dusk case.
 */
function agreement(stated: Environment["lightCondition"], computed: SunLevel): boolean | null {
  if (stated === undefined || stated === "restricted-visibility") return null;
  if (stated === "day") return computed === "day";
  if (stated === "twilight") return computed.endsWith("twilight");
  return computed !== "day";
}
