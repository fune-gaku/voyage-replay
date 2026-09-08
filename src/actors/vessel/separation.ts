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
import {
  hullCentreOffset,
  offsetMetres,
  placementFor,
  type OffsetMetres,
  type Placement,
} from "./reference-point.js";

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
  /** The step the coarse pass ran at, before anything was refined. */
  stepSeconds: number;
  /**
   * **The shortest interval the search ever left unexamined, which is the real floor.**
   *
   * The step is not it: intervals are halved until two proofs discharge, so most of a
   * reconstruction is settled at the step and the neighbourhood of an encounter is settled far
   * below it. What stops the halving is this - a time floor for the one interval that cannot
   * discharge at all, where a track's direction changes which field it comes from and the drawn
   * ship jumps rather than turns.
   *
   * Reporting the step as the limit understated the search by three orders of magnitude and
   * described a method it no longer uses. `ui/panels.ts` prints this.
   */
  finestSeconds: number;
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
  const scan = walk(a, b, { from, to, stepSeconds });
  if (!scan.closest) return null;
  const finestSeconds = Math.max(FINEST_SECONDS, stepSeconds / 2 ** DEEPEST);
  return { ...scan.closest, contacts: scan.contacts, stepSeconds, finestSeconds };
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

/** Where one hull is at a moment, and everything a bound on her motion needs. */
interface Where {
  outline: LocalPosition[];
  reported: LocalPosition;
  headingDegreesTrue: number;
  /**
   * WHICH field the direction came from, not merely whether there was one.
   *
   * **`headingDegreesTrue ?? cogDegreesTrue` hides a jump.** Where a track states a heading at
   * one sample and not at the one before, `sampleAt` hands back the course for the first half
   * of the span and the heading for the second, and the drawn ship turns with the course and
   * then snaps to the heading at the midpoint. Both halves have A direction, so a flag saying
   * only that finds nothing wrong - and the bound below, reading two ends that happen to
   * agree, certifies that she never turned.
   */
  headingFrom: "heading" | "course" | "none";
  /** The furthest any outline point lies from the reported position: her turning radius. */
  swingMetres: number;
}

/** One look at the pair: the moment, where each of them is, and the gap between them. */
interface Look {
  at: number;
  a: Where;
  b: Where;
  gap: number;
}

/** Where a hull is at an instant, placed exactly as the picture places her. */
function whereAt(ship: HullTrack, at: number): Where | null {
  const state = sampleAt(ship.track, at);
  if (!state) return null;
  const offset = offsetMetres(hullCentreOffset(ship.positionAt, ship.vessel.referencePointOffsets));
  const stated = state.headingDegreesTrue ?? state.cogDegreesTrue;
  const placement = placementFor(stated, offset);
  const shape = planOutline(hullDimensions(ship.vessel), isBoxBowed(ship.vessel));
  return {
    outline: placedOutline(shape, placement, state.position),
    reported: state.position,
    headingDegreesTrue: placement.headingDegreesTrue,
    headingFrom:
      state.headingDegreesTrue !== undefined
        ? "heading"
        : state.cogDegreesTrue !== undefined
          ? "course"
          : "none",
    swingMetres: swingOf(shape, placement.offset),
  };
}

/** How far the furthest part of her lies from the position her track reports. */
function swingOf(shape: PlanPoint[], offset: OffsetMetres): number {
  let furthest = 0;
  for (const point of shape) {
    const forward = point.forwardMetres + offset.forwardMetres;
    const starboard = point.starboardMetres + offset.starboardMetres;
    furthest = Math.max(furthest, Math.hypot(forward, starboard));
  }
  return furthest;
}

/** The gap and where each hull was when it was measured, or null outside either track. */
function lookAt(a: HullTrack, b: HullTrack, at: number): Look | null {
  const first = whereAt(a, at);
  const second = whereAt(b, at);
  if (!first || !second) return null;
  return { at, a: first, b: second, gap: separationMetres(first.outline, second.outline) };
}

