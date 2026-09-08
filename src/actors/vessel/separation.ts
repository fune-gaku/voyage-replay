/**
 * How far apart two hulls are, which is not how far apart two antennae are.
 *
 * `core/track.ts` answers the second and says so: it returns the distance between the two
 * REPORTED positions, and an AIS position is the GPS antenna. On the reference case that
 * answer is 39.6 m at 18:13:35 - read from the middle of ten seconds during which the drawn
 * hulls are through each other. Both numbers are true about different things, and only this
 * one answers the question a casualty report is asking.
 *
 * It cannot live in `core/`, which is not allowed to know what a ship is: a range between
 * hulls needs their shapes. It uses the shape that gets drawn, from `hull-shape.ts`, because a
 * range measured against a different outline is a number the picture contradicts.
 *
 * **What this is worth is bounded by the shape.** The outline is generated from a length and a
 * beam - it is the right size and a plausible plan, not this ship's lines - so a metre of it
 * is a metre of this tool's guess. `ui/panels.ts` says that where it reports the answer.
 */

import { type LocalPosition } from "../../core/geodesy.js";
import { sampleAt, type PreparedTrack } from "../../core/track.js";
import type { Track, Vessel } from "../../core/types.js";

import { hullDimensions, isBoxBowed, planOutline, type PlanPoint } from "./hull-shape.js";
import { hullCentreOffset, offsetMetres, placementFor, type Placement } from "./reference-point.js";

/**
 * The hull's outline in the local frame, from its shape, its placement and its position.
 *
 * The placement comes from `placementFor`, which is the same answer `render/player.ts` places
 * her by. Working it out again here would put the range on a ship the picture is not drawing,
 * and the case that would break is the one with no heading, where the picture declines to
 * apply the offset at all.
 */
export function placedOutline(
  outline: PlanPoint[],
  placement: Placement,
  reported: LocalPosition,
): LocalPosition[] {
  const radians = (placement.headingDegreesTrue * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const centre = {
    east:
      reported.east + placement.offset.forwardMetres * sin + placement.offset.starboardMetres * cos,
    north:
      reported.north +
      placement.offset.forwardMetres * cos -
      placement.offset.starboardMetres * sin,
  };
  return outline.map((point) => ({
    east: centre.east + point.forwardMetres * sin + point.starboardMetres * cos,
    north: centre.north + point.forwardMetres * cos - point.starboardMetres * sin,
  }));
}

/**
 * The gap between two hulls, in metres, and zero once they are in contact.
 *
 * **Zero rather than a depth of penetration, which is the one decision here.** A depth would
 * say something about the impact, but it would be saying it about two invented bows: the
 * outline is generated from a length and a beam, and a hull driven three metres into another
 * is three metres of this tool's plan shape, not of either ship. It is the same judgement as
 * declining to bend a hull for the earth's curvature - precision about the wrong thing.
 *
 * What the shapes DO support is whether and when the two touched, so that is what comes back:
 * a gap while there is one, zero while there is not, and the caller reports the window.
 */
export function separationMetres(a: LocalPosition[], b: LocalPosition[]): number {
  const first = edges(a);
  const second = edges(b);
  if (overlap(first, second, a, b)) return 0;

  let closest = Infinity;
  for (const one of first) {
    for (const other of second) {
      const gap = betweenSegments(one, other);
      if (gap < closest) closest = gap;
    }
  }
  return closest;
}

/** One side of the hull, from one vertex to the next. */
interface Edge {
  a: LocalPosition;
  b: LocalPosition;
}

/** The closed polygon's sides, wrapping at the end. */
function edges(polygon: LocalPosition[]): Edge[] {
  const sides: Edge[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a && b) sides.push({ a, b });
  }
  return sides;
}

/**
 * Whether the two outlines meet at all.
 *
 * Two tests, because either alone misses a case: crossing sides catch hulls driven through
 * each other at an angle, and a vertex inside the other polygon catches one wholly contained
 * - a small craft under the flare of a large one, which crosses no side.
 */
function overlap(first: Edge[], second: Edge[], a: LocalPosition[], b: LocalPosition[]): boolean {
  for (const one of first) {
    for (const other of second) {
      if (sidesCross(one, other)) return true;
    }
  }
  return a.some((point) => inside(point, second)) || b.some((point) => inside(point, first));
}

/** Which side of the line `a`-`b` the point `c` falls on, by the sign. */
function side(a: LocalPosition, b: LocalPosition, c: LocalPosition): number {
  return (b.east - a.east) * (c.north - a.north) - (b.north - a.north) * (c.east - a.east);
}

