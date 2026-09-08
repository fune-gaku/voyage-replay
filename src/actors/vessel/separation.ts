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

/**
 * One spell of contact, with its ends taken off the drawn hulls rather than off the search.
 *
 * **`toEpochSeconds - fromEpochSeconds` is the length of it.** Counting the samples that
 * showed contact and calling that seconds is one out every time: 18:13:28 to 18:13:37 is nine
 * seconds and ten samples, and this repo has printed the ten.
 */
export interface Contact {
  fromEpochSeconds: number;
  toEpochSeconds: number;
}

/** The closest the two hulls came, and every spell over which they were touching. */
export interface HullApproach {
  metres: number;
  epochSeconds: number;
  /**
   * **Every spell, not one window spanning them all.** Two ships that touch, come clear and
   * touch again on the swing are an ordinary thing in a casualty, and reporting the first
   * moment with the last would assert contact through the clear water in between - a picture
   * of a collision that did not happen, from data that says it did not.
   */
  contacts: Contact[];
  /** The step the search ran at. A contact shorter than this can fall between two of them. */
  stepSeconds: number;
}

/**
 * The closest two hulls came over the window in which both tracks exist.
 *
 * **The answer is at a different INSTANT from the antennae's, not only a different number.**
 * On the reference case the hulls first touch seven seconds before the closest approach of the
 * two antennae, so anything that says "at the moment of closest approach" has to say which
 * moment it means. `ui/panels.ts` prints both.
 *
 * The contact times are a property of this tool as much as of the ships: positions between
 * samples are interpolated in a straight line, and on the reference case the whole of the
 * contact falls inside gaps of thirteen and twenty seconds. Contact is reported as a window
 * rather than as a depth for the reason `separationMetres` gives.
 */
export function hullApproach(a: HullTrack, b: HullTrack, stepSeconds = 1): HullApproach | null {
  const from = Math.max(a.track.startSeconds, b.track.startSeconds);
  const to = Math.min(a.track.endSeconds, b.track.endSeconds);
  checkStep(stepSeconds, from, to);
  if (to < from) return null;
  const over = { from, to, stepSeconds };
  const scan = walk(a, b, over);
  if (!scan.closest) return null;
  return { ...closest(a, b, scan.closest, over), contacts: scan.contacts, stepSeconds };
}

/**
 * Whether a step will actually walk this window, which "positive and finite" does not settle.
 *
 * **An epoch second is about 1.7e9, where the gap between one double and the next is 2.4e-7.**
 * So `t + 1e-10 === t`: a step that is positive, finite and far too small leaves the loop
 * variable exactly where it was, for ever. Rejecting non-positive steps was half the guard.
 *
 * The other half is the count. A step of a microsecond passes both tests and asks for ten
 * billion polygon comparisons, which is not an answer arriving slowly; it is the same hang
 * with extra steps. Both are the caller's mistake rather than anything a file can say, so
 * both say so rather than being quietly replaced by a step that works.
 */
function checkStep(stepSeconds: number, from: number, to: number): void {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new Error(`hullApproach needs a positive step in seconds, not ${stepSeconds}`);
  }
  if (from + stepSeconds <= from) {
    throw new Error(`hullApproach step ${stepSeconds} s is too small to advance a clock`);
  }
  const count = (to - from) / stepSeconds;
  if (count > MOST_INSTANTS) {
    throw new Error(`hullApproach step ${stepSeconds} s asks for ${count.toFixed(0)} looks`);
  }
}

/** More looks than any reconstruction needs, and far more than one page should wait for. */
const MOST_INSTANTS = 1e6;

/**
 * The moments to look at: the step, and both ends of the overlap whatever the step lands on.
 *
 * **The ends are not optional and rounding them off was the same fault one layer out.** A
 * track may start or end on a fractional second - the schema's date-time allows it and
 * `prepareTrack` keeps the milliseconds - and a pair already touching when the record begins
 * has its spell open at that instant, not at the next whole second. Walking `ceil` to `floor`
 * reported an edge up to a step inside the real one, which is what this whole area was fixed
 * for, and dropped an overlap shorter than one step to nothing at all.
 */