/**
 * The furthest one hull can have moved with respect to the other between two moments.
 *
 * **The straight line between where a point started and where it finished is not this.** That
 * was the first version, and it is wrong for exactly the case the whole search is about: a ship
 * translating and turning at once carries every point of herself along a curve, and a turn that
 * brings a point back towards where it began hides most of its journey from the two endpoints.
 * Two ends alike, a swing in between, and a bound taken off the ends says nothing moved.
 *
 * What is true whatever the path: between two samples each reported position runs in a straight
 * line and each hull turns through the difference of two headings the short way round. So no
 * part of one goes further, WITH RESPECT TO the other, than the two straight lines' difference
 * plus the arcs their own radii sweep. A bound rather than a measurement, which is the point.
 *
 * Relative, because absolute is useless: two ships steaming north in company cover miles and
 * never change how far apart they are, and a bound off their ground speeds calls every parallel
 * course an encounter about to happen.
 *
 * Infinity where the direction came from a different field at the two ends - heading at one and
 * course at the other, or one of them and nothing at the other - because there the drawn ship
 * jumps rather than turns: `placementFor` and issue #12. Nothing bounds a jump, and asking only
 * whether SOME direction was available misses the commoner half of it.
 */
function travelled(before: Look, after: Look): number {
  if (before.a.headingFrom !== after.a.headingFrom) return Number.POSITIVE_INFINITY;
  if (before.b.headingFrom !== after.b.headingFrom) return Number.POSITIVE_INFINITY;
  // **Relative, not absolute.** What can change the gap is how the two move with respect to
  // each other: two ships steaming north together cover miles and stay exactly as far apart.
  // Bounding each one's ground speed instead made every parallel course look like an
  // encounter about to happen, and the search halved its way into the ground.
  const east =
    after.a.reported.east -
    before.a.reported.east -
    (after.b.reported.east - before.b.reported.east);
  const north =
    after.a.reported.north -
    before.a.reported.north -
    (after.b.reported.north - before.b.reported.north);
  // Each hull's own turn is relative motion too: her ends swing about her own position.
  return Math.hypot(east, north) + swung(before.a, after.a) + swung(before.b, after.b);
}

/** The arc the furthest part of one hull sweeps as she turns between two moments. */
function swung(before: Where, after: Where): number {
  const turned = Math.abs(shortWayRound(after.headingDegreesTrue - before.headingDegreesTrue));
  return (turned * Math.PI * Math.max(before.swingMetres, after.swingMetres)) / 180;
}