/** Proper crossing: each side's ends straddle the other's line. */
function sidesCross(one: Edge, other: Edge): boolean {
  const straddles = side(one.a, one.b, other.a) > 0 !== side(one.a, one.b, other.b) > 0;
  return straddles && side(other.a, other.b, one.a) > 0 !== side(other.a, other.b, one.b) > 0;
}

/** The classic ray cast, counting crossings of a horizontal ray to the east. */
function inside(point: LocalPosition, polygon: Edge[]): boolean {
  let within = false;
  for (const { a, b } of polygon) {
    const spans = a.north > point.north !== b.north > point.north;
    if (!spans) continue;
    const crossing = ((b.east - a.east) * (point.north - a.north)) / (b.north - a.north) + a.east;
    if (point.east < crossing) within = !within;
  }
  return within;
}

/** Shortest distance between two sides that do not cross. */
function betweenSegments(one: Edge, other: Edge): number {
  return Math.min(
    toSegment(other.a, one.a, one.b),
    toSegment(other.b, one.a, one.b),
    toSegment(one.a, other.a, other.b),
    toSegment(one.b, other.a, other.b),
  );
}

/** Shortest distance from a point to a segment. */
function toSegment(point: LocalPosition, a: LocalPosition, b: LocalPosition): number {
  const east = b.east - a.east;
  const north = b.north - a.north;
  const lengthSquared = east * east + north * north;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(
          Math.max(
            ((point.east - a.east) * east + (point.north - a.north) * north) / lengthSquared,
            0,
          ),
          1,
        );
  return Math.hypot(point.east - (a.east + along * east), point.north - (a.north + along * north));
}

/** One ship, as the things a range between hulls needs to know about her. */
export interface HullTrack {
  track: PreparedTrack;
  vessel: Vessel;
  positionAt: Track["positionAt"];
}

/** The closest the two hulls came, and the window over which they were touching. */
export interface HullApproach {
  metres: number;
  epochSeconds: number;
  /** Null where they never met. Both ends inclusive, at the sampling step. */
  contact: { fromEpochSeconds: number; toEpochSeconds: number } | null;
}

/**
 * The closest two hulls came over the window in which both tracks exist.
 *
 * **The answer is at a different INSTANT from the antennae's, not only a different number.**
 * On the reference case the hulls first touch about eight seconds before the closest approach
 * of the two antennae, so anything that says "at the moment of closest approach" has to say
 * which moment it means. `ui/panels.ts` prints both.
 *
 * The contact window is a property of this tool as much as of the ships: positions between
 * samples are interpolated in a straight line, and on the reference case the whole of the
 * contact falls inside gaps of thirteen and twenty seconds. It is reported as a window rather
 * than as a depth for the reason `separationMetres` gives.
 */
export function hullApproach(a: HullTrack, b: HullTrack, stepSeconds = 1): HullApproach | null {
  const from = Math.ceil(Math.max(a.track.startSeconds, b.track.startSeconds));
  const to = Math.floor(Math.min(a.track.endSeconds, b.track.endSeconds));
  let closest: { metres: number; epochSeconds: number } | null = null;
  let began: number | null = null;
  let ended = 0;

  for (let t = from; t <= to; t += stepSeconds) {
    const gap = gapAt(a, b, t);
    if (gap === null) continue;
    if (!closest || gap < closest.metres) closest = { metres: gap, epochSeconds: t };
    if (gap > 0) continue;
    began ??= t;
    ended = t;
  }
  if (!closest) return null;
  const contact = began === null ? null : { fromEpochSeconds: began, toEpochSeconds: ended };
  return { ...closest, contact };
}

/** The gap at one instant, or null where either track has nothing to say about it. */
function gapAt(a: HullTrack, b: HullTrack, epochSeconds: number): number | null {
  const first = outlineAt(a, epochSeconds);
  const second = outlineAt(b, epochSeconds);
  return first && second ? separationMetres(first, second) : null;
}

/** Where one hull's outline lies at an instant, placed exactly as the picture places her. */
export function outlineAt(ship: HullTrack, epochSeconds: number): LocalPosition[] | null {
  const state = sampleAt(ship.track, epochSeconds);
  if (!state) return null;
  const offset = offsetMetres(hullCentreOffset(ship.positionAt, ship.vessel.referencePointOffsets));
  const placement = placementFor(state.headingDegreesTrue ?? state.cogDegreesTrue, offset);
  const outline = planOutline(hullDimensions(ship.vessel), isBoxBowed(ship.vessel));
  return placedOutline(outline, placement, state.position);
}