function instants(
  over: { from: number; to: number; stepSeconds: number },
  a: HullTrack,
  b: HullTrack,
): number[] {
  // Built from the index rather than by adding the step to itself, which drifts over a long
  // window and, at a small enough step, does not move at all.
  const count = Math.floor((over.to - over.from) / over.stepSeconds);
  const list: number[] = [over.from, over.to];
  for (let i = 1; i <= count; i += 1) list.push(over.from + i * over.stepSeconds);
  // **And every sample either track states, whatever the step.** Between two samples a ship
  // travels in a straight line, which is what lets `reach` bound how much can have happened
  // between two looks. Step over a sample and that stops being true: two looks a minute apart
  // can find the ships back where they started with a whole encounter in between, and the
  // bound says nothing happened. The turns are at the samples, so the samples are looked at.
  for (const track of [a.track, b.track]) {
    for (const point of track.points) {
      if (point.epochSeconds > over.from && point.epochSeconds < over.to) {
        list.push(point.epochSeconds);
      }
    }
  }
  return [...new Set(list)].sort((one, other) => one - other);
}

/** One look at the pair: the moment, the two outlines, and the gap between them. */
interface Look {
  at: number;
  shapes: { a: LocalPosition[]; b: LocalPosition[] };
  gap: number;
}

/** The gap and the outlines it was measured between, or null outside either track. */
function lookAt(a: HullTrack, b: HullTrack, at: number): Look | null {
  const first = outlineAt(a, at);
  const second = outlineAt(b, at);
  if (!first || !second) return null;
  return { at, shapes: { a: first, b: second }, gap: separationMetres(first, second) };
}

/**
 * How much the gap could possibly have changed between two looks.
 *
 * **A bound rather than a guess, and it is what makes a coarse step safe.** Neither hull's
 * separation can shrink by more than the two hulls moved, and the furthest any point of a hull
 * moved is a thing already in hand - both outlines are built at both moments. So if the
 * smaller of the two gaps is larger than that, nothing happened in between and the step may
 * stay coarse. Where it is not, the interval is swept finely and every state change in it is
 * seen.
 *
 * This is what stops a turn from being reported as continuous contact. Two hulls that touch,
 * come clear and touch again inside one coarse step were joined into a single spell across the
 * clear water, because the search looked at the two ends and assumed one crossing between
 * them. Assuming is exactly what was removed from the narrowing one commit ago and this is the
 * same assumption in the other function.
 */
function reach(before: Look, after: Look): number {
  return moved(before.shapes.a, after.shapes.a) + moved(before.shapes.b, after.shapes.b);
}

/** The furthest any one point of an outline travelled between two moments. */
function moved(before: LocalPosition[], after: LocalPosition[]): number {
  let furthest = 0;
  for (let i = 0; i < before.length; i += 1) {
    const was = before[i];
    const now = after[i];
    if (!was || !now) continue;
    furthest = Math.max(furthest, Math.hypot(now.east - was.east, now.north - was.north));
  }
  return furthest;
}

/** Every look worth taking: the step, refined wherever the pair could have changed state. */
function looks(
  a: HullTrack,
  b: HullTrack,
  over: { from: number; to: number; stepSeconds: number },
) {
  const taken: Look[] = [];
  let previous: Look | null = null;
  for (const at of instants(over, a, b)) {
    const look = lookAt(a, b, at);
    if (!look) continue;
    if (previous && Math.min(previous.gap, look.gap) <= reach(previous, look)) {
      for (let i = 1; i < SLICES; i += 1) {
        const between = lookAt(a, b, previous.at + ((look.at - previous.at) * i) / SLICES);
        if (between) taken.push(between);
      }
    }
    taken.push(look);
    previous = look;
  }
  return taken;
}

