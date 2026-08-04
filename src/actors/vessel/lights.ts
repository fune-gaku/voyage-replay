/**
 * Navigation lights, per COLREG (1972) Rules 21, 22 and 23.
 *
 * This is the part of the reconstruction that most often decides what the case turns on.
 * A collision enquiry asks what the officer of the watch could actually see, and a light
 * is not a decoration: each one shows over a fixed arc, so which of them are visible tells
 * you the aspect of the other ship. Getting the arcs right is worth more to the finished
 * video than any amount of shading on the hull.
 *
 * Rule 21 fixes the arcs:
 *   masthead    225 deg - right ahead to 22.5 deg abaft the beam on either side
 *   sidelights  112.5 deg each - right ahead to 22.5 deg abaft the beam on its own side
 *   sternlight  135 deg - 67.5 deg from right aft on each side
 *
 * 225 + 135 = 360, so the arcs tile the horizon exactly and every bearing shows something.
 */

import type { Vessel } from "../../core/types.js";

export type LightKind =
  "masthead" | "masthead-after" | "sidelight-starboard" | "sidelight-port" | "sternlight";

export type LightColour = "white" | "green" | "red" | "yellow";

export interface LightArc {
  /** Relative bearing, degrees clockwise from the bow, where the arc begins. */
  startDegrees: number;
  /** Where it ends, exclusive. An arc may wrap through 0. */
  endDegrees: number;
}

export interface NavigationLight {
  kind: LightKind;
  colour: LightColour;
  arc: LightArc;
  /** Rule 22 minimum range at which the light must be visible. */
  nominalRangeNauticalMiles: number;
}

const ABAFT_THE_BEAM = 112.5;
const RIGHT_AFT_SECTOR = 247.5;

/**
 * Whether a relative bearing falls inside an arc. Arcs are half-open, [start, end),
 * so the four Rule 21 arcs partition the horizon with no bearing counted twice and
 * none left out.
 */
export function isWithinArc(relativeBearingDegrees: number, arc: LightArc): boolean {
  const bearing = ((relativeBearingDegrees % 360) + 360) % 360;
  return arc.startDegrees <= arc.endDegrees
    ? bearing >= arc.startDegrees && bearing < arc.endDegrees
    : bearing >= arc.startDegrees || bearing < arc.endDegrees;
}

/** Rule 22 ranges, chosen by length of vessel. */
function ranges(loaMetres: number): { masthead: number; sidelight: number; stern: number } {
  if (loaMetres >= 50) return { masthead: 6, sidelight: 3, stern: 3 };
  if (loaMetres >= 20) return { masthead: 5, sidelight: 2, stern: 2 };
  if (loaMetres >= 12) return { masthead: 3, sidelight: 2, stern: 2 };
  return { masthead: 2, sidelight: 1, stern: 2 };
}

/**
 * The lights a power-driven vessel under way exhibits (Rule 23). The second masthead
 * light is required at 50 m and over, and optional below - we omit it below 50 m, which
 * is what the smaller coasters in most collision cases actually carry.
 */
export function lightsForVessel(vessel: Vessel): NavigationLight[] {
  const range = ranges(vessel.loaMetres);

  const lights: NavigationLight[] = [
    {
      kind: "masthead",
      colour: "white",
      arc: { startDegrees: RIGHT_AFT_SECTOR, endDegrees: ABAFT_THE_BEAM },
      nominalRangeNauticalMiles: range.masthead,
    },
    {
      kind: "sidelight-starboard",
      colour: "green",
      arc: { startDegrees: 0, endDegrees: ABAFT_THE_BEAM },
      nominalRangeNauticalMiles: range.sidelight,
    },
    {
      kind: "sidelight-port",
      colour: "red",
      arc: { startDegrees: RIGHT_AFT_SECTOR, endDegrees: 360 },
      nominalRangeNauticalMiles: range.sidelight,
    },
    {
      kind: "sternlight",
      colour: "white",
      arc: { startDegrees: ABAFT_THE_BEAM, endDegrees: RIGHT_AFT_SECTOR },
      nominalRangeNauticalMiles: range.stern,
    },
  ];

  if (vessel.loaMetres >= 50) {
    lights.splice(1, 0, {
      kind: "masthead-after",
      colour: "white",
      arc: { startDegrees: RIGHT_AFT_SECTOR, endDegrees: ABAFT_THE_BEAM },
      nominalRangeNauticalMiles: range.masthead,
    });
  }

  return lights;
}

/**
 * Which of a ship's lights an observer sees.
 *
 * `observerRelativeBearingDegrees` is the bearing of the OBSERVER measured from the head
 * of the ship CARRYING the lights - not the other way round. Reversing the two is the
 * easiest mistake to make here and produces a picture that is wrong by exactly 180 deg,
 * which looks plausible right up until someone reads the aspect off it.
 */
export function visibleLights(
  vessel: Vessel,
  observerRelativeBearingDegrees: number,
): NavigationLight[] {
  return lightsForVessel(vessel).filter((light) =>
    isWithinArc(observerRelativeBearingDegrees, light.arc),
  );
}

/**
 * The aspect an observer reads off those lights, in the words a mariner would use.
 * "Green sidelight and masthead lights" means you are looking at her starboard bow.
 */
export function describeAspect(lights: NavigationLight[]): string {
  const kinds = new Set(lights.map((l) => l.kind));
  if (kinds.has("sidelight-starboard") && kinds.has("sidelight-port")) return "end-on";
  if (kinds.has("sidelight-starboard")) return "starboard side visible";
  if (kinds.has("sidelight-port")) return "port side visible";
  if (kinds.has("sternlight")) return "stern-on, overtaking";
  return "no lights in view";
}
