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

/**
 * One ship carrying her AIS reference-point offsets and one without them, which is the
 * ordinary state of a two-ship reconstruction: the four distances come from message 5 or
 * from a footnote to the report's track table, and either source can be silent about a
 * ship. BIG_SHIP's four distances sum to her length overall and
 * her beam exactly, and put her antenna well aft: her hull's centre lies 50 m forward of it
 * and 4 m to starboard of it - both round, both checkable on paper, and neither zero,
 * because an offset that is zero cannot tell a correct axis from a dropped one.
 */
export const COASTER: Vessel = { loaMetres: 49, beamMetres: 9.4, type: "tanker" };
export const BIG_SHIP: Vessel = {
  loaMetres: 180,
  beamMetres: 28,
  type: "cargo",
  referencePointOffsets: {
    fromBowMetres: 140,
    fromSternMetres: 40,
    fromPortMetres: 10,
    fromStarboardMetres: 18,
  },
};

/**
 * One minute apart, making good due north at a shade under 6 knots - with her bow ten
 * degrees to starboard of the track she is actually following.
 *
 * The heading and the course over ground are deliberately DIFFERENT, and by the amount a
 * cross-tide really would set a ship: that difference is the drift angle, and it is the
 * whole reason the format carries the two as separate fields. A fixture that gave her
 * heading 000 and course 000 would let a test pass whichever of the two the code reached
 * for, which is exactly the confusion these tests exist to catch.
 */
export function northboundPoints(): TrackPoint[] {
  return [
    { t: "2025-01-01T00:00:00Z", lat: 0, lon: 0, cogDegreesTrue: 0, headingDegreesTrue: 10 },
    { t: "2025-01-01T00:01:00Z", lat: 0.0015, lon: 0, cogDegreesTrue: 0, headingDegreesTrue: 10 },
    { t: "2025-01-01T00:02:00Z", lat: 0.003, lon: 0, cogDegreesTrue: 0, headingDegreesTrue: 10 },
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

/**
 * The same track with nothing said about where she is pointing: no heading and no course.
 *
 * The schema allows it - only time and position are required - and it is the case where a
 * renderer has to decide what NOT to do. A hull still has to be drawn somewhere, but there
 * is no direction to hang anything measured off.
 */
export function silentPoints(): TrackPoint[] {
  return westboundPoints().map(({ t, lat, lon }) => ({ t, lat, lon }));
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