/** Everything one pass over the window finds: the least gap, and where contact opened and shut. */
function walk(
  a: HullTrack,
  b: HullTrack,
  over: { from: number; to: number; stepSeconds: number },
): { closest: { metres: number; epochSeconds: number } | null; contacts: Contact[] } {
  let closest: { metres: number; epochSeconds: number } | null = null;
  const contacts: Contact[] = [];
  let began: number | null = null;
  let lastClear: number | null = null;

  for (const { at, gap } of looks(a, b, over)) {
    if (!closest || gap < closest.metres) closest = { metres: gap, epochSeconds: at };
    if (gap > 0) {
      // **The spell ends here, and this is what was missing.** Left open, a second contact
      // after a turn joins the first into one window across the water between them.
      if (began !== null)
        contacts.push({ fromEpochSeconds: began, toEpochSeconds: edge(a, b, at, began) });
      began = null;
      lastClear = at;
      continue;
    }
    began ??= lastClear === null ? at : edge(a, b, lastClear, at);
  }
  if (began !== null) contacts.push({ fromEpochSeconds: began, toEpochSeconds: over.to });
  return { closest, contacts };
}

/**
 * The least gap near the step that showed it, rather than the value that step happened to hold.
 *
 * **The contact edges were bisected and this was not, which left the page asserting a grid
 * reading as a distance.** Two ships passing without touching are nearest somewhere between
 * two looks, so the panel printed a gap up to a step stale and a moment to match.
 *
 * **A finer look, not a cleverer one.** The first version of this ran a ternary search and
 * called the gap smooth and single-minimumed over the window, which it is not: what is being
 * measured is the shortest distance between two polygons that are TURNING, and which pair of
 * vertex and edge is nearest switches as they go. The function is piecewise, and a search that
 * discards half its window on two probes can walk away from the deeper of two valleys and
 * report the shallower one - the same false precision this was meant to remove, one level in.
 * A sub-scan assumes nothing: it looks at every slice.
 *
 * What it still cannot see is a nearer approach in a window the coarse scan skipped over
 * entirely. That is the step's limit, the same one that lets a short contact go unnoticed, and
 * the panel declares them together.
 */
function closest(
  a: HullTrack,
  b: HullTrack,
  found: { metres: number; epochSeconds: number },
  over: { from: number; to: number; stepSeconds: number },
): { metres: number; epochSeconds: number } {
  if (found.metres <= 0) return found;
  const low = Math.max(over.from, found.epochSeconds - over.stepSeconds);
  const high = Math.min(over.to, found.epochSeconds + over.stepSeconds);
  const slice = (high - low) / SLICES;
  let best = found;
  for (let i = 0; i <= SLICES; i += 1) {
    const at = low + i * slice;
    const gap = gapAt(a, b, at);
    if (gap !== null && gap < best.metres) best = { metres: gap, epochSeconds: at };
  }
  return best;
}

/**
 * How finely the window either side of the best look is swept.
 *
 * Two hundred and fifty-six slices of a one-second step puts the moment inside four
 * milliseconds, for two hundred and fifty-six polygon comparisons done once.
 */
const SLICES = 256;

/**
 * When the hulls actually met, between a sample that was clear and one that was not.
 *
 * **The picture is continuous and the search is not.** A replay can be paused anywhere, so
 * reporting the first second that happened to show contact puts the page up to a step away
 * from the view. The positions between samples are straight lines, so the moment the drawn
 * hulls meet is exactly defined - bisection finds it, and it is the moment the picture shows.
 *
 * What it cannot find is a contact that opens and closes between two steps. That is a
 * limitation of the step, which `HullApproach` carries and the panel prints.
 */
function edge(a: HullTrack, b: HullTrack, clearAt: number, touchingAt: number): number {
  let clear = clearAt;
  let touching = touchingAt;
  for (let step = 0; step < BISECTIONS; step += 1) {
    const middle = (clear + touching) / 2;
    const gap = gapAt(a, b, middle);
    if (gap === null || gap > 0) clear = middle;
    else touching = middle;
  }
  return touching;
}

/**
 * Twenty halvings of a one-second step lands inside a microsecond, which is far below anything
 * the answer means - the positions being interpolated - and costs twenty polygon tests.
 */
const BISECTIONS = 20;

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