/** Degrees, brought into the half-turn either side of zero. */
function shortWayRound(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * How far this pair is from changing state: the gap when clear, the depth when not.
 *
 * **Clear or touching, the certificate is the same shape.** A pair with water between them
 * cannot touch without closing it; a pair already through each other cannot come apart without
 * backing the deepest part of one out of the other. Either way, if the two together cannot
 * travel that far in the time, nothing happened in between.
 *
 * The depth is used here and nowhere else. `separationMetres` still answers zero for a pair in
 * contact, for the reason it gives - a depth through two invented bows is a figure about this
 * tool's plan shape - and that argument is about what a page may claim, not about what an
 * interval may be discharged with.
 */
function clearance(look: Look): number {
  return look.gap > 0 ? look.gap : overlapDepth(look.a.outline, look.b.outline);
}

/**
 * How far the deepest part of one hull lies inside the other.
 *
 * Not the true penetration depth, which for shapes like these is a harder question than it is
 * worth - it is a LOWER bound on the travel needed to part them, which is all a certificate
 * needs. Whatever else has to happen, that vertex has to reach a side.
 */
function overlapDepth(a: LocalPosition[], b: LocalPosition[]): number {
  const sides = { a: edges(a), b: edges(b) };
  // **The middle of each of them as well as their corners, or two hulls exactly on top of
  // each other measure zero.** Every corner of one then lies ON the other's side rather than
  // inside it, the depth comes back nought, and an interval that plainly cannot change state
  // never discharges - the search halves its way to the floor over and over. A hull's middle
  // is the part furthest from any side she has.
  const points = [
    ...a.map((point): [LocalPosition, Edge[]] => [point, sides.b]),
    ...b.map((point): [LocalPosition, Edge[]] => [point, sides.a]),
    [middleOf(a), sides.b] satisfies [LocalPosition, Edge[]],
    [middleOf(b), sides.a] satisfies [LocalPosition, Edge[]],
  ];
  let deepest = 0;
  for (const [point, into] of points) {
    if (!inside(point, into)) continue;
    let out = Number.POSITIVE_INFINITY;
    for (const side of into) out = Math.min(out, toSegment(point, side.a, side.b));
    deepest = Math.max(deepest, Number.isFinite(out) ? out : 0);
  }
  return deepest;
}

/** The average of an outline's corners: inside it, and well away from its sides. */
function middleOf(outline: LocalPosition[]): LocalPosition {
  let east = 0;
  let north = 0;
  for (const point of outline) {
    east += point.east;
    north += point.north;
  }
  const count = Math.max(outline.length, 1);
  return { east: east / count, north: north / count };
}

/** The state one pass carries: every look taken, and the least gap any of them showed. */
interface Search {
  taken: Look[];
  least: number;
}

/**
 * Every look worth taking: the step, and then as finely as two proofs demand.
 *
 * **Halving until both discharge, rather than slicing a fixed number of times.** A fixed sweep
 * is a resolution wearing the clothes of a proof: whatever it is set to, two hulls can touch
 * and part inside one of its slices. Recursion stops where nothing CAN have happened - most of
 * a reconstruction discharges on the first test, the ships being miles apart - and goes deep
 * only where the two are close enough to matter.
 *
 * **Two proofs, because there are two questions and one of them was going unasked.** Whether
 * the pair changed state is settled by the clearance and the travel; whether a nearer approach
 * hides in the interval is not. An interval whose ends are 100 m apart where the two can only
 * close 90 m cannot touch - and can still pass at 10 m. That was reported as the least gap for
 * as long as some other look happened to hold a smaller number, which is a plausible figure
 * for a range nobody came within.
 *
 * So the second proof is the branch and bound: an interval can hold nothing nearer than its
 * lesser end less what the two can travel, and where that is no better than the best already
 * in hand there is nothing in it to look for.
 */
function looks(
  a: HullTrack,
  b: HullTrack,
  over: { from: number; to: number; stepSeconds: number },
): Look[] {
  // **The coarse pass first, all of it.** The second proof is a branch and bound, and a bound
  // is only worth what is already in hand: refining left to right spends its whole first half
  // proving there is nothing nearer than a figure it is about to beat. One sweep of the step
  // costs almost nothing and starts the refinement knowing roughly how close they came.
  const coarse: Look[] = [];
  for (const at of instants(over, a, b)) {
    const look = lookAt(a, b, at);
    if (look) coarse.push(look);
  }
  const search: Search = { taken: [], least: Math.min(...coarse.map((look) => look.gap)) };
  for (const [index, look] of coarse.entries()) {
    const previous = coarse[index - 1];
    if (previous) split(a, b, { before: previous, after: look }, search);
    search.taken.push(look);
  }
  return search.taken;
}

/** Everything strictly between two looks that neither proof can rule out, in order. */
function split(
  a: HullTrack,
  b: HullTrack,
  span: { before: Look; after: Look; depth?: number },
  search: Search,
): void {
  const depth = span.depth ?? 0;
  if (settled(span.before, span.after, search.least)) return;
  if (span.after.at - span.before.at <= FINEST_SECONDS || depth >= DEEPEST) return;
  const middle = lookAt(a, b, (span.before.at + span.after.at) / 2);
  if (!middle) return;
  search.least = Math.min(search.least, middle.gap);
  split(a, b, { before: span.before, after: middle, depth: depth + 1 }, search);
  search.taken.push(middle);
  split(a, b, { before: middle, after: span.after, depth: depth + 1 }, search);
}

/** Whether an interval can hold neither a change of state nor a nearer approach than `least`. */
function settled(before: Look, after: Look, least: number): boolean {
  const reach = travelled(before, after);
  const stays = Math.min(clearance(before), clearance(after)) > reach;
  // The least a gap can be is nothing, which matters once something has touched: with the
  // best in hand at zero, no interval anywhere can hold anything nearer, and a bound that
  // forgets it goes on halving every interval of a collision down to the floor.
  const couldBe = Math.max(0, Math.min(before.gap, after.gap) - reach);
  return stays && couldBe >= least;
}

/**
 * How far the halving goes before an interval is left as it stands.
 *
 * Twenty of them take a one-second step to a microsecond, which is far finer than positions
 * interpolated in straight lines between samples a minute apart can mean.
 */
const DEEPEST = 20;

/**
 * And a floor in time as well as in halvings, for the one interval that cannot discharge.
 *
 * Where a track states a direction on one side of a sample and not on the other, the drawn
 * ship JUMPS at the midpoint rather than turning - `placementFor`, and issue #12, which is
 * about that jump. Nothing bounds a jump, so the interval holding it never discharges however
 * small it gets. A millisecond is far below what positions interpolated between samples a
 * minute apart can mean, and it keeps the halving from running to the depth cap on every one
 * of those.
 */
const FINEST_SECONDS = 1e-3;

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
