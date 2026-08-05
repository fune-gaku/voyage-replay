/**
 * Scenarios built by hand.
 *
 * These are the opposite of `examples/`. That directory holds one real case and pins the
 * whole chain against a published report; these are the smallest thing that exercises one
 * behaviour, with round numbers chosen so the expected answer can be worked out on paper.
 * Nothing here is true of any actual ship, and nothing here should be cited as if it were.
 *
 * The geometry is deliberately trivial: the origin is on the equator at the prime
 * meridian, so a degree of longitude and a degree of latitude are the same number of
 * metres and a position can be read straight off the numbers.
 */

import type { Actor, Scenario, TrackPoint, Vessel } from "../src/core/types.js";

export const ORIGIN = { lat: 0, lon: 0 };

export const COASTER: Vessel = { loaMetres: 49, beamMetres: 9.4, type: "tanker" };
export const BIG_SHIP: Vessel = { loaMetres: 180, beamMetres: 28, type: "cargo" };

/** One minute apart, due north at a shade under 6 knots, bow along the track. */
export function northboundPoints(): TrackPoint[] {
  return [
    { t: "2025-01-01T00:00:00Z", lat: 0, lon: 0, cogDegreesTrue: 0, headingDegreesTrue: 0 },
    { t: "2025-01-01T00:01:00Z", lat: 0.0015, lon: 0, cogDegreesTrue: 0, headingDegreesTrue: 0 },
    { t: "2025-01-01T00:02:00Z", lat: 0.003, lon: 0, cogDegreesTrue: 0, headingDegreesTrue: 0 },
  ];
}

/**
 * Abeam to the east of the northbound ship, closing westward - and transmitting no
 * heading, which is what a Class B transponder does and what the panels have to say out
 * loud rather than paper over.
 */
export function westboundPoints(): TrackPoint[] {
  return [
    { t: "2025-01-01T00:00:00Z", lat: 0, lon: 0.006, cogDegreesTrue: 270 },
    { t: "2025-01-01T00:01:00Z", lat: 0.0015, lon: 0.004, cogDegreesTrue: 270 },
    { t: "2025-01-01T00:02:00Z", lat: 0.003, lon: 0.002, cogDegreesTrue: 270 },
  ];
}

export function actor(id: string, points: TrackPoint[], vessel?: Vessel): Actor {
  return {
    id,
    kind: "vessel",
    name: `${id} of the test tube`,
    ...(vessel ? { vessel } : {}),
    track: { derivation: "measured", positionAt: "gps-antenna", points },
  };
}

export function scenario(actors: Actor[] = defaultActors()): Scenario {
  return {
    formatVersion: "0.1",
    meta: {
      title: "Two ships in a test tube",
      occurredAt: "2025-01-01T00:02:00Z",
      timeZone: "UTC",
      source: { kind: "authored", citation: "invented for test/fixtures.ts" },
    },
    origin: ORIGIN,
    environment: { lightCondition: "night" },
    actors,
  };
}

function defaultActors(): Actor[] {
  return [actor("A", northboundPoints(), COASTER), actor("B", westboundPoints(), BIG_SHIP)];
}
